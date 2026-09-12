import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { ObjectId } from "mongodb";

const { findOne, findSession, getDb, key } = vi.hoisted(() => ({
  findOne: vi.fn(),
  findSession: vi.fn(),
  getDb: vi.fn(),
  key: new TextEncoder().encode("synthetic-session-test-signing-key"),
}));
vi.mock("@/lib/auth", () => ({ getJwtSecret: () => key }));
vi.mock("@/lib/authCookieName", () => ({ AUTH_COOKIE_NAME: "auth-token-test" }));
vi.mock("@/lib/mongodb", () => ({ getDb }));

import { GET } from "./route";

const id = new ObjectId("000000000000000000000001");
const now = Math.floor(Date.now() / 1000);
async function token(overrides: Record<string, unknown> = {}, algorithm = "HS256") {
  return new SignJWT({ userId: id.toHexString(), iat: now - 10, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: algorithm })
    .sign(key);
}
function request(cookie: string) {
  return new Request("https://game.example/api/auth/session", { headers: { cookie } });
}

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    findOne.mockResolvedValue({
      _id: id,
      username: "current-name",
      email: "current@example.invalid",
    });
    findSession.mockResolvedValue(null);
    getDb.mockResolvedValue({
      collection: (name: string) => ({
        findOne: name === "unifiedSessions" ? findSession : findOne,
      }),
    });
  });

  it("returns current identity and contact email without token privilege claims, with one projected read", async () => {
    const response = await GET(
      request(
        `auth-token-test=${await token({ username: "old-name", email: "fixture@example.invalid", isAdmin: true })}`
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      active: true,
      sub: id.toHexString(),
      username: "current-name",
      email: "current@example.invalid",
      iat: now - 10,
      exp: now + 300,
    });
    expect(findOne).toHaveBeenCalledExactlyOnceWith(
      { _id: id },
      {
        projection: { username: 1, email: 1, isBanned: 1, authRevokedAt: 1, authMigrationFence: 1 },
      }
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts a migrated player's current unified game session for the Ask broker", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    findOne.mockResolvedValue({ _id: id, username: "current-name", authMigrationFence: {} });
    findSession.mockResolvedValue({ _id: sid, userId: id.toHexString() });
    const response = await GET(
      request(`auth-token-test=${await token({ authSource: "unified", sid })}`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ active: true, sub: id.toHexString() });
    expect(findSession).toHaveBeenCalledExactlyOnceWith({
      _id: sid,
      userId: id.toHexString(),
      revokedAt: null,
      expiresAt: { $gt: expect.any(Date) },
    });
  });

  it.each([
    { authSource: "unified" },
    { authSource: "unified", sid: "invalid" },
    { authSource: "other", sid: "11111111-1111-4111-8111-111111111111" },
  ])("rejects incomplete or malformed unified session claims %j", async (claims) => {
    expect((await GET(request(`auth-token-test=${await token(claims)}`))).status).toBe(401);
    expect(findSession).not.toHaveBeenCalled();
  });

  it("requires the unified session to remain live on every broker check", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    findOne.mockResolvedValue({ _id: id, username: "current-name", authMigrationFence: {} });
    findSession
      .mockResolvedValueOnce({ _id: sid, userId: id.toHexString() })
      .mockResolvedValue(null);
    const cookie = `auth-token-test=${await token({ authSource: "unified", sid })}`;
    expect((await GET(request(cookie))).status).toBe(200);
    // Missing, expired, revoked and wrong-owner sessions cannot match the
    // live-session query asserted in the successful migration test.
    expect((await GET(request(cookie))).status).toBe(401);
    expect(findSession).toHaveBeenCalledTimes(2);
  });

  it("keeps revocation cutoffs in force for a current unified session", async () => {
    const sid = "11111111-1111-4111-8111-111111111111";
    findOne.mockResolvedValue({
      _id: id,
      username: "current-name",
      authMigrationFence: {},
      authRevokedAt: new Date(now * 1000),
    });
    findSession.mockResolvedValue({ _id: sid, userId: id.toHexString() });
    expect(
      (await GET(request(`auth-token-test=${await token({ authSource: "unified", sid })}`))).status
    ).toBe(401);
  });

  it("reports unified session storage outages without treating them as invalid credentials", async () => {
    findOne.mockResolvedValue({ _id: id, username: "current-name", authMigrationFence: {} });
    findSession.mockRejectedValue(new Error("sensitive unified session storage error"));
    const response = await GET(
      request(
        `auth-token-test=${await token({ authSource: "unified", sid: "11111111-1111-4111-8111-111111111111" })}`
      )
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Session check unavailable" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects another deployment's cookie and duplicate cookies before database access", async () => {
    const signed = await token();
    for (const cookie of [
      "",
      `auth-token-other=${signed}`,
      `auth-token-test=${signed}; auth-token-test=${signed}`,
      "auth-token-test=%ZZ",
    ]) {
      const response = await GET(request(cookie));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ active: false });
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([
    { exp: undefined },
    { iat: undefined },
    { exp: now - 1 },
    { iat: now + 120 },
    { iat: now + 1, exp: now + 1 },
    { iat: now - 0.5 },
    { nbf: now + 120 },
    { userId: "invalid-id" },
  ])("rejects invalid mandatory claims %j before database access", async (claims) => {
    expect((await GET(request(`auth-token-test=${await token(claims)}`))).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a different algorithm and invalid signature", async () => {
    expect((await GET(request(`auth-token-test=${await token({}, "HS384")}`))).status).toBe(401);
    const forged = await new SignJWT({ userId: id.toHexString(), iat: now, exp: now + 300 })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("other-synthetic-signing-key"));
    expect((await GET(request(`auth-token-test=${forged}`))).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { _id: id, username: "current-name", isBanned: true },
    { _id: id, username: "current-name", authRevokedAt: new Date((now - 10) * 1000) },
    { _id: id, username: "current-name", authRevokedAt: new Date(now * 1000) },
    { _id: id, username: "current-name", authMigrationFence: {} },
    { _id: id, username: "current-name", authMigrationFence: null },
    { _id: id, username: "current-name", authMigrationFence: "malformed" },
  ])("rejects deleted, banned and revoked users", async (user) => {
    findOne.mockResolvedValue(user);
    expect((await GET(request(`auth-token-test=${await token()}`))).status).toBe(401);
  });

  it.each([0, false, "", "2026-01-01", {}, new Date(NaN)])(
    "rejects malformed revocation state %j",
    async (authRevokedAt) => {
      findOne.mockResolvedValue({ _id: id, username: "current-name", authRevokedAt });
      const response = await GET(request(`auth-token-test=${await token()}`));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
  );

  it("rechecks revocation on the next request and accepts authentication after revocation", async () => {
    const cookie = `auth-token-test=${await token()}`;
    expect((await GET(request(cookie))).status).toBe(200);
    findOne.mockResolvedValue({
      _id: id,
      username: "current-name",
      authRevokedAt: new Date((now - 5) * 1000),
    });
    expect((await GET(request(cookie))).status).toBe(401);
    expect((await GET(request(`auth-token-test=${await token({ iat: now })}`))).status).toBe(200);
    expect(findOne).toHaveBeenCalledTimes(3);
  });

  it("rejects the original token after reauth while the cutoff remains, and accepts a same-second fresh iat", async () => {
    const cutoff = new Date(now * 1000 + 400);
    findOne.mockResolvedValue({
      _id: id,
      username: "current-name",
      email: "current@example.invalid",
      authRevokedAt: cutoff,
    });
    expect((await GET(request(`auth-token-test=${await token({ iat: now })}`))).status).toBe(401);
    expect(
      (await GET(request(`auth-token-test=${await token({ iat: now + 1, exp: now + 300 })}`)))
        .status
    ).toBe(200);
  });

  it("reports outages separately without clearing the browser cookie or exposing errors", async () => {
    findOne.mockRejectedValue(new Error("sensitive database error"));
    const response = await GET(request(`auth-token-test=${await token()}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Session check unavailable" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
