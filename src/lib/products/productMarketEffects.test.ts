import { describe, expect, it } from "vitest";
import { PRODUCT_BRAND_REF, PRODUCT_NEUTRAL_QUALITY, effectsForStage } from "./lifecycle";
import type { CorporationProduct } from "./types";
import {
  applyProductClearingEffect,
  productLoyaltyBonus,
  resolveProductClearingEffects,
} from "./productMarketEffects";

function product(overrides: Partial<CorporationProduct> = {}): CorporationProduct {
  return {
    id: "p1",
    corporationId: "corp1",
    kindId: "passenger_car",
    name: "Model One",
    stage: "growth",
    startedTurn: 10,
    developmentSpendAnchor: 0,
    developmentAdvertisingAnchor: 0,
    developmentAdvertisingTurns: 0,
    ...overrides,
  };
}

describe("resolveProductClearingEffects", () => {
  it("is empty when the feature is off", () => {
    expect(resolveProductClearingEffects([product()], false).size).toBe(0);
  });

  it("excludes development, retired, and unknown-kind products", () => {
    const products = [
      product({ id: "dev", stage: "development" }),
      product({ id: "ret", stage: "retired" }),
      product({ id: "unk", kindId: "bus" }),
    ];
    expect(resolveProductClearingEffects(products, true).size).toBe(0);
  });

  it("resolves bounded effects for a post-launch product", () => {
    const effects = resolveProductClearingEffects(
      [product({ launchQuality: 70, productBrand: PRODUCT_BRAND_REF })],
      true
    );
    const effect = effects.get("corp1");
    expect(effect).toMatchObject({
      corporationId: "corp1",
      outputCommodity: "vehicles",
      launchQuality: 70,
      loyaltyBonus: 50,
      stage: "growth",
    });
    const expected = effectsForStage({
      stage: "growth",
      launchQuality: 70,
      productBrand: PRODUCT_BRAND_REF,
    });
    expect(effect?.demandMultiplier).toBe(expected.demandMultiplier);
    expect(effect?.priceDefenseMultiplier).toBe(expected.priceDefenseMultiplier);
  });

  it("falls back to neutral quality and zero bonus on hostile values", () => {
    const effects = resolveProductClearingEffects(
      [product({ launchQuality: NaN, productBrand: NaN })],
      true
    );
    expect(effects.get("corp1")).toMatchObject({
      launchQuality: PRODUCT_NEUTRAL_QUALITY,
      loyaltyBonus: 0,
    });
  });

  it("keeps the first product per corporation", () => {
    const effects = resolveProductClearingEffects(
      [product({ id: "a" }), product({ id: "b", corporationId: "corp1" })],
      true
    );
    expect(effects.size).toBe(1);
    expect(effects.get("corp1")?.productId).toBe("a");
  });
});

describe("productLoyaltyBonus", () => {
  it("is zero for missing or hostile brand and saturates below 100", () => {
    expect(productLoyaltyBonus(0)).toBe(0);
    expect(productLoyaltyBonus(-50)).toBe(0);
    expect(productLoyaltyBonus(NaN)).toBe(0);
    expect(productLoyaltyBonus(undefined)).toBe(0);
    expect(productLoyaltyBonus(1e15)).toBeLessThanOrEqual(100);
  });
});

describe("applyProductClearingEffect", () => {
  const vehicles = { vehicles: 0.5, software: 0.08 };

  it("returns inputs unchanged without an effect, off flags, or a non-selling sector", () => {
    const base = {
      brandLoyalty: 20,
      outputQuality: 60,
      loyaltyEnabled: true,
      qualityEnabled: true,
    };
    expect(applyProductClearingEffect({ ...base })).toEqual({
      brandLoyalty: 20,
      outputQuality: 60,
    });
    const effect = resolveProductClearingEffects([product({ launchQuality: 80 })], true).get(
      "corp1"
    );
    expect(
      applyProductClearingEffect({ ...base, effect, loyaltyEnabled: false, qualityEnabled: false })
    ).toEqual({ brandLoyalty: 20, outputQuality: 60 });
    expect(
      applyProductClearingEffect({
        ...base,
        effect,
        supplyRates: { steel: 0.4 },
      })
    ).toEqual({ brandLoyalty: 20, outputQuality: 60 });
  });

  it("moves no cash, output, or inventory by itself", () => {
    const input = [product({ launchQuality: 80, productBrand: 5000 })];
    const before = JSON.stringify(input);
    const effects = resolveProductClearingEffects(input, true);
    expect(JSON.stringify(input)).toBe(before);

    // The effect carries only quality/loyalty adjustments for output that
    // was already produced: no cash, output, capacity, or inventory fields.
    const effect = effects.get("corp1")!;
    expect(Object.keys(effect).sort()).toEqual(
      [
        "corporationId",
        "productId",
        "kindId",
        "outputCommodity",
        "launchQuality",
        "loyaltyBonus",
        "demandMultiplier",
        "priceDefenseMultiplier",
        "stage",
      ].sort()
    );

    const applyArgs = {
      effect,
      supplyRates: vehicles,
      brandLoyalty: 20,
      outputQuality: 60,
      loyaltyEnabled: true,
      qualityEnabled: true,
    };
    const argsBefore = JSON.stringify(applyArgs);
    const adjusted = applyProductClearingEffect(applyArgs);
    expect(JSON.stringify(applyArgs)).toBe(argsBefore);
    expect(Object.keys(adjusted).sort()).toEqual(["brandLoyalty", "outputQuality"]);
  });

  it("applies launch quality and a bounded loyalty bonus on the product output", () => {
    const effect = resolveProductClearingEffects(
      [product({ launchQuality: 80, productBrand: PRODUCT_BRAND_REF })],
      true
    ).get("corp1");
    const adjusted = applyProductClearingEffect({
      effect,
      supplyRates: vehicles,
      brandLoyalty: 90,
      outputQuality: 40,
      loyaltyEnabled: true,
      qualityEnabled: true,
    });
    expect(adjusted.outputQuality).toBe(80);
    expect(adjusted.brandLoyalty).toBe(100);
  });
});
