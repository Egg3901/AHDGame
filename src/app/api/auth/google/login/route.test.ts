import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_OAUTH_RETURN_URL_COOKIE } from "@/lib/auth/lakesideLoginReturn";

vi.mock("@/lib/utils/network", () => ({
  getBaseUrl: vi.fn().mockReturnValue("https://ahousedividedgame.com"),
  getClientIp: vi.fn().mockResolvedValue("203.0.113.5"),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("@/lib/google", () => ({
  getGoogleOAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth"),
}));
vi.mock("@/lib/auth", () => ({
  getOAuthStateCookieOptions: vi.fn().mockResolvedValue({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  }),
}));

const cookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ set: cookieSet, get: () => undefined, delete: () => {} }),
}));

const LAKESIDE_RETURN =
  "https://auth.ahousedividedgame.com/auth/ahd?return=https%3A%2F%2Fops.lakesidegames.net%2Fauth%2Fcallback";

describe("GET /api/auth/google/login — Lakeside returnTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client";
    process.env.GOOGLE_REDIRECT_URI = "https://ahousedividedgame.com/api/auth/google/callback";
  });

  it("stashes an allowlisted Lakeside returnTo in the oauth return cookie", async () => {
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        `https://ahousedividedgame.com/api/auth/google/login?returnTo=${encodeURIComponent(LAKESIDE_RETURN)}`
      )
    );
    expect(res.status).toBe(307);
    expect(cookieSet).toHaveBeenCalledWith(
      GOOGLE_OAUTH_RETURN_URL_COOKIE,
      LAKESIDE_RETURN,
      expect.any(Object)
    );
  });

  it("ignores evil returnTo values", async () => {
    const { GET } = await import("./route");
    await GET(
      new Request(
        "https://ahousedividedgame.com/api/auth/google/login?returnTo=" +
          encodeURIComponent("https://evil.example/")
      )
    );
    const returnCookieCalls = cookieSet.mock.calls.filter(
      (c) => c[0] === GOOGLE_OAUTH_RETURN_URL_COOKIE
    );
    expect(returnCookieCalls).toHaveLength(0);
  });
});
