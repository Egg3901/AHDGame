import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { ObjectId } from "mongodb";

const { findOne, getDb, key } = vi.hoisted(() => ({
  findOne: vi.fn(),
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
    getDb.mockResolvedValue({ collection: () => ({ findOne }) });
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
      { projection: { username: 1, email: 1, isBanned: 1, authRevokedAt: 1 } }
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
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
  ])("rejects deleted, banned and revoked users", async (user) => {
    findOne.mockResolvedValue(user);
    expect((await GET(request(`auth-token-test=${await token()}`))).status).toBe(401);
  });

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
