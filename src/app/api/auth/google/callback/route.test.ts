import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";
import { ObjectId } from "mongodb";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { reauthClock } from "@/lib/auth/sessionIssue";

const { cookieState, exchangeGoogleCode, fetchGoogleUser, getDb } = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    cookieState: {
      map,
      reset(init: Record<string, string>) {
        map.clear();
        for (const [key, value] of Object.entries(init)) map.set(key, value);
      },
      set: vi.fn((name: string, value: string) => {
        map.set(name, value);
      }),
      get: vi.fn((name: string) => {
        const value = map.get(name);
        return value === undefined ? undefined : { value };
      }),
      delete: vi.fn((name: string) => {
        map.delete(name);
      }),
    },
    exchangeGoogleCode: vi.fn(),
    fetchGoogleUser: vi.fn(),
    getDb: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieState),
  headers: vi.fn(async () => ({ get: () => null })),
}));
vi.mock("@/lib/mongodb", () => ({ getDb }));
vi.mock("@/lib/google", () => ({ exchangeGoogleCode, fetchGoogleUser }));
vi.mock("@/lib/utils/network", () => ({
  getBaseUrl: vi.fn().mockReturnValue("https://ahousedividedgame.com"),
  getClientIp: vi.fn().mockResolvedValue("203.0.113.5"),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));

const userId = new ObjectId("0000000000000000000000bb");
const googleUser = {
  id: "google-user-1",
  email: "alpha@gmail.example",
  name: "Alpha",
  picture: null,
};

function existingUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: userId,
    email: "a@b.com",
    username: "alpha",
    role: "player",
    isAdmin: false,
    hasCompletedSetup: true,
    googleId: googleUser.id,
    ...overrides,
  };
}

function mockDb(
  user: Record<string, unknown> | null,
  updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 })
) {
  getDb.mockResolvedValue({
    collection: (name: string) =>
      name === "users"
        ? { findOne: vi.fn().mockResolvedValue(user), updateOne }
        : { insertOne: vi.fn().mockResolvedValue({}), findOne: vi.fn().mockResolvedValue(null) },
  });
  return updateOne;
}

const NOON_MS = Date.parse("2026-04-25T12:00:00.000Z");

describe("GET /api/auth/google/callback — existing-user reauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieState.reset({
      google_oauth_mode: "login",
      google_oauth_state: "state-1",
    });
    process.env.GOOGLE_CLIENT_ID = "test-client";
    process.env.GOOGLE_CLIENT_SECRET = "test-secret";
    process.env.GOOGLE_REDIRECT_URI = "https://ahousedividedgame.com/api/auth/google/callback";
    exchangeGoogleCode.mockResolvedValue({ access_token: "tok", id_token: "id" });
    fetchGoogleUser.mockResolvedValue(googleUser);
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps authRevokedAt, issues a strictly newer JWT, and sets the cookie only after a matching write", async () => {
    const cutoff = new Date(NOON_MS + 400);
    const updateOne = mockDb(existingUser({ authRevokedAt: cutoff }));
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://ahousedividedgame.com/api/auth/google/callback?code=abc&state=state-1")
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("status=login_success");

    const [filter, update] = updateOne.mock.calls[0];
    expect(update.$unset).toBeUndefined();
    expect(update.$set.authRevokedAt).toBeUndefined();
    expect(filter.authRevokedAt).toEqual(cutoff);
    expect(filter.googleId).toBe(googleUser.id);
    expect(filter.isBanned).toEqual({ $ne: true });

    const token = cookieState.map.get(AUTH_COOKIE_NAME);
    expect(token).toBeDefined();
    const payload = decodeJwt(token!);
    expect(Number.isSafeInteger(payload.iat)).toBe(true);
    expect(cutoff.getTime() >= (payload.iat as number) * 1000).toBe(false);
    expect(cutoff.getTime() >= Math.floor(cutoff.getTime() / 1000) * 1000).toBe(true);
  });

  it("does not mint a session when a concurrent unlink, ban, or revocation wins", async () => {
    const cutoff = new Date(NOON_MS + 400);
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 0 });
    mockDb(existingUser({ authRevokedAt: cutoff }), updateOne);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://ahousedividedgame.com/api/auth/google/callback?code=abc&state=state-1")
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("reason=session_expired");
    expect(cookieState.map.has(AUTH_COOKIE_NAME)).toBe(false);
    expect(updateOne).toHaveBeenCalled();
  });

  it("does not mint a session when a concurrent reset lands during the cutoff wait", async () => {
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
    mockDb(existingUser({ authRevokedAt: cutoff }), updateOne);
    const { GET } = await import("./route");
    const pending = GET(
      new Request("https://ahousedividedgame.com/api/auth/google/callback?code=abc&state=state-1")
    );
    await vi.waitFor(() => expect(reauthClock.sleep).toHaveBeenCalled());
    expect(updateOne).not.toHaveBeenCalled();
    expect(cookieState.map.has(AUTH_COOKIE_NAME)).toBe(false);
    releaseWait();
    const res = await pending;
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("reason=session_expired");
    expect(updateOne.mock.calls[0][0].authRevokedAt).toEqual(cutoff);
    expect(cookieState.map.has(AUTH_COOKIE_NAME)).toBe(false);
  });

  it("rejects a future cutoff without minting a session", async () => {
    vi.spyOn(reauthClock, "now").mockReturnValue(NOON_MS + 400);
    const sleep = vi.spyOn(reauthClock, "sleep");
    const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
    mockDb(existingUser({ authRevokedAt: new Date(NOON_MS + 2000) }), updateOne);
    const { GET } = await import("./route");
    const res = await GET(
      new Request("https://ahousedividedgame.com/api/auth/google/callback?code=abc&state=state-1")
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("reason=session_expired");
    expect(updateOne).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(cookieState.map.has(AUTH_COOKIE_NAME)).toBe(false);
  });
});
