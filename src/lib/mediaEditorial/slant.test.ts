import { describe, expect, it } from "vitest";
import {
  SLANT_MAX_FAVORABILITY_BONUS,
  SLANT_MAX_PRICE_DISCOUNT,
  advertisingFavorabilityFactor,
  applySlantToAdvertise,
  advertisingPriceFactor,
  reachWeightedSlant,
  slantDistance,
} from "./slant";

describe("reachWeightedSlant", () => {
  it("weights newsrooms by size and ignores neutral ones for direction", () => {
    const slant = reachWeightedSlant([
      { stance: { economic: 4, social: 0 }, weight: 3 },
      { stance: { economic: -2, social: 0 }, weight: 1 },
      { stance: { economic: 0, social: 0 }, weight: 4 },
    ])!;
    expect(slant.economic).toBeCloseTo((4 * 3 - 2) / 4);
    expect(slant.strength).toBeCloseTo(0.5);
  });

  it("returns null when nobody has taken a stance", () => {
    expect(reachWeightedSlant([{ stance: undefined, weight: 5 }])).toBeNull();
    expect(reachWeightedSlant([])).toBeNull();
  });
});

describe("advertising effects", () => {
  const right = { economic: 5, social: 5, strength: 1 };

  it("is cheaper and more persuasive the closer the advertiser is", () => {
    const near = advertisingPriceFactor({ economic: 5, social: 5 }, right);
    const mid = advertisingPriceFactor({ economic: 3, social: 3 }, right);
    const far = advertisingPriceFactor({ economic: -5, social: -5 }, right);
    expect(near).toBeCloseTo(1 - SLANT_MAX_PRICE_DISCOUNT);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(far).toBe(1);
    const favNear = advertisingFavorabilityFactor({ economic: 5, social: 5 }, right);
    expect(favNear).toBeCloseTo(1 + SLANT_MAX_FAVORABILITY_BONUS);
    expect(advertisingFavorabilityFactor({ economic: -5, social: -5 }, right)).toBe(1);
  });

  it("scales with how much of the local press is slanted and stays bounded", () => {
    const weak = { ...right, strength: 0.4 };
    expect(advertisingPriceFactor({ economic: 5, social: 5 }, weak)).toBeCloseTo(
      1 - SLANT_MAX_PRICE_DISCOUNT * 0.4
    );
    expect(
      advertisingPriceFactor({ economic: 5, social: 5 }, { ...right, strength: 9 })
    ).toBeGreaterThanOrEqual(1 - SLANT_MAX_PRICE_DISCOUNT);
    expect(advertisingPriceFactor({ economic: 0, social: 0 }, null)).toBe(1);
    expect(advertisingFavorabilityFactor(undefined, null)).toBe(1);
  });

  it("measures distance on the same axes as the editorial audience fit", () => {
    expect(slantDistance({ economic: 5, social: 5 }, { economic: -5, social: -5 })).toBe(1);
    expect(slantDistance({ economic: 1, social: 1 }, { economic: 1, social: 1 })).toBe(0);
  });
});

describe("applySlantToAdvertise", () => {
  const right = { economic: 5, social: 5, strength: 1 };

  it("cuts price and lifts the gain by at most 15% at full closeness", () => {
    const out = applySlantToAdvertise(-1000, 10, { economic: 5, social: 5 }, right)!;
    expect(out.cost).toBeCloseTo(850);
    expect(out.favorabilityGain).toBe(11.5);
    expect(out.cutPct).toBe(15);
  });

  it("gives nothing without a stance match or local slant", () => {
    expect(applySlantToAdvertise(-1000, 10, { economic: 0, social: 0 }, null)).toBeNull();
    expect(applySlantToAdvertise(-1000, 10, { economic: -5, social: -5 }, right)).toBeNull();
  });

  it("scales the gain bonus with newsroom saturation", () => {
    const out = applySlantToAdvertise(
      -1000,
      10,
      { economic: 5, social: 5 },
      { ...right, strength: 0.4 }
    )!;
    expect(out.favorabilityGain).toBe(10.6);
  });
});
