import { describe, expect, it } from "vitest";
import { calibratedPoolTarget, poolLiquidityAllocation } from "./poolTarget";

describe("pool calibration", () => {
  it("initializes a new uncalibrated pool rather than preserving a zero placeholder", () => {
    expect(
      calibratedPoolTarget({
        previousLiquidityTarget: 0,
        latestM2: 10000,
        latestVersion: 2,
        share: 0.05,
      }).liquidityTargetLocal
    ).toBe(500);
  });
  it("retains legacy share-based sizing until the method changes", () => {
    expect(
      calibratedPoolTarget({ previousLiquidityTarget: 999, latestM2: 10000, share: 0.05 })
        .liquidityTargetLocal
    ).toBe(500);
  });
  it("preserves a calibrated target on the method boundary and scales later real growth", () => {
    const adopted = calibratedPoolTarget({
      previousLiquidityTarget: 1000,
      previousM2: 1000000,
      latestM2: 2000,
      latestVersion: 2,
      share: 0.05,
    });
    expect(adopted).toEqual({
      liquidityTargetLocal: 1000,
      m2Local: 2000,
      poolAccountingVersion: 2,
    });
    expect(
      calibratedPoolTarget({
        previousLiquidityTarget: 1000,
        previousM2: 2000,
        previousVersion: 2,
        latestM2: 4000,
        latestVersion: 2,
        share: 0.05,
      }).liquidityTargetLocal
    ).toBe(2000);
  });
  it("keeps bond rollover floors out of secondary liquidity", () => {
    expect(
      poolLiquidityAllocation({ calibratedTarget: 100, m2Local: 2000, share: 0.05, fallback: 5000 })
    ).toBe(100);
    expect(poolLiquidityAllocation({ m2Local: 2000, share: 0.05, fallback: 5000 })).toBe(100);
  });
  it("preserves existing targets without a usable money observation", () => {
    expect(
      calibratedPoolTarget({
        previousLiquidityTarget: 1000,
        previousVersion: 2,
        latestM2: Number.NaN,
        share: 0.05,
      })
    ).toEqual({ liquidityTargetLocal: 1000 });
  });
});
