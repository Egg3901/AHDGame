import { describe, it, expect } from "vitest";
import { plantCrewShare, plantRunShare } from "./plantRunShare";

describe("plantRunShare", () => {
  it("is the demand throttle, capped at 1", () => {
    expect(plantRunShare({ demandThrottleFactor: 0.5 })).toBeCloseTo(0.5, 10);
    expect(plantRunShare({ demandThrottleFactor: 1.2 })).toBe(1);
  });

  it("treats non-finite input as a full run", () => {
    expect(plantRunShare({ demandThrottleFactor: Number.NaN })).toBe(1);
  });
});

describe("plantCrewShare", () => {
  const base = { demandThrottleFactor: 1, ramp: 1, floor: 0.25 };

  it("returns exactly 1 at a full run at any ramp", () => {
    for (const ramp of [0, 0.3, 1]) expect(plantCrewShare({ ...base, ramp })).toBe(1);
  });

  it("never drops below the floor", () => {
    expect(plantCrewShare({ ...base, demandThrottleFactor: 0.1 })).toBe(0.25);
  });

  it("follows the run above the floor", () => {
    expect(plantCrewShare({ ...base, demandThrottleFactor: 0.6 })).toBeCloseTo(0.6, 10);
  });

  it("is an exact no-op on the flip turn (ramp 0)", () => {
    expect(plantCrewShare({ ...base, demandThrottleFactor: 0.1, ramp: 0 })).toBe(1);
  });

  it("fades the reduction in with the ramp", () => {
    expect(plantCrewShare({ ...base, demandThrottleFactor: 0.1, ramp: 0.5 })).toBeCloseTo(
      0.625,
      10
    );
  });

  it("drops by at most maxDropPerTurn a turn toward the target", () => {
    expect(
      plantCrewShare({ ...base, demandThrottleFactor: 0.1, previous: 1, maxDropPerTurn: 0.02 })
    ).toBeCloseTo(0.98, 10);
    expect(
      plantCrewShare({ ...base, demandThrottleFactor: 0.1, previous: 0.26, maxDropPerTurn: 0.02 })
    ).toBe(0.25);
  });

  it("rehires to the target at once when demand returns", () => {
    expect(
      plantCrewShare({ ...base, demandThrottleFactor: 0.9, previous: 0.3, maxDropPerTurn: 0.02 })
    ).toBeCloseTo(0.9, 10);
  });

  it("treats a missing previous share as a full crew", () => {
    expect(
      plantCrewShare({
        ...base,
        demandThrottleFactor: 0.1,
        previous: undefined,
        maxDropPerTurn: 0.02,
      })
    ).toBeCloseTo(0.98, 10);
  });
});
