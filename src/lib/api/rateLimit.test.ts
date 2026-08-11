import { describe, it, expect } from "vitest";
import { checkRateLimit, rateLimitHeaders, rateLimitResponse, AUTH_LIMITS } from "./rateLimit";

describe("checkRateLimit", () => {
  it("returns ok for first request", () => {
    const result = checkRateLimit("test-ip-1", 10, 60000);
    expect(result.ok).toBe(true);
  });

  it("returns ok within limit", () => {
    const id = "test-ip-2";
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(id, 10, 60000);
      expect(result.ok).toBe(true);
    }
  });

  it("returns not ok when over limit", () => {
    const id = "test-ip-3";
    for (let i = 0; i < 10; i++) {
      checkRateLimit(id, 10, 60000);
    }
    const result = checkRateLimit(id, 10, 60000);
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });

  it("returns ok for unknown/empty identifier", () => {
    expect(checkRateLimit("", 10, 60000).ok).toBe(true);
    expect(checkRateLimit("unknown", 10, 60000).ok).toBe(true);
  });

  it("AUTH_LIMITS has expected shape", () => {
    expect(AUTH_LIMITS.maxRequests).toBe(10);
    expect(AUTH_LIMITS.windowMs).toBe(60000);
  });

  it("reports limit/remaining/resetAt", () => {
    const id = "meta-ip-1";
    const first = checkRateLimit(id, 5, 60000);
    expect(first.limit).toBe(5);
    expect(first.remaining).toBe(4);
    expect(first.resetAt).toBeGreaterThan(Date.now());

    const second = checkRateLimit(id, 5, 60000);
    expect(second.remaining).toBe(3);
  });

  it("reports remaining 0 when over limit", () => {
    const id = "meta-ip-2";
    for (let i = 0; i < 5; i++) checkRateLimit(id, 5, 60000);
    const over = checkRateLimit(id, 5, 60000);
    expect(over.ok).toBe(false);
    expect(over.remaining).toBe(0);
  });
});

describe("rateLimitHeaders", () => {
  it("builds X-RateLimit-* headers, reset in epoch seconds", () => {
    const resetAt = 1_700_000_500_000;
    const headers = rateLimitHeaders({ limit: 60, remaining: 12, resetAt });
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("12");
    expect(headers["X-RateLimit-Reset"]).toBe(String(Math.ceil(resetAt / 1000)));
  });
});

describe("rateLimitResponse", () => {
  it("always sets Retry-After and 429 status", () => {
    const res = rateLimitResponse(30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("includes X-RateLimit-* headers when meta is provided", () => {
    const res = rateLimitResponse(30, undefined, {
      limit: 60,
      remaining: 0,
      resetAt: 1_700_000_000_000,
    });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("X-RateLimit-Reset")).toBe("1700000000");
  });

  it("omits X-RateLimit-* headers when no meta is provided", () => {
    const res = rateLimitResponse(30);
    expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
  });
});
