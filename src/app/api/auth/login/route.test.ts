import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeJwt } from "jose";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { reauthClock } from "@/lib/auth/sessionIssue";

const { cookieDelete, cookieSet, migratePasswordLoginToUnified } = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  migratePasswordLoginToUnified: vi.fn().mockResolvedValue({
    accountId: "12e2ef3f-ba11-4c7a-b7d7-9655b11bf415",
    userId: "a0f5e7e3-0ea6-4567-b581-2e170ed5fec2",
  }),
}));

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: vi.fn().mockResolvedValue("203.0.113.5") }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("@/lib/api/rateLimit.mongo", () => ({
  durableRateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 9 }),
}));
vi.mock("@/lib/auth/unifiedMigration", () => ({
  isUnifiedMigrationCohort: vi.fn().mockReturnValue(true),
  migratePasswordLoginToUnified,
}));
vi.mock("next/headers", () => ({
  cookies: vi
    .fn()
    .mockResolvedValue({ delete: cookieDelete, get: () => undefined, set: cookieSet }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}));

async function hashedPassword() {
  const bcrypt = (await import("bcryptjs")).default;
  return bcrypt.hash("password123", 4);
}

async function mockUsersDb(
  user: Record<string, unknown>,
  updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 })
) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: (name: string) =>
      name === "users"
        ? {
            findOne: vi.fn().mockResolvedValue(user),
            updateOne,
          }
        : {
            insertOne: vi.fn().mockResolvedValue({}),
            createIndex: vi.fn().mockResolvedValue("expiresAt_1"),
            findOne: vi.fn().mockResolvedValue(null),
          },
  } as never);
  return updateOne;
}

function loginRequest() {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "test" },
    body: JSON.stringify({
      email: "a@b.com",
      password: "password123",
      fingerprint: "hash1",
      fingerprintComponents: { canvas: "C", webglRenderer: "G", audio: "A" },
    }),
  });
}

describe("POST /api/auth/login — component persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes lastFingerprintComponents on successful login", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "player",
    });

    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.lastFingerprintComponents).toEqual({
      canvas: "C",
      webglRenderer: "G",
      audio: "A",
    });
  });
});

const NOON_MS = Date.parse("2026-04-25T12:00:00.000Z");

describe("POST /api/auth/login — authRevokedAt", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("keeps the cutoff, mints a strictly newer JWT, and still rejects the old iat", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const cutoff = new Date(NOON_MS + 400);
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "player",
      authRevokedAt: cutoff,
    });

    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);

    const [filter, update] = updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(update.$set.authRevokedAt).toBeUndefined();
    expect(filter.authRevokedAt).toEqual(cutoff);
    expect(filter.password).toBe(hash);
    expect(filter.isBanned).toEqual({ $ne: true });

    const authCookie = cookieSet.mock.calls.find((call) => call[0] === AUTH_COOKIE_NAME);
    expect(authCookie).toBeDefined();
    const payload = decodeJwt(authCookie![1] as string);
    expect(Number.isSafeInteger(payload.iat)).toBe(true);
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - (payload.iat as number)).toBeGreaterThan(6 * 24 * 60 * 60);
    expect(cutoff.getTime() >= (payload.iat as number) * 1000).toBe(false);

    const oldIat = Math.floor(cutoff.getTime() / 1000);
    expect(cutoff.getTime() >= oldIat * 1000).toBe(true);
  });

  it("does not set the auth cookie when a concurrent security-state update wins", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const cutoff = new Date(NOON_MS + 400);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    await mockUsersDb(
      {
        _id: userId,
        email: "a@b.com",
        username: "alpha",
        password: hash,
        role: "player",
        authRevokedAt: cutoff,
      },
      updateOne
    );

    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid credentials" });
    expect(updateOne).toHaveBeenCalled();
    expect(cookieSet.mock.calls.some((call) => call[0] === AUTH_COOKIE_NAME)).toBe(false);
  });

  it("waits out a same-second cutoff, then a same-second logout after CAS still revokes", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const cutoff = new Date(NOON_MS + 400);
    let nowMs = NOON_MS + 400;
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      expect(ms).toBe(600);
      nowMs += ms;
    });
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "player",
      authRevokedAt: cutoff,
    });

    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][0].authRevokedAt).toEqual(cutoff);

    const authCookie = cookieSet.mock.calls.find((call) => call[0] === AUTH_COOKIE_NAME);
    const payload = decodeJwt(authCookie![1] as string);
    expect(payload.iat).toBe(NOON_MS / 1000 + 1);
    expect(payload.iat as number).toBeLessThanOrEqual(nowMs / 1000);
    const logoutAfterCas = new Date(nowMs);
    expect(logoutAfterCas.getTime() >= (payload.iat as number) * 1000).toBe(true);
  });

  it("does not mint a session when a concurrent reset lands during the cutoff wait", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const cutoff = new Date(NOON_MS + 400);
    let nowMs = NOON_MS + 400;
    let releaseWait: () => void = () => {};
    const waitGate = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    vi.spyOn(reauthClock, "now").mockImplementation(() => nowMs);
    vi.spyOn(reauthClock, "sleep").mockImplementation(async (ms) => {
      await waitGate;
      nowMs += ms;
    });
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    await mockUsersDb(
      {
        _id: userId,
        email: "a@b.com",
        username: "alpha",
        password: hash,
        role: "player",
        authRevokedAt: cutoff,
      },
      updateOne
    );

    const { POST } = await import("./route");
    const pending = POST(loginRequest());
    await vi.waitFor(() => expect(reauthClock.sleep).toHaveBeenCalled());
    expect(updateOne).not.toHaveBeenCalled();
    expect(cookieSet.mock.calls.some((call) => call[0] === AUTH_COOKIE_NAME)).toBe(false);
    releaseWait();
    const res = await pending;
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Invalid credentials" });
    expect(updateOne).toHaveBeenCalled();
    expect(updateOne.mock.calls[0][0].authRevokedAt).toEqual(cutoff);
    expect(cookieSet.mock.calls.some((call) => call[0] === AUTH_COOKIE_NAME)).toBe(false);
  });

  it("rejects a future or invalid cutoff without minting a session", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    const sleep = vi.spyOn(reauthClock, "sleep");
    for (const cutoff of [new Date(NOON_MS + 2000), new Date(Number.NaN)]) {
      cookieSet.mockClear();
      const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      await mockUsersDb(
        {
          _id: userId,
          email: "a@b.com",
          username: "alpha",
          password: hash,
          role: "player",
          authRevokedAt: cutoff,
        },
        updateOne
      );
      const { POST } = await import("./route");
      const res = await POST(loginRequest());
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: "Invalid credentials" });
      expect(updateOne).not.toHaveBeenCalled();
      expect(cookieSet.mock.calls.some((call) => call[0] === AUTH_COOKIE_NAME)).toBe(false);
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it("CAS-matches an explicit null cutoff without treating it as missing", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "player",
      authRevokedAt: null,
    });

    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][0].authRevokedAt).toEqual({ $type: "null" });
  });
});

describe("POST /api/auth/login — source migration fence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AHD_UNIFIED_COHORT_ENABLED;
  });

  it("uses a valid password only to redrive an exact fenced cohort operation", async () => {
    process.env.AHD_UNIFIED_COHORT_ENABLED = "true";
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "admin",
      isAdmin: true,
      authMigrationFence: { v: 1 },
    });
    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      message: "Login successful",
      user: { id: userId.toString(), username: "alpha", isAdmin: true },
    });
    expect(migratePasswordLoginToUnified).toHaveBeenCalledWith(userId.toString(), "password123");
    expect(cookieSet.mock.calls.some((call) => call[0] === AUTH_COOKIE_NAME)).toBe(true);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it.each([{}, null, "malformed"])(
    "denies a fenced account without a write: %j",
    async (authMigrationFence) => {
      const { ObjectId } = await import("mongodb");
      const userId = new ObjectId();
      const hash = await hashedPassword();
      const updateOne = await mockUsersDb({
        _id: userId,
        email: "a@b.com",
        username: "alpha",
        password: hash,
        role: "player",
        authMigrationFence,
      });
      const { POST } = await import("./route");
      const res = await POST(loginRequest());
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Invalid credentials" });
      expect(updateOne).not.toHaveBeenCalled();
    }
  );

  it("pins fence absence on the login write so a concurrent fence matches zero", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const hash = await hashedPassword();
    const updateOne = await mockUsersDb({
      _id: userId,
      email: "a@b.com",
      username: "alpha",
      password: hash,
      role: "player",
    });
    const { POST } = await import("./route");
    const res = await POST(loginRequest());
    expect(res.status).toBe(200);
    expect(updateOne.mock.calls[0][0]).toEqual(
      expect.objectContaining({ authMigrationFence: { $exists: false } })
    );
  });
});
