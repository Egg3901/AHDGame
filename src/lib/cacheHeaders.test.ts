import { describe, expect, it } from "vitest";
import { PRIVATE_PAGE_CACHE_CONTROL } from "./cacheHeaders";

describe("PRIVATE_PAGE_CACHE_CONTROL", () => {
  it("is never eligible for browser or shared-cache storage", () => {
    expect(PRIVATE_PAGE_CACHE_CONTROL).toContain("private");
    expect(PRIVATE_PAGE_CACHE_CONTROL).toContain("no-store");
    expect(PRIVATE_PAGE_CACHE_CONTROL).toContain("max-age=0");
    expect(PRIVATE_PAGE_CACHE_CONTROL).not.toContain("public");
    expect(PRIVATE_PAGE_CACHE_CONTROL).not.toContain("s-maxage");
  });

  it("allows origin compression without changing cache eligibility", () => {
    expect(PRIVATE_PAGE_CACHE_CONTROL).not.toContain("no-transform");
  });
});
