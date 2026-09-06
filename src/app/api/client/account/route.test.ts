import { describe, expect, it, vi } from "vitest";

const requireBasicAuth = vi.fn();
const getAuthUserFromToken = vi.fn();
const findOne = vi.fn();
const getCookie = vi.fn();
const isPatreonActive = vi.fn(() => false);
const isPlusOrBetter = vi.fn(() => false);

vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth }));
vi.mock("@/lib/auth", () => ({ getAuthUserFromToken }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: getCookie })) }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({ collection: () => ({ findOne }) })),
}));
vi.mock("@/lib/db/types", () => ({ isPatreonActive, isPlusOrBetter }));

describe("GET /api/client/account", () => {
  it("rejects unauthenticated WebView requests", async () => {
    const response = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    requireBasicAuth.mockResolvedValueOnce({ ok: false, response });
    const { GET } = await import("./route");

    const result = await GET();

    expect(result.status).toBe(401);
    expect(findOne).not.toHaveBeenCalled();
  });

  it("returns only the desktop account summary", async () => {
    isPatreonActive.mockReturnValueOnce(true);
    requireBasicAuth.mockResolvedValueOnce({
      ok: true,
      user: { userId: "507f1f77bcf86cd799439011" },
    });
    findOne.mockResolvedValueOnce({
      username: "Ada",
      displayName: "Ada Lovelace",
      patreonTier: "supporter",
      patreonExpiresAt: null,
      email: "private@example.com",
    });
    const { GET } = await import("./route");

    const result = await GET();
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({
      linked: true,
      displayName: "Ada Lovelace",
      supporter: true,
      singleplayer: { entitled: false, expiresAt: null },
    });
    expect(body).not.toHaveProperty("email");
  });

  it.each(["supporter-plus", "supporter-plus-plus"])(
    "grants singleplayer to an active %s account without a manual entitlement field",
    async (patreonTier) => {
      requireBasicAuth.mockResolvedValueOnce({
        ok: true,
        user: { userId: "507f1f77bcf86cd799439011" },
      });
      isPatreonActive.mockReturnValueOnce(true);
      isPlusOrBetter.mockReturnValueOnce(true);
      findOne.mockResolvedValueOnce({
        username: "Ada",
        patreonTier,
        patreonExpiresAt: null,
        singleplayerEntitledAt: null,
      });
      const { GET } = await import("./route");

      const body = await (await GET()).json();

      expect(body.supporter).toBe(true);
      expect(body.singleplayer.entitled).toBe(true);
      expect(Date.parse(body.singleplayer.expiresAt)).toBeGreaterThan(Date.now());
    }
  );

  it("accepts the path-scoped compatibility cookie emitted by the link page", async () => {
    requireBasicAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    getCookie.mockReturnValueOnce({ value: "bridge-jwt" });
    getAuthUserFromToken.mockResolvedValueOnce({
      userId: "507f1f77bcf86cd799439011",
      username: "Ada",
    });
    findOne.mockResolvedValueOnce({ username: "Ada", displayName: "Ada" });
    const { GET } = await import("./route");

    const result = await GET();

    expect(result.status).toBe(200);
    expect(getAuthUserFromToken).toHaveBeenCalledWith("bridge-jwt");
  });

  it("returns a bounded offline entitlement window only for entitled accounts", async () => {
    requireBasicAuth.mockResolvedValueOnce({
      ok: true,
      user: { userId: "507f1f77bcf86cd799439011" },
    });
    findOne.mockResolvedValueOnce({
      username: "Ada",
      displayName: "Ada",
      singleplayerEntitledAt: new Date(),
    });
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.singleplayer.entitled).toBe(true);
    expect(Date.parse(body.singleplayer.expiresAt)).toBeGreaterThan(Date.now());
  });
});
