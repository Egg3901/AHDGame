import { describe, it, expect } from "vitest";
import { formatMetricValue } from "./formatMetricValue";

describe("formatMetricValue", () => {
  it("applies suffix and decimals", () => {
    expect(formatMetricValue({ formatSuffix: "%", decimals: 1 }, 4)).toBe("4.0%");
  });

  it("applies a currency prefix with grouping and zero decimals", () => {
    expect(formatMetricValue({ formatPrefix: "$", decimals: 0 }, 50000)).toBe("$50,000");
  });

  it("overrides the $ prefix with the country's currency symbol", () => {
    expect(formatMetricValue({ formatPrefix: "$", decimals: 0 }, 50000, "UK")).toBe("£50,000");
  });

  it("defaults to one decimal when unspecified", () => {
    expect(formatMetricValue({}, 12.34)).toBe("12.3");
  });
});
