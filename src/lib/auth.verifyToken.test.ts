/**
 * Strict session-token validation, exercised against real JOSE signatures
 * (no `jose` mock): HS256 only, iat+exp required, sane time values, and a
 * current silent-refresh token still verifies with its original iat.
 */
import { describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import {
  refreshSessionPreservingIssuedAt,
  verifyAuthToken,
  type SilentRefreshClaims,
} from "@/lib/auth";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: async () => ({}) }));
vi.mock("@/lib/db/collections", () => ({
  getUsersCollection: vi.fn(),
  getCharactersCollection: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ getValidatedEnv: vi.fn() }));

const SECRET = new TextEncoder().encode(process.env.AUTH_SECRET ?? "test-secret-placeholder");
const USER_ID = "507f1f77bcf86cd799439011";
const BASE = {
  userId: USER_ID,
  email: "player@example.com",
  username: "player",
  role: "player",
  isAdmin: false,
};
const CLAIMS: SilentRefreshClaims = {
  userId: USER_ID,
  email: BASE.email,
  username: BASE.username,
  role: BASE.role,
  isAdmin: false,
};

function sign(payload: Record<string, unknown>, alg = "HS256", key: Uint8Array = SECRET) {
  return new SignJWT(payload).setProtectedHeader({ alg }).sign(key);
}

describe("verifyAuthToken strict validation (real JOSE)", () => {
  it("accepts a valid HS256 token with iat+exp", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec - 10, exp: nowSec + 300 });
    const result = await verifyAuthToken(token);
    expect(result).toMatchObject({ userId: USER_ID, username: "player" });
  });

  it("returns null when exp is missing", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec - 10 });
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it("returns null when iat is missing", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, exp: nowSec + 300 });
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it("returns null for a future iat that JOSE alone would accept", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec + 120, exp: nowSec + 600 });
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid issued-at value %s",
    async (iat) => {
      const token = await sign({ ...BASE, iat, exp: Math.floor(Date.now() / 1000) + 300 });
      await expect(verifyAuthToken(token)).resolves.toBeNull();
    }
  );

  it("preserves the explicitly long-lived offline session contract", async () => {
    const iat = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat, exp: iat + 10 * 365 * 86400 });
    await expect(verifyAuthToken(token)).resolves.toMatchObject({ userId: USER_ID, iat });
  });

  it("returns null for exp not after iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec - 10, exp: nowSec - 10 });
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it("returns null for the wrong algorithm", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec - 10, exp: nowSec + 300 }, "HS384");
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it("returns null when expired", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await sign({ ...BASE, iat: nowSec - 600, exp: nowSec - 10 });
    await expect(verifyAuthToken(token)).resolves.toBeNull();
  });

  it("accepts a current silent-refresh token with its preserved original iat", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const signInIat = nowSec - 3600;
    const aging = await sign({ ...BASE, iat: signInIat, exp: nowSec + 1800 });
    const refreshed = await refreshSessionPreservingIssuedAt(aging, CLAIMS, SECRET);
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.iat).toBe(signInIat);
    const result = await verifyAuthToken(refreshed.token);
    expect(result).toMatchObject({ userId: USER_ID, iat: signInIat });
  });
});
