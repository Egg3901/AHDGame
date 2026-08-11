import { describe, it, expect } from "vitest";
import {
  normalizeMetricValue,
  getBarColor,
  getTrendColor,
  formatMetricValue,
  trimDescription,
} from "./lib";

describe("normalizeMetricValue", () => {
  it("maps min to 0", () => {
    expect(normalizeMetricValue(0, 0, 100)).toBe(0);
  });
  it("maps max to 100", () => {
    expect(normalizeMetricValue(100, 0, 100)).toBe(100);
  });
  it("maps midpoint to 50", () => {
    expect(normalizeMetricValue(10, 0, 20)).toBe(50);
  });
  it("clamps below min to 0", () => {
    expect(normalizeMetricValue(-5, 0, 100)).toBe(0);
  });
  it("clamps above max to 100", () => {
    expect(normalizeMetricValue(150, 0, 100)).toBe(100);
  });
  it("handles non-zero min range", () => {
    expect(normalizeMetricValue(75, 60, 90)).toBeCloseTo(50);
  });
  it("returns 50 when min equals max to avoid division by zero", () => {
    expect(normalizeMetricValue(5, 5, 5)).toBe(50);
  });
});

describe("getBarColor", () => {
  it("returns green when normalized is high and higherIsBetter", () => {
    expect(getBarColor(80, true)).toBe("green");
  });
  it("returns amber in middle range when higherIsBetter", () => {
    expect(getBarColor(50, true)).toBe("amber");
  });
  it("returns red when normalized is low and higherIsBetter", () => {
    expect(getBarColor(20, true)).toBe("red");
  });
  it("returns green when normalized is low and higherIsBetter=false", () => {
    expect(getBarColor(20, false)).toBe("green");
  });
  it("returns red when normalized is high and higherIsBetter=false", () => {
    expect(getBarColor(80, false)).toBe("red");
  });
  it("uses 65 threshold for green boundary", () => {
    expect(getBarColor(66, true)).toBe("green");
    expect(getBarColor(64, true)).toBe("amber");
  });
  it("uses 35 threshold for red boundary", () => {
    expect(getBarColor(36, true)).toBe("amber");
    expect(getBarColor(34, true)).toBe("red");
  });
});

describe("getTrendColor", () => {
  it("returns good when trend is positive and higherIsBetter", () => {
    expect(getTrendColor(1.5, true)).toBe("good");
  });
  it("returns bad when trend is positive and higherIsBetter=false", () => {
    expect(getTrendColor(1.5, false)).toBe("bad");
  });
  it("returns bad when trend is negative and higherIsBetter", () => {
    expect(getTrendColor(-1.5, true)).toBe("bad");
  });
  it("returns good when trend is negative and higherIsBetter=false", () => {
    expect(getTrendColor(-1.5, false)).toBe("good");
  });
  it("returns neutral when |trend| < 0.1", () => {
    expect(getTrendColor(0.05, true)).toBe("neutral");
    expect(getTrendColor(-0.05, false)).toBe("neutral");
    expect(getTrendColor(0, true)).toBe("neutral");
  });
});

describe("formatMetricValue", () => {
  it("formats percent with one decimal and % sign", () => {
    expect(formatMetricValue(4.2, "percent")).toBe("4.2%");
  });
  it("formats years with one decimal and yrs suffix", () => {
    expect(formatMetricValue(78.4, "years")).toBe("78.4 yrs");
  });
  it("formats index with one decimal", () => {
    expect(formatMetricValue(63.7, "index")).toBe("63.7");
  });
  it("formats rate with one decimal", () => {
    expect(formatMetricValue(12.3, "rate")).toBe("12.3");
  });
  it("formats number with locale string", () => {
    expect(formatMetricValue(65000, "number")).toBe("65,000");
  });
});

describe("trimDescription", () => {
  it("returns first two sentences", () => {
    const desc =
      "Leads U.S. foreign policy. Represents the United States in foreign affairs. Advises the President on international matters.";
    const result = trimDescription(desc);
    expect(result).toBe(
      "Leads U.S. foreign policy. Represents the United States in foreign affairs."
    );
  });
  it("does not break on U.S. abbreviation", () => {
    const desc =
      "Manages the U.S. Mint and Bureau. Produces currency for the nation. Other sentence.";
    const result = trimDescription(desc);
    expect(result).toBe("Manages the U.S. Mint and Bureau. Produces currency for the nation.");
  });
  it("handles single-sentence description gracefully", () => {
    const desc = "Single sentence only.";
    expect(trimDescription(desc)).toBe("Single sentence only.");
  });
  it("ends with a period", () => {
    const desc = "First sentence here. Second sentence here. Third sentence.";
    expect(trimDescription(desc)).toMatch(/\.$/);
  });
});
