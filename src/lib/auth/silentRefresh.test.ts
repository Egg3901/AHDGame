import { describe, expect, it, vi } from "vitest";
import { SignJWT, jwtVerify } from "jose";
import { refreshSessionPreservingIssuedAt, type SilentRefreshClaims } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ findUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/db/collections", () => ({
  getUsersCollection: async () => ({ findOne: mocks.findUser }),
  getCharactersCollection: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getValidatedEnv: vi.fn() }));
const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "test-secret-placeholder");
const CLAIMS: SilentRefreshClaims = {
  userId: "507f1f77bcf86cd799439011",
  email: "player@example.com",
  username: "player",
  role: "player",
  isAdmin: false,
};

async function authorizeAtCutoff(token: string, cutoff: Date) {
  mocks.findUser.mockResolvedValue({
    _id: CLAIMS.userId,
    ...CLAIMS,
    authRevokedAt: cutoff,
  });
  const { getAuthUserFromToken } = await import("@/lib/auth");
  return getAuthUserFromToken(token);
}

async function sign(options: {
  iat?: number | false | string;
  exp?: number;
  userId?: string;
  extra?: Record<string, unknown>;
}): Promise<string> {
  const payload: Record<string, unknown> = {
    userId: options.userId ?? CLAIMS.userId,
    email: CLAIMS.email,
    username: CLAIMS.username,
    role: CLAIMS.role,
    isAdmin: CLAIMS.isAdmin,
    ...options.extra,
  };
  if (typeof options.iat === "string") {
    payload.iat = options.iat;
  }
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (typeof options.iat === "number") {
    jwt = jwt.setIssuedAt(options.iat);
  }
  const exp = options.exp ?? Math.floor(Date.now() / 1000) + 3600;
  return jwt.setExpirationTime(exp).sign(SECRET);
}

describe("refreshSessionPreservingIssuedAt", () => {
  it("preserves the verified sign-in iat and is accepted before cutoff, denied after", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const signInIat = nowSec - 3600;
    const token = await sign({ iat: signInIat, exp: nowSec + 1800 });

    const result = await refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.iat).toBe(signInIat);
    const { payload } = await jwtVerify(result.token, SECRET, { algorithms: ["HS256"] });
    expect(payload.iat).toBe(signInIat);
    expect(payload.userId).toBe(CLAIMS.userId);
    expect(typeof payload.exp).toBe("number");
    expect((payload.exp as number) - nowSec).toBeGreaterThan(6 * 24 * 60 * 60);
    expect((payload.exp as number) - nowSec).toBeLessThanOrEqual(7 * 24 * 60 * 60 + 5);

    const cutoffBefore = new Date((signInIat - 10) * 1000);
    const cutoffAfter = new Date((signInIat + 10) * 1000);
    expect((await authorizeAtCutoff(result.token, cutoffBefore))?.userId).toBe(CLAIMS.userId);
    expect(await authorizeAtCutoff(result.token, cutoffAfter)).toBeNull();
  });

  it("keeps the original iat when signing after a later logout cutoff", async () => {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const signInIat = nowSec - 3600;
    const token = await sign({ iat: signInIat, exp: nowSec + 1800 });

    const logoutAt = new Date(nowMs - 50);
    const lateSignAt = nowMs + 2500;
    const result = await refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET, lateSignAt);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.iat).toBe(signInIat);
    expect(result.iat).toBeLessThanOrEqual(Math.floor(lateSignAt / 1000));
    expect(await authorizeAtCutoff(result.token, logoutAt)).toBeNull();
    // A fresh but valid timestamp on the same session would bypass this real
    // validator. (A future iat is no longer a valid contrast: session
    // verification rejects it before revocation is even checked.)
    const unsafe = await sign({ iat: nowSec - 10, exp: nowSec + 1800 });
    expect((await authorizeAtCutoff(unsafe, new Date((signInIat + 10) * 1000)))?.userId).toBe(
      CLAIMS.userId
    );
  });

  it("does not claim a later iat than the original verified sign-in", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const signInIat = nowSec - 120;
    const token = await sign({ iat: signInIat, exp: nowSec + 60 });
    const result = await refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.iat).toBe(signInIat);
    expect(result.iat).toBeLessThanOrEqual(nowSec);
  });

  it("copies the current DB principal roles while preserving the original iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const signInIat = nowSec - 3600;
    // Old token minted when the account was a plain player.
    const token = await sign({ iat: signInIat, exp: nowSec + 1800 });
    // The caller sources these from the current DB record, which now shows admin.
    const dbClaims: SilentRefreshClaims = { ...CLAIMS, role: "admin", isAdmin: true };

    const result = await refreshSessionPreservingIssuedAt(token, dbClaims, SECRET);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.iat).toBe(signInIat);
    const { payload } = await jwtVerify(result.token, SECRET, { algorithms: ["HS256"] });
    expect(payload.iat).toBe(signInIat);
    expect(payload.role).toBe("admin");
    expect(payload.isAdmin).toBe(true);
  });

  it("skips refresh when more than a day of expiry remains", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ iat: nowSec - 10, exp: nowSec + 2 * 24 * 60 * 60 });
    await expect(refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET)).resolves.toEqual({
      ok: false,
      reason: "not_due",
    });
  });

  it("fails closed on missing iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ iat: false, exp: nowSec + 1800 });
    await expect(refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET)).resolves.toEqual({
      ok: false,
      reason: "invalid_iat",
    });
  });

  it("fails closed on a non-integer iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ iat: "not-a-time", exp: nowSec + 1800 });
    await expect(refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET)).resolves.toEqual({
      ok: false,
      reason: "invalid_iat",
    });
  });

  it("fails closed on a future iat instead of copying it forward", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ iat: nowSec + 120, exp: nowSec + 1800 });
    await expect(
      refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET, nowSec * 1000)
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_iat",
    });
  });

  it("fails closed on a non-integer numeric iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      ...CLAIMS,
      iat: nowSec - 10.5,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(nowSec + 1800)
      .sign(SECRET);
    await expect(refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET)).resolves.toEqual({
      ok: false,
      reason: "invalid_iat",
    });
  });

  it("fails closed when the token user does not match the caller", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({
      iat: nowSec - 10,
      exp: nowSec + 1800,
      userId: "507f1f77bcf86cd799439099",
    });
    await expect(refreshSessionPreservingIssuedAt(token, CLAIMS, SECRET)).resolves.toEqual({
      ok: false,
      reason: "invalid_iat",
    });
  });
});
