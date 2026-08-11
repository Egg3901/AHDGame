import { describe, expect, it } from "vitest";
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
