import { describe, expect, it } from "vitest";
import { COVERAGE_DECAY_PER_TURN } from "./config";
import { clampCoverage, currentCoverage } from "./coverage";

describe("currentCoverage", () => {
  it("returns the stored reading on the collection turn", () => {
    expect(currentCoverage(80, 0)).toBe(80);
  });

  it("decays linearly with elapsed turns", () => {
    expect(currentCoverage(80, 5)).toBe(80 - COVERAGE_DECAY_PER_TURN * 5);
  });

  it("floors at zero rather than going negative", () => {
    expect(currentCoverage(10, 500)).toBe(0);
  });

  it("treats a negative elapsed count as zero elapsed", () => {
    // Clock skew or a replayed turn must never INCREASE coverage.
    expect(currentCoverage(40, -3)).toBe(40);
  });

  it("clamps a stored reading above the maximum", () => {
    expect(currentCoverage(140, 0)).toBe(100);
  });
});

describe("clampCoverage", () => {
  it("rejects a non-finite reading rather than propagating NaN", () => {
    expect(clampCoverage(Number.NaN)).toBe(0);
    expect(clampCoverage(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("holds a value already in range", () => {
    expect(clampCoverage(55)).toBe(55);
  });
});
