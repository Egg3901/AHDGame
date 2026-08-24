import { describe, expect, it } from "vitest";
import { isAdSenseContentPath } from "@/lib/adsenseContent";

describe("isAdSenseContentPath", () => {
  it("allows only reviewed editorial pages", () => {
    expect(isAdSenseContentPath("/about")).toBe(true);
    expect(isAdSenseContentPath("/faq")).toBe(true);
    expect(isAdSenseContentPath("/guides")).toBe(true);
    expect(isAdSenseContentPath("/guides/corporations")).toBe(true);
  });

  it("keeps game, account, live-feed, and community routes ad-free", () => {
    expect(isAdSenseContentPath("/")).toBe(false);
    expect(isAdSenseContentPath("/dashboard")).toBe(false);
    expect(isAdSenseContentPath("/login")).toBe(false);
    expect(isAdSenseContentPath("/news")).toBe(false);
    expect(isAdSenseContentPath("/wiki/getting-started")).toBe(false);
    expect(isAdSenseContentPath("/guides-and-more")).toBe(false);
  });

  it("tolerates trailing slashes and query strings", () => {
    expect(isAdSenseContentPath("/guides/corporations/")).toBe(true);
    expect(isAdSenseContentPath("/guides?ref=nav")).toBe(true);
  });
});
