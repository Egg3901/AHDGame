import { describe, it, expect } from "vitest";
import { plantCrewShare, plantRunShare } from "./plantRunShare";

describe("plantRunShare", () => {
  it("is the demand throttle times input throughput, capped at 1", () => {
    expect(plantRunShare({ demandThrottleFactor: 0.5, throughputFactor: 0.85 })).toBeCloseTo(
      0.425,
      10
    );
    expect(plantRunShare({ demandThrottleFactor: 1, throughputFactor: 1.2 })).toBe(1);
  });

  it("treats non-finite input as a full run", () => {
    expect(plantRunShare({ demandThrottleFactor: Number.NaN, throughputFactor: 1 })).toBe(1);
  });
});

describe("plantCrewShare", () => {
  const base = { demandThrottleFactor: 1, throughputFactor: 1, ramp: 1, floor: 0.25 };

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
});
