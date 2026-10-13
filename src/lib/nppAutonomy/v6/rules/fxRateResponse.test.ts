import { describe, expect, it } from "vitest";
import {
  FX_LOOKBACK_TURNS,
  FX_MAX_ADJUSTMENT,
  fxDepreciation,
  fxRateAdjustment,
} from "./fxRateResponse";

describe("NPP engine 6.6 FX rate response", () => {
  it("measures the move against the newest snapshot at least a lookback old", () => {
    const history = [
      { turn: 60, rate: 1.0 },
      { turn: 70, rate: 1.1 },
      { turn: 90, rate: 1.4 },
    ];
    // At turn 95 the cutoff is 71, so turn 70 (rate 1.1) is the reference.
    expect(fxDepreciation(history, 1.32, 70 + FX_LOOKBACK_TURNS + 1)).toBeCloseTo(0.2, 6);
  });

  it("has no reading without an old enough snapshot", () => {
    expect(fxDepreciation([{ turn: 90, rate: 1 }], 1.2, 95)).toBeNull();
    expect(fxDepreciation(undefined, 1.2, 95)).toBeNull();
  });

  it("ignores moves inside the dead band", () => {
    expect(fxRateAdjustment(0.04)).toBe(0);
    expect(fxRateAdjustment(-0.05)).toBe(0);
    expect(fxRateAdjustment(null)).toBe(0);
  });

  it("raises the target for a fall and lowers it, more gently, for a rise", () => {
    // 20% fall: 15 points past the band x 0.1 = +1.5.
    expect(fxRateAdjustment(0.2)).toBeCloseTo(1.5, 6);
    // 20% rise: half weight, -0.75.
    expect(fxRateAdjustment(-0.2)).toBeCloseTo(-0.75, 6);
  });

  it("caps the shift", () => {
    expect(fxRateAdjustment(2)).toBe(FX_MAX_ADJUSTMENT);
  });
});
