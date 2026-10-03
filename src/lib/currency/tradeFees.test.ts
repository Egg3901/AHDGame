import { describe, expect, it } from "vitest";
import {
  liquidityFeeMultiplier,
  playerTradeFeeRate,
  recentVolumeAnchorOf,
  sizeFeeRate,
} from "./tradeFees";

describe("sizeFeeRate", () => {
  it("is almost nothing for an everyday trade", () => {
    // ₳61M, the median manual trade: about 0.06%.
    expect(sizeFeeRate(61_000_000)).toBeCloseTo(0.2 * (61e6 / 2e10), 5);
    expect(sizeFeeRate(61_000_000)).toBeLessThan(0.001);
  });

  it("reaches most of its maximum for a fortune-sized trade (ticket 1364)", () => {
    // ₳400B: 0.2 * (1 - (10/400) * ln(41)) = 18.1%.
    expect(sizeFeeRate(400_000_000_000)).toBeCloseTo(0.2 * (1 - (10 / 400) * Math.log(41)), 10);
    expect(sizeFeeRate(400_000_000_000)).toBeGreaterThan(0.18);
  });

  it("costs the same whether a conversion is made at once or split", () => {
    const total = 120_000_000_000;
    const whole = sizeFeeRate(total) * total;
    let prior = 0;
    let split = 0;
    for (let i = 0; i < 12; i++) {
      const slice = total / 12;
      split += sizeFeeRate(slice, prior) * slice;
      prior += slice;
    }
    expect(split).toBeCloseTo(whole, 0);
  });

  it("charges a later trade more when the trader already converted a lot", () => {
    expect(sizeFeeRate(1e9, 50e9)).toBeGreaterThan(sizeFeeRate(1e9, 0));
  });

  it("is zero for an empty or invalid trade, and never negative", () => {
    expect(sizeFeeRate(0)).toBe(0);
    expect(sizeFeeRate(Number.NaN)).toBe(0);
    expect(sizeFeeRate(0.01)).toBeGreaterThanOrEqual(0);
  });
});

describe("liquidityFeeMultiplier", () => {
  it("is neutral without data and at the reference volume", () => {
    expect(liquidityFeeMultiplier(undefined)).toBe(1);
    expect(liquidityFeeMultiplier(null)).toBe(1);
    expect(liquidityFeeMultiplier(100_000_000)).toBeCloseTo(1, 10);
  });

  it("charges more in a quiet market and less in a busy one, within bounds", () => {
    expect(liquidityFeeMultiplier(1_000_000)).toBe(1.5);
    expect(liquidityFeeMultiplier(0)).toBe(1.5);
    expect(liquidityFeeMultiplier(400_000_000)).toBeCloseTo(0.5, 10);
    expect(liquidityFeeMultiplier(10_000_000_000)).toBe(0.5);
  });
});

describe("playerTradeFeeRate", () => {
  it("leaves an ordinary trade in a reference market near the plain spread", () => {
    const rate = playerTradeFeeRate({
      baseSpread: 0.01,
      tradeAnchor: 1_000_000,
      fromVolumeAnchor: 100_000_000,
      toVolumeAnchor: 100_000_000,
    });
    expect(rate).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.0101);
  });

  it("uses the quieter of the two legs", () => {
    const busyBoth = playerTradeFeeRate({
      baseSpread: 0.01,
      tradeAnchor: 1_000,
      fromVolumeAnchor: 400_000_000,
      toVolumeAnchor: 400_000_000,
    });
    const quietLeg = playerTradeFeeRate({
      baseSpread: 0.01,
      tradeAnchor: 1_000,
      fromVolumeAnchor: 400_000_000,
      toVolumeAnchor: 1_000,
    });
    expect(busyBoth).toBeCloseTo(0.005, 6);
    expect(quietLeg).toBeCloseTo(0.015, 6);
  });

  it("takes over a quarter of a fortune-sized hop in a quiet market (ticket 1364)", () => {
    // (1% + 18.1%) * 1.5 for a ₳400B conversion into a thin currency.
    const rate = playerTradeFeeRate({
      baseSpread: 0.01,
      tradeAnchor: 400_000_000_000,
      fromVolumeAnchor: 2_000_000,
      toVolumeAnchor: 2_000_000,
    });
    expect(rate).toBeGreaterThan(0.28);
    expect(rate).toBeLessThanOrEqual(0.3);
  });

  it("never charges more than 30%", () => {
    expect(
      playerTradeFeeRate({
        baseSpread: 0.015,
        tradeAnchor: 10_000_000_000_000,
        fromVolumeAnchor: 1,
        toVolumeAnchor: 1,
      })
    ).toBe(0.3);
  });
});

describe("recentVolumeAnchorOf", () => {
  it("sums the stored buy and sell volume, or is null without either", () => {
    expect(recentVolumeAnchorOf({ buyVolume24: 3, sellVolume24: 4 })).toBe(7);
    expect(recentVolumeAnchorOf({ buyVolume24: 3 })).toBe(3);
    expect(recentVolumeAnchorOf({ rate: 1 })).toBeNull();
    expect(recentVolumeAnchorOf(null)).toBeNull();
  });
});
