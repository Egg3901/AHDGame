import { afterEach, describe, expect, it } from "vitest";
import { clientIpFromRequest } from "./network";

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("https://example.com", { headers });
}

describe("clientIpFromRequest", () => {
  it("prefers cf-connecting-ip over x-forwarded-for", () => {
    const request = requestWithHeaders({
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "172.69.70.213",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("falls back to x-forwarded-for when cf-connecting-ip is absent", () => {
    const request = requestWithHeaders({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when neither cf-connecting-ip nor x-forwarded-for is set", () => {
    const request = requestWithHeaders({ "x-real-ip": "203.0.113.5" });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("returns unknown when no proxy headers are present", () => {
    const request = requestWithHeaders({});
    expect(clientIpFromRequest(request)).toBe("unknown");
  });

  it("rejects malformed header values instead of passing them through", () => {
    const request = requestWithHeaders({
      "cf-connecting-ip": "<script>alert(1)</script>",
      "x-forwarded-for": "203.0.113.5",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });
});

// Legacy path above runs with CF_ORIGIN_SECRET unset (env validation is
// skipped under NODE_ENV=test). These cases cover the hardened path where the
// secret is configured and only Cloudflare-injected requests may trust
// cf-connecting-ip.
describe("clientIpFromRequest with CF_ORIGIN_SECRET configured", () => {
  afterEach(() => {
    delete process.env.CF_ORIGIN_SECRET;
  });

  it("prefers cf-connecting-ip when the origin secret header matches", () => {
    process.env.CF_ORIGIN_SECRET = "test-origin-secret";
    const request = requestWithHeaders({
      "cf-connecting-ip": "203.0.113.5",
      "x-forwarded-for": "172.69.70.213",
      "x-cf-origin-secret": "test-origin-secret",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("ignores a forged cf-connecting-ip when the secret header is absent", () => {
    process.env.CF_ORIGIN_SECRET = "test-origin-secret";
    const request = requestWithHeaders({
      "cf-connecting-ip": "198.51.100.77",
      "x-forwarded-for": "203.0.113.5",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("ignores a forged cf-connecting-ip when the secret header is wrong", () => {
    process.env.CF_ORIGIN_SECRET = "test-origin-secret";
    const request = requestWithHeaders({
      "cf-connecting-ip": "198.51.100.77",
      "x-forwarded-for": "203.0.113.5",
      "x-cf-origin-secret": "wrong-secret",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when the secret is missing and no other header is usable", () => {
    process.env.CF_ORIGIN_SECRET = "test-origin-secret";
    const request = requestWithHeaders({
      "cf-connecting-ip": "198.51.100.77",
      "x-real-ip": "203.0.113.5",
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });

  // Regression: an attacker-supplied secret header with the same character
  // length but a larger BYTE length (multibyte char) makes the underlying
  // crypto compare throw. The trust check must swallow that and fail closed to
  // the x-forwarded-for path, not 500 the auth route.
  it("fails closed to x-forwarded-for when a same-length multibyte secret header would throw", () => {
    process.env.CF_ORIGIN_SECRET = "0123456789abcdef";
    const forged = "0123456789abcdeé"; // 16 chars, 17 UTF-8 bytes
    expect(forged.length).toBe(process.env.CF_ORIGIN_SECRET.length);
    const request = requestWithHeaders({
      "cf-connecting-ip": "198.51.100.77",
      "x-forwarded-for": "203.0.113.5",
      "x-cf-origin-secret": forged,
    });
    expect(clientIpFromRequest(request)).toBe("203.0.113.5");
  });
});
