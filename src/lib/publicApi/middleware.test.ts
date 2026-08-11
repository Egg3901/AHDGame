import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/requireBotToken", () => ({
  requirePublicBotToken: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/api/rateLimit", () => ({
  rateLimitResponse: vi.fn(),
  rateLimitHeaders: vi.fn().mockReturnValue({ "X-RateLimit-Limit": "60" }),
  BOT_READ_LIMITS: { maxRequests: 60, windowMs: 60_000 },
}));

vi.mock("@/lib/api/rateLimit.mongo", () => ({
  durableRateLimit: vi
    .fn()
    .mockResolvedValue({ ok: true, limit: 60, remaining: 59, resetAt: 1_700_000_000_000 }),
}));

vi.mock("@/lib/api/userApiAuth", () => ({
  validateUserApiKey: vi.fn().mockResolvedValue({ valid: false }),
}));

vi.mock("@/lib/api/accessLog", () => ({
  logApiAccess: vi.fn(),
}));

describe("publicApiGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no auth is provided", async () => {
    const { requirePublicBotToken } = await import("@/lib/api/requireBotToken");
    const { validateUserApiKey } = await import("@/lib/api/userApiAuth");
    vi.mocked(requirePublicBotToken).mockReturnValue(false);
    vi.mocked(validateUserApiKey).mockResolvedValue({ valid: false } as never);

    const { publicApiGuard } = await import("./middleware");
    const result = await publicApiGuard(new Request("http://localhost"), "test");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected guard failure");
    const body = await result.response.json();
    expect(body.ok).toBe(false);
    expect(result.response.status).toBe(401);
  });

  it("returns ok with rate-limit headers when user API key is valid", async () => {
    const { validateUserApiKey } = await import("@/lib/api/userApiAuth");
    const { durableRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(validateUserApiKey).mockResolvedValue({
      valid: true,
      ownerUserId: "user123",
    } as never);
    vi.mocked(durableRateLimit).mockResolvedValue({
      ok: true,
      limit: 60,
      remaining: 59,
      resetAt: 1_700_000_000_000,
    });

    const { publicApiGuard } = await import("./middleware");
    const result = await publicApiGuard(new Request("http://localhost"), "test");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected guard success");
    expect(result.headers["X-RateLimit-Limit"]).toBe("60");
    expect(durableRateLimit).toHaveBeenCalledWith("user-api:test:user123", 60, 60_000);
  });

  it("falls back to bot token when no user API key", async () => {
    const { requirePublicBotToken } = await import("@/lib/api/requireBotToken");
    const { validateUserApiKey } = await import("@/lib/api/userApiAuth");
    const { durableRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(validateUserApiKey).mockResolvedValue({ valid: false } as never);
    vi.mocked(requirePublicBotToken).mockReturnValue(true);
    vi.mocked(durableRateLimit).mockResolvedValue({
      ok: true,
      limit: 60,
      remaining: 59,
      resetAt: 1_700_000_000_000,
    });

    const { publicApiGuard } = await import("./middleware");
    const result = await publicApiGuard(new Request("http://localhost"), "test");

    expect(result.ok).toBe(true);
    expect(durableRateLimit).toHaveBeenCalledWith("public:v1:test", 60, 60_000);
  });

  it("returns rate-limit response when limit exceeded", async () => {
    const { requirePublicBotToken } = await import("@/lib/api/requireBotToken");
    const { validateUserApiKey } = await import("@/lib/api/userApiAuth");
    const { rateLimitResponse } = await import("@/lib/api/rateLimit");
    const { durableRateLimit } = await import("@/lib/api/rateLimit.mongo");
    vi.mocked(validateUserApiKey).mockResolvedValue({ valid: false } as never);
    vi.mocked(requirePublicBotToken).mockReturnValue(true);
    vi.mocked(durableRateLimit).mockResolvedValue({
      ok: false,
      limit: 60,
      remaining: 0,
      resetAt: 1_700_000_000_000,
      retryAfter: 30,
    });
    const mockRlRes = new Response(null, { status: 429 }) as never;
    vi.mocked(rateLimitResponse).mockReturnValue(mockRlRes);

    const { publicApiGuard } = await import("./middleware");
    const result = await publicApiGuard(new Request("http://localhost"), "test");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected guard failure");
    expect(result.response).toBe(mockRlRes);
  });
});
