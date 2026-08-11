import { describe, it, expect } from "vitest";
import { floorCrisisDuration, MIN_CRISIS_DURATION_TURNS } from "./crisisDuration";

describe("floorCrisisDuration", () => {
  it("raises short durations to the minimum", () => {
    expect(floorCrisisDuration(3)).toBe(MIN_CRISIS_DURATION_TURNS);
    expect(floorCrisisDuration(8)).toBe(MIN_CRISIS_DURATION_TURNS);
    expect(floorCrisisDuration(23)).toBe(24);
  });

  it("leaves durations at or above the minimum untouched", () => {
    expect(floorCrisisDuration(24)).toBe(24);
    expect(floorCrisisDuration(48)).toBe(48);
  });

  it("passes indefinite (null) duration through unchanged", () => {
    expect(floorCrisisDuration(null)).toBeNull();
  });
});
