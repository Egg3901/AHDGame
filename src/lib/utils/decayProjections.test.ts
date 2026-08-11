import { describe, it, expect } from "vitest";
import {
  projectInfluenceDecay,
  projectFavorabilityDecay,
  projectInfamyDecay,
} from "./decayProjections";

describe("projectInfluenceDecay", () => {
  it("returns correct decay for non-zero PI", () => {
    const result = projectInfluenceDecay(100);
    expect(result.current).toBe(100);
    expect(result.decayAmount).toBe(0.75);
    expect(result.projected).toBe(99.25);
    expect(result.isDecaying).toBe(true);
  });

  it("floors projected at 0", () => {
    const result = projectInfluenceDecay(0);
    expect(result.projected).toBe(0);
    expect(result.isDecaying).toBe(false);
  });
});

describe("projectFavorabilityDecay", () => {
  it("returns no decay when FAV is at or below threshold", () => {
    // calculateFavorabilityAboveThresholdPenalty returns 0 at or below 60
    const result = projectFavorabilityDecay(60);
    expect(result.decayAmount).toBe(0);
    expect(result.isDecaying).toBe(false);
  });

  it("returns decay when FAV is above threshold", () => {
    const result = projectFavorabilityDecay(80);
    expect(result.current).toBe(80);
    expect(result.decayAmount).toBeGreaterThan(0);
    expect(result.projected).toBeLessThan(80);
    expect(result.isDecaying).toBe(true);
  });
});

describe("projectInfamyDecay", () => {
  it("decays infamy by 5% per turn", () => {
    const result = projectInfamyDecay(20);
    expect(result.decayAmount).toBe(1);
    expect(result.projected).toBe(19);
    expect(result.isDecaying).toBe(true);
  });

  it("returns no decay for zero infamy", () => {
    const result = projectInfamyDecay(0);
    expect(result.isDecaying).toBe(false);
  });
});
