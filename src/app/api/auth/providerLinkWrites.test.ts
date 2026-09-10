import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const mocks = vi.hoisted(() => {
  const map = new Map<string, string>();
  const cookieState = {
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
  };
  return {
    cookieState,
    getAuthUser: vi.fn(),
    verifyAuth: vi.fn(),
    // Login-branch cookie/JWT helpers (link branches never touch these).
    getJwtSecret: vi.fn(() => new TextEncoder().encode("test-only-auth-secret")),
    getAuthCookieOptions: vi.fn(async () => ({})),
    getTrackingCookieOptions: vi.fn(async () => ({})),
    getOAuthStateCookieOptions: vi.fn(async () => ({})),
    requireBasicAuth: vi.fn(),
    getDb: vi.fn(),
    findOne: vi.fn(),
    updateOne: vi.fn(),
    exchangeGoogleCode: vi.fn(),
    fetchGoogleUser: vi.fn(),
    exchangeCodeForToken: vi.fn(),
    fetchDiscordUser: vi.fn(),
    invalidateCachedUser: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieState),
  headers: vi.fn(async () => ({ get: () => null })),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  verifyAuth: mocks.verifyAuth,
  getJwtSecret: mocks.getJwtSecret,
  getAuthCookieOptions: mocks.getAuthCookieOptions,
  getTrackingCookieOptions: mocks.getTrackingCookieOptions,
  getOAuthStateCookieOptions: mocks.getOAuthStateCookieOptions,
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: mocks.requireBasicAuth }));
vi.mock("@/lib/auth/userDocCache", () => ({
  invalidateCachedUser: mocks.invalidateCachedUser,
}));
vi.mock("@/lib/google", () => ({
  exchangeGoogleCode: mocks.exchangeGoogleCode,
  fetchGoogleUser: mocks.fetchGoogleUser,
}));
vi.mock("@/lib/discord", () => ({
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  fetchDiscordUser: mocks.fetchDiscordUser,
}));
vi.mock("@/lib/utils/network", () => ({
  getBaseUrl: vi.fn().mockReturnValue("https://game.example.invalid"),
  getClientIp: vi.fn().mockResolvedValue("192.0.2.1"),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: () => new Response(null, { status: 500 }),
}));

import { GET as googleLink } from "./google/callback/route";
import { GET as discordLink } from "./discord/callback/route";
import { POST as googleUnlink } from "./google/unlink/route";
import { POST as discordUnlink } from "./discord/unlink/route";
import {
  providerLinkContextCookieName,
  sealProviderLinkContext,
} from "@/lib/auth/providerLinkContext";
import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

const id = new ObjectId("000000000000000000000001");
const userId = id.toHexString();
const cutoff = new Date("2026-01-01T00:00:00Z");
const issuedAt = new Date("2026-01-02T00:00:00Z");
const session = () => ({ userId, iat: issuedAt.getTime() / 1000 });
const googleUser = { id: "google-1", email: "a@gmail.example", name: "Alpha", picture: null };
const discordUser = { id: "discord-1", username: "alpha", avatar: null };

const account = (overrides: Record<string, unknown> = {}) => ({
  _id: id,
  email: "a@example.invalid",
  username: "alpha",
  password: "digest",
  authRevokedAt: cutoff,
  ...overrides,
});

// Explicit read queue: vi's once-queues survive mockClear and leak across
// tests, so link tests (two reads: fresh account, duplicate check) pop from
// here instead of using mockResolvedValueOnce.
let findOneQueue: unknown[] = [];
let findOneDefault: unknown = null;

function freshReads(fresh: unknown, duplicate: unknown = null) {
  findOneQueue = [fresh, duplicate];
}

function freshAccount(fresh: unknown) {
  findOneDefault = fresh;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    if (typeof (mock as { mockClear?: unknown }).mockClear === "function") {
      (mock as { mockClear: () => void }).mockClear();
    }
  }
  mocks.cookieState.map.clear();
  findOneQueue = [];
  findOneDefault = null;
  mocks.findOne.mockImplementation(async () =>
    findOneQueue.length > 0 ? findOneQueue.shift() : findOneDefault
  );
  // Real link-context envelopes: sealed with the same account, session iat,
  // and CSRF state the callback will verify, exercising the real HMAC path.
  process.env.AUTH_SECRET = "test-only-provider-link-secret";
  const sealFor = (
    provider: "google" | "discord",
    overrides: Partial<{ userId: string; iat: number; state: string }> = {}
  ) =>
    sealProviderLinkContext({
      provider,
      userId,
      iat: session().iat,
      state: "state-1",
      ...overrides,
    });
  mocks.cookieState.reset({
    google_oauth_mode: "link",
    google_oauth_state: "state-1",
    [providerLinkContextCookieName("google")]: sealFor("google"),
    discord_oauth_mode: "link",
    discord_oauth_state: "state-1",
    [providerLinkContextCookieName("discord")]: sealFor("discord"),
  });
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = "test-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://game.example.invalid/api/auth/google/callback";
  process.env.DISCORD_CLIENT_ID = "test-client";
  process.env.DISCORD_CLIENT_SECRET = "test-secret";
  process.env.DISCORD_REDIRECT_URI = "https://game.example.invalid/api/auth/discord/callback";
  mocks.getDb.mockResolvedValue({
    collection: () => ({
      findOne: mocks.findOne,
      updateOne: mocks.updateOne,
      insertOne: vi.fn(async () => ({})),
    }),
  });
  freshAccount(null);
  mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 1 });
  mocks.getAuthUser.mockResolvedValue({ userId });
  mocks.verifyAuth.mockResolvedValue(session());
  mocks.requireBasicAuth.mockResolvedValue({ ok: true, user: { userId } });
  mocks.exchangeGoogleCode.mockResolvedValue({ access_token: "tok" });
  mocks.fetchGoogleUser.mockResolvedValue(googleUser);
  mocks.exchangeCodeForToken.mockResolvedValue({ access_token: "tok" });
  mocks.fetchDiscordUser.mockResolvedValue(discordUser);
});

const googleGet = () =>
  googleLink(
    new Request("https://game.example.invalid/api/auth/google/callback?code=abc&state=state-1")
  );
const discordGet = () =>
  discordLink(
    new Request("https://game.example.invalid/api/auth/discord/callback?code=abc&state=state-1")
  );
const noStore = (res: Response) => res.headers.get("cache-control") ?? "";

describe("google link", () => {
  it("binds the write to the full credential snapshot and revokes sessions", async () => {
    freshReads(account({ discordId: "d1" }));
    const res = await googleGet();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=success");
    expect(noStore(res)).toContain("no-store");

    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: id,
      password: "digest",
      googleId: { $exists: false },
      discordId: "d1",
      isBanned: { $ne: true },
      authRevokedAt: cutoff,
    });
    expect(update.$set.googleId).toBe("google-1");
    expect(update.$set.googleLinkedAt).toBeInstanceOf(Date);
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
    expect(mocks.invalidateCachedUser).toHaveBeenNthCalledWith(1, userId);
    expect(mocks.invalidateCachedUser).toHaveBeenNthCalledWith(2, userId);
  });

  it("succeeds idempotently without a write when the same link exists", async () => {
    freshReads(account({ googleId: "google-1" }));
    const res = await googleGet();
    expect(res.headers.get("location")).toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("refuses to replace a different existing link without an explicit unlink", async () => {
    freshReads(account({ googleId: "google-2" }));
    const res = await googleGet();
    expect(res.headers.get("location")).toContain("reason=already_linked");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a provider id already linked to another account", async () => {
    freshReads(account(), { _id: new ObjectId() });
    const res = await googleGet();
    expect(res.headers.get("location")).toContain("reason=already_linked");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["signed-out grant", { grant: null, fresh: account(), payload: session() }],
    ["missing account", { grant: { userId }, fresh: null, payload: session() }],
    ["unverified session", { grant: { userId }, fresh: account(), payload: null }],
    [
      "foreign session",
      {
        grant: { userId },
        fresh: account(),
        payload: { userId: new ObjectId().toHexString(), iat: session().iat },
      },
    ],
    [
      "stale revocation",
      { grant: { userId }, fresh: account({ authRevokedAt: issuedAt }), payload: session() },
    ],
    [
      "banned account",
      { grant: { userId }, fresh: account({ isBanned: true }), payload: session() },
    ],
  ])("rejects a %s without writing", async (_label, setup) => {
    mocks.getAuthUser.mockResolvedValue(setup.grant);
    mocks.verifyAuth.mockResolvedValue(setup.payload);
    freshReads(setup.fresh as Record<string, unknown>);
    const res = await googleGet();
    expect(res.headers.get("location")).toContain("/login");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("reports a lost snapshot race as a conflict without claiming success", async () => {
    freshReads(account({ discordId: "d1" }));
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=error");
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
  });

  it.each([["unacknowledged write", { acknowledged: false, matchedCount: 0 }]])(
    "maps a %s to a generic error without success",
    async (_label, result) => {
      freshReads(account());
      mocks.updateOne.mockResolvedValue(result);
      const res = await googleGet();
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("reason=exchange_failed");
      expect(location).not.toContain("status=success");
      // Post-write eviction must run even unacknowledged: the write may
      // still have committed despite the missing ack.
      expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
    }
  );

  it("maps a rejected write to a generic error without success", async () => {
    freshReads(account());
    mocks.updateOne.mockRejectedValueOnce(new Error("synthetic write failure"));
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=exchange_failed");
    expect(location).not.toContain("status=success");
    // Post-write eviction must run even on throw: the write may have
    // committed despite the network error.
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("marks link-mode callback errors no-store", async () => {
    mocks.cookieState.set("google_oauth_state", "wrong-state");
    freshReads(account());
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=invalid_state");
    expect(noStore(res)).toContain("no-store");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});

describe("google link context binding", () => {
  const ctxCookie = providerLinkContextCookieName("google");
  const sealGoogle = (
    overrides: Partial<{ userId: string; iat: number; state: string }> = {},
    options: { nowMs?: number } = {}
  ) =>
    sealProviderLinkContext(
      { provider: "google", userId, iat: session().iat, state: "state-1", ...overrides },
      options
    );

  it.each([
    ["swapped browser account", () => sealGoogle({ userId: new ObjectId().toHexString() })],
    ["wrong CSRF state", () => sealGoogle({ state: "state-2" })],
    [
      "wrong provider envelope",
      () =>
        sealProviderLinkContext({
          provider: "discord",
          userId,
          iat: session().iat,
          state: "state-1",
        }),
    ],
    ["expired envelope", () => sealGoogle({}, { nowMs: Date.now() - 3_600_000 })],
    ["tampered envelope", () => `${sealGoogle()}tampered`],
  ])("rejects a %s with a retryable error and no write", async (_label, makeCtx) => {
    mocks.cookieState.set(ctxCookie, makeCtx());
    freshReads(account());
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=error");
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a missing envelope with a retryable error and no write", async () => {
    mocks.cookieState.delete(ctxCookie);
    freshReads(account());
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a rotated session with a retryable error and no write", async () => {
    // Newer iat still passes the current-session check, so only the sealed
    // binding catches the rotation.
    mocks.verifyAuth.mockResolvedValue({ userId, iat: session().iat + 100 });
    freshReads(account());
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("consumes the envelope one-time: replay without it fails", async () => {
    freshReads(account());
    const first = await googleGet();
    expect(first.headers.get("location")).toContain("status=success");
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    expect(mocks.cookieState.get(ctxCookie)).toBeUndefined();

    // A replayed callback (fresh state cookies, spent link context) fails.
    mocks.cookieState.set("google_oauth_mode", "link");
    mocks.cookieState.set("google_oauth_state", "state-1");
    freshReads(account());
    const replay = await googleGet();
    const location = replay.headers.get("location") ?? "";
    expect(location).toContain("reason=session_expired");
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
  });

  it("leaves login mode unaffected: no envelope required", async () => {
    mocks.cookieState.set("google_oauth_mode", "login");
    mocks.cookieState.delete(ctxCookie);
    freshAccount(account({ googleId: "google-1" }));
    const res = await googleGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=login_success");
    expect(location).not.toContain("reason=session_expired");
  });
});

describe("discord link", () => {
  it("binds the write to the full credential snapshot and revokes sessions", async () => {
    freshReads(account({ googleId: "g1" }));
    const res = await discordGet();
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=success");
    expect(noStore(res)).toContain("no-store");

    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: id,
      password: "digest",
      googleId: "g1",
      discordId: { $exists: false },
      isBanned: { $ne: true },
      authRevokedAt: cutoff,
    });
    expect(update.$set.discordId).toBe("discord-1");
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("refuses to replace a different existing link without an explicit unlink", async () => {
    freshReads(account({ discordId: "discord-2" }));
    const res = await discordGet();
    expect(res.headers.get("location")).toContain("reason=already_linked");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("succeeds idempotently without a write when the same link exists", async () => {
    freshReads(account({ discordId: "discord-1" }));
    const res = await discordGet();
    expect(res.headers.get("location")).toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a banned account without writing", async () => {
    freshReads(account({ isBanned: true }));
    const res = await discordGet();
    expect(res.headers.get("location")).toContain("/login");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("reports a lost snapshot race as a conflict without claiming success", async () => {
    freshReads(account());
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
  });

  it("maps a rejected write to a generic error without success", async () => {
    freshReads(account());
    mocks.updateOne.mockRejectedValueOnce(new Error("synthetic write failure"));
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=exchange_failed");
    expect(location).not.toContain("status=success");
    // Post-write eviction must run even on throw: the write may have
    // committed despite the network error.
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("evicts after an unacknowledged write without claiming success", async () => {
    freshReads(account());
    mocks.updateOne.mockResolvedValue({ acknowledged: false, matchedCount: 0 });
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=exchange_failed");
    expect(location).not.toContain("status=success");
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });
});

describe("discord link context binding", () => {
  const ctxCookie = providerLinkContextCookieName("discord");

  it.each([
    [
      "swapped browser account",
      () =>
        sealProviderLinkContext({
          provider: "discord",
          userId: new ObjectId().toHexString(),
          iat: session().iat,
          state: "state-1",
        }),
    ],
    [
      "expired envelope",
      () =>
        sealProviderLinkContext(
          { provider: "discord", userId, iat: session().iat, state: "state-1" },
          { nowMs: Date.now() - 3_600_000 }
        ),
    ],
  ])("rejects a %s with a retryable error and no write", async (_label, makeCtx) => {
    mocks.cookieState.set(ctxCookie, makeCtx());
    freshReads(account());
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=error");
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("rejects a missing envelope with a retryable error and no write", async () => {
    mocks.cookieState.delete(ctxCookie);
    freshReads(account());
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("reason=session_expired");
    expect(location).not.toContain("status=success");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("consumes the envelope one-time on success", async () => {
    freshReads(account({ googleId: "g1" }));
    const res = await discordGet();
    expect(res.headers.get("location")).toContain("status=success");
    expect(mocks.updateOne).toHaveBeenCalledTimes(1);
    expect(mocks.cookieState.get(ctxCookie)).toBeUndefined();
  });

  it("leaves login mode unaffected: no envelope required", async () => {
    mocks.cookieState.set("discord_oauth_mode", "login");
    mocks.cookieState.delete(ctxCookie);
    freshAccount(account({ discordId: "discord-1" }));
    const res = await discordGet();
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("status=login_success");
    expect(location).not.toContain("reason=session_expired");
  });
});

describe("google unlink", () => {
  it("binds the write to the full credential snapshot and revokes sessions", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    const res = await googleUnlink();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(noStore(res)).toContain("no-store");

    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: id,
      password: "digest",
      googleId: "g1",
      discordId: "d1",
      isBanned: { $ne: true },
      authRevokedAt: cutoff,
    });
    expect(update.$unset).toMatchObject({ googleId: "", googleLinkedAt: "" });
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("is idempotent without a write when no link exists", async () => {
    freshAccount(account({ discordId: "d1" }));
    const res = await googleUnlink();
    expect(res.status).toBe(200);
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it("rejects unlink of the last remaining login method", async () => {
    freshAccount(account({ password: "", googleId: "g1" }));
    const res = await googleUnlink();
    expect(res.status).toBe(400);
    expect(noStore(res)).toContain("no-store");
    expect(mocks.updateOne).not.toHaveBeenCalled();
    expect(mocks.invalidateCachedUser).not.toHaveBeenCalled();
  });

  it.each([
    ["unverified session", account({ googleId: "g1", discordId: "d1" }), null],
    [
      "stale revocation",
      account({ googleId: "g1", discordId: "d1", authRevokedAt: issuedAt }),
      session(),
    ],
    ["banned account", account({ googleId: "g1", discordId: "d1", isBanned: true }), session()],
  ])("rejects a %s with 401 without writing", async (_label, fresh, payload) => {
    freshAccount(fresh);
    mocks.verifyAuth.mockResolvedValue(payload);
    const res = await googleUnlink();
    expect(res.status).toBe(401);
    expect(noStore(res)).toContain("no-store");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("returns 404 for a missing account without writing", async () => {
    freshAccount(null);
    const res = await googleUnlink();
    expect(res.status).toBe(404);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent write wins the snapshot race", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    const res = await googleUnlink();
    expect(res.status).toBe(409);
    expect(noStore(res)).toContain("no-store");
  });

  it.each([
    ["rejected write", "reject"],
    ["unacknowledged write", "unack"],
  ])("returns a generic 503 on a %s", async (_label, mode) => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    if (mode === "reject") {
      mocks.updateOne.mockRejectedValueOnce(new Error("synthetic write failure"));
    } else {
      mocks.updateOne.mockResolvedValue({ acknowledged: false, matchedCount: 0 });
    }
    const res = await googleUnlink();
    expect(res.status).toBe(503);
    expect(noStore(res)).toContain("no-store");
    const body = await res.json();
    expect(body.success).toBeUndefined();
    // Post-write eviction must run on throw and unacknowledged alike: the
    // write may still have committed.
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("marks the early rate-limit rejection no-store", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      ok: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 1000,
      retryAfter: 30,
    });
    vi.mocked(rateLimitResponse).mockReturnValueOnce(
      NextResponse.json({ error: "slow down" }, { status: 429 })
    );
    const res = await googleUnlink();
    expect(res.status).toBe(429);
    expect(noStore(res)).toContain("no-store");
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});

describe("discord unlink", () => {
  it("binds the write to the full credential snapshot and revokes sessions", async () => {
    freshAccount(account({ password: "", googleId: "g1", discordId: "d1" }));
    const res = await discordUnlink();
    expect(res.status).toBe(200);
    expect(noStore(res)).toContain("no-store");
    const [filter, update] = mocks.updateOne.mock.calls[0];
    expect(filter).toEqual({
      _id: id,
      password: "",
      googleId: "g1",
      discordId: "d1",
      isBanned: { $ne: true },
      authRevokedAt: cutoff,
    });
    expect(update.$unset).toMatchObject({ discordId: "", discordLinkedAt: "" });
    expect(update.$max.authRevokedAt).toBeInstanceOf(Date);
  });

  it("rejects unlink of the last remaining login method", async () => {
    freshAccount(account({ password: "", discordId: "d1" }));
    const res = await discordUnlink();
    expect(res.status).toBe(400);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("is idempotent without a write when no link exists", async () => {
    freshAccount(account({ password: "digest" }));
    const res = await discordUnlink();
    expect(res.status).toBe(200);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 when a concurrent write wins the snapshot race", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    mocks.updateOne.mockResolvedValue({ acknowledged: true, matchedCount: 0 });
    expect((await discordUnlink()).status).toBe(409);
  });

  it("returns a generic 503 on a rejected write", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    mocks.updateOne.mockRejectedValueOnce(new Error("synthetic write failure"));
    const res = await discordUnlink();
    expect(res.status).toBe(503);
    expect(noStore(res)).toContain("no-store");
    // Post-write eviction must run even on throw: the write may have
    // committed despite the network error.
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("evicts after an unacknowledged write and returns 503", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    mocks.updateOne.mockResolvedValue({ acknowledged: false, matchedCount: 0 });
    const res = await discordUnlink();
    expect(res.status).toBe(503);
    expect(noStore(res)).toContain("no-store");
    expect(mocks.invalidateCachedUser).toHaveBeenCalledTimes(2);
  });

  it("marks the outer error path no-store", async () => {
    freshAccount(account({ googleId: "g1", discordId: "d1" }));
    mocks.getDb.mockRejectedValueOnce(new Error("synthetic db failure"));
    const res = await discordUnlink();
    expect(res.status).toBe(500);
    expect(noStore(res)).toContain("no-store");
  });
});

describe("provider link lookup failures", () => {
  it.each([
    ["google", googleGet],
    ["discord", discordGet],
  ] as const)(
    "returns a private retry outcome when %s account lookup fails",
    async (_provider, get) => {
      mocks.getAuthUser.mockRejectedValue(new Error("synthetic account lookup unavailable"));
      const output = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await get();
        expect(response.headers.get("location")).toContain("reason=exchange_failed");
        expect(noStore(response)).toContain("no-store");
        expect(mocks.updateOne).not.toHaveBeenCalled();
        expect(JSON.stringify(output.mock.calls)).not.toContain(
          "synthetic account lookup unavailable"
        );
      } finally {
        output.mockRestore();
      }
    }
  );
});
