import { describe, it, expect } from "vitest";
import { classifyDevice, isLikelyBotUserAgent, normalizeAnalyticsPath } from "./siteTraffic";

describe("normalizeAnalyticsPath", () => {
  it("accepts a normal pathname", () => {
    expect(normalizeAnalyticsPath("/dashboard")).toBe("/dashboard");
  });

  it("rejects parent segments", () => {
    expect(normalizeAnalyticsPath("/foo/../bar")).toBeNull();
  });

  it("rejects non-path", () => {
    expect(normalizeAnalyticsPath("no-leading-slash")).toBeNull();
    expect(normalizeAnalyticsPath("")).toBeNull();
    expect(normalizeAnalyticsPath(null)).toBeNull();
  });
});

describe("classifyDevice", () => {
  it("classifies iPhone as mobile", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
      )
    ).toBe("mobile");
  });
  it("classifies iPad as tablet", () => {
    expect(
      classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15")
    ).toBe("tablet");
  });
  it("classifies desktop Chrome", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
      )
    ).toBe("desktop");
  });
  it("classifies missing UA as other", () => {
    expect(classifyDevice(null)).toBe("other");
    expect(classifyDevice("")).toBe("other");
  });
});

describe("isLikelyBotUserAgent", () => {
  it("detects common crawlers", () => {
    expect(isLikelyBotUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isLikelyBotUserAgent("facebookexternalhit/1.1")).toBe(true);
  });

  it("allows normal browsers", () => {
    expect(
      isLikelyBotUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0"
      )
    ).toBe(false);
  });
});
