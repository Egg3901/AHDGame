import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "./assertSameOrigin";

function req(headers: Record<string, string>): Request {
  return new Request("https://ahd.example/api/whatever", { method: "POST", headers });
}

describe("assertSameOrigin", () => {
  const original = { base: process.env.NEXT_PUBLIC_BASE_URL, allowed: process.env.ALLOWED_ORIGINS };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.ALLOWED_ORIGINS;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_BASE_URL = original.base;
    process.env.ALLOWED_ORIGINS = original.allowed;
  });

  it("allows requests with no Origin/Referer header", () => {
    expect(assertSameOrigin(req({ host: "ahd.example" }))).toBeNull();
  });

  it("allows same-origin requests (Origin host matches Host)", () => {
    expect(
      assertSameOrigin(req({ host: "ahd.example", origin: "https://ahd.example" }))
    ).toBeNull();
  });

  it("falls back to Referer when Origin is absent", () => {
    expect(
      assertSameOrigin(req({ host: "ahd.example", referer: "https://ahd.example/some/page" }))
    ).toBeNull();
  });

  it("rejects cross-origin requests with 403", () => {
    const res = assertSameOrigin(req({ host: "ahd.example", origin: "https://evil.example" }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it("allows an origin in the ALLOWED_ORIGINS env (host or full URL)", () => {
    process.env.ALLOWED_ORIGINS = "https://trusted.example, other.example";
    expect(
      assertSameOrigin(req({ host: "ahd.example", origin: "https://trusted.example" }))
    ).toBeNull();
    expect(
      assertSameOrigin(req({ host: "ahd.example", origin: "https://other.example" }))
    ).toBeNull();
  });

  it("allows the NEXT_PUBLIC_BASE_URL host even when Host differs", () => {
    process.env.NEXT_PUBLIC_BASE_URL = "https://ahd.example";
    expect(
      assertSameOrigin(req({ host: "internal-lb:3000", origin: "https://ahd.example" }))
    ).toBeNull();
  });
});
