import { describe, expect, it, vi } from "vitest";

const requireBasicAuth = vi.fn();
const getCookie = vi.fn();

vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: getCookie })) }));
vi.mock("@/lib/auth", () => ({
  getDesktopLinkCookieOptions: vi.fn(async () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 604800,
    path: "/api/client/account",
    domain: ".ahousedividedgame.com",
  })),
}));

describe("POST /api/client/link-session", () => {
  it("copies an authenticated session into the cookie shape supported by desktop 2.0.3", async () => {
    requireBasicAuth.mockResolvedValueOnce({ ok: true, user: { userId: "user-1" } });
    getCookie.mockReturnValueOnce({ value: "production-jwt" });
    const { POST } = await import("./route");

    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("auth-token=production-jwt");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/client/account");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
