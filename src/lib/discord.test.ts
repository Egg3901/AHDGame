import { describe, expect, it } from "vitest";
import { toAbsoluteUploadUrl } from "./discord";

const BASE = "https://ahousedividedgame.com";

describe("toAbsoluteUploadUrl", () => {
  it("returns null for empty/missing values", () => {
    expect(toAbsoluteUploadUrl(null, BASE)).toBeNull();
    expect(toAbsoluteUploadUrl(undefined, BASE)).toBeNull();
    expect(toAbsoluteUploadUrl("", BASE)).toBeNull();
  });

  it("prefixes a root-relative upload path with the base URL", () => {
    expect(toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", BASE)).toBe(
      "https://ahousedividedgame.com/api/uploads/avatars/abc.webp"
    );
  });

  it("prefixes a bare filename (no leading slash) with a single separator", () => {
    expect(toAbsoluteUploadUrl("avatar.png", BASE)).toBe(
      "https://ahousedividedgame.com/avatar.png"
    );
  });

  it("passes through already-absolute http(s) URLs unchanged", () => {
    expect(toAbsoluteUploadUrl("https://cdn.example.com/a.png", BASE)).toBe(
      "https://cdn.example.com/a.png"
    );
    expect(toAbsoluteUploadUrl("http://cdn.example.com/a.png", BASE)).toBe(
      "http://cdn.example.com/a.png"
    );
  });

  it("does not produce a double slash when the base has a trailing slash", () => {
    expect(toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", `${BASE}/`)).toBe(
      "https://ahousedividedgame.com/api/uploads/avatars/abc.webp"
    );
  });

  it("yields a URL that the WHATWG URL parser accepts (Discord-embeddable)", () => {
    const out = toAbsoluteUploadUrl("/api/uploads/avatars/abc.webp", BASE);
    expect(() => new URL(out!)).not.toThrow();
  });
});
