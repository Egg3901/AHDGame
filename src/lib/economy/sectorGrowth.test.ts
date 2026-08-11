import { describe, expect, it } from "vitest";
import { avgGrowthTone, formatAvgGrowth, meanGrowth } from "./sectorGrowth";

describe("formatAvgGrowth", () => {
  it("signs positive growth and fixes two decimals", () => {
    expect(formatAvgGrowth(2.45)).toBe("+2.45%");
  });

  it("keeps the negative sign", () => {
    expect(formatAvgGrowth(-1.3)).toBe("-1.30%");
  });

  it("renders zero unsigned", () => {
    expect(formatAvgGrowth(0)).toBe("0.00%");
  });

  it("renders an em-dash when growth is unknown", () => {
    expect(formatAvgGrowth(null)).toBe("—");
  });
});

describe("avgGrowthTone", () => {
  it("is success when positive, error when negative", () => {
    expect(avgGrowthTone(0.1)).toBe("success");
    expect(avgGrowthTone(-0.1)).toBe("error");
  });

  it("is neutral at zero or when unknown", () => {
    expect(avgGrowthTone(0)).toBe("neutral");
    expect(avgGrowthTone(null)).toBe("neutral");
  });
});

describe("meanGrowth", () => {
  it("averages the rates to two decimals", () => {
    expect(meanGrowth([3, 1])).toBe(2);
    expect(meanGrowth([2.5, 1.5, 1])).toBeCloseTo(1.67, 2);
  });

  it("returns null for an empty list", () => {
    expect(meanGrowth([])).toBeNull();
  });
});
