import { describe, it, expect } from "vitest";
import { rescaleOtherOpexAnchorForRetool } from "./physicalPnl";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";

/**
 * P3.5 — the calibrated other-opex residual across a retool.
 *
 * The anchor is ₳ per OUTPUT UNIT. That per-unit basis is what makes it survive
 * capacity growth, throttling, mothballing and sector merges untouched — but a
 * retool changes what a unit IS, and `setSectorStrategy` rescales `capitalStock`
 * by exactly that ratio. Left alone, the anchor would multiply the sector's
 * residual operating cost by the same RPU ratio the unit count moved.
 */
describe("rescaleOtherOpexAnchorForRetool", () => {
  it("holds the ₳ actually charged fixed across the unit rebasing", () => {
    const anchor = 12.5;
    const units = 400;
    const ratio = 8;
    const rescaled = rescaleOtherOpexAnchorForRetool(anchor, ratio)!;
    // capitalStock (and hence producedUnits) moves by `ratio`; anchor × units —
    // the actual bill — must not move at all.
    expect(rescaled * (units * ratio)).toBeCloseTo(anchor * units, 8);
  });

  it("is invertible: retool then cancel returns the original anchor", () => {
    const anchor = 3.75;
    const forward = capacityRescaleRatio("extraction", "standard", "rare_earth_mining");
    const back = capacityRescaleRatio("extraction", "rare_earth_mining", "standard");
    const out = rescaleOtherOpexAnchorForRetool(
      rescaleOtherOpexAnchorForRetool(anchor, forward)!,
      back
    )!;
    expect(out).toBeCloseTo(anchor, 8);
  });

  it("writes nothing for an uncalibrated sector or a degenerate ratio", () => {
    expect(rescaleOtherOpexAnchorForRetool(undefined, 2)).toBeNull();
    expect(rescaleOtherOpexAnchorForRetool(null, 2)).toBeNull();
    expect(rescaleOtherOpexAnchorForRetool(Number.NaN, 2)).toBeNull();
    expect(rescaleOtherOpexAnchorForRetool(5, 0)).toBeNull();
    expect(rescaleOtherOpexAnchorForRetool(5, -1)).toBeNull();
    expect(rescaleOtherOpexAnchorForRetool(5, Number.NaN)).toBeNull();
  });
});
