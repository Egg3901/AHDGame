import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieDelete, findOneAndDelete, getDb } = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  findOneAndDelete: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    delete: cookieDelete,
    get: vi.fn().mockReturnValue(undefined),
  }),
}));
vi.mock("@/lib/mongodb", () => ({ getDb }));

describe("GET /api/auth/oidc/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UNIFIED_OIDC_ENABLED = "true";
    process.env.UNIFIED_OIDC_ISSUER = "https://issuer.example/realms/accounts";
    process.env.UNIFIED_OIDC_CLIENT_ID = "ahd-web";
    process.env.UNIFIED_OIDC_CLIENT_SECRET = "secret";
    process.env.UNIFIED_OIDC_REDIRECT_URI = "https://game.example/api/auth/oidc/callback";
    findOneAndDelete.mockResolvedValue({
      state: "valid-state",
      nonce: "nonce",
      verifier: "verifier",
      expiresAt: new Date(Date.now() + 60_000),
    });
    getDb.mockResolvedValue({
      collection: vi.fn().mockReturnValue({ findOneAndDelete }),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
  });

  it("consumes one-use server state when Safari omits the bounce cookie", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "https://game.example/api/auth/oidc/callback?code=authorization-code&state=valid-state"
      )
    );

    expect(findOneAndDelete).toHaveBeenCalledWith({
      state: "valid-state",
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(response.headers.get("location")).toBe(
      "https://game.example/login?error=unified_exchange"
    );
  });
});
