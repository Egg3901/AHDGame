import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  computeMacroProductionPolicy,
  makeNppCorpDecision,
  sectorShortageScore,
  type CommodityPriceRatioFn,
} from "./nppCorporationBehavior";
import { ceoArchetypeModifiers } from "./ceoArchetype";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation, CorporateSector } from "@/lib/db/types";

/** Build a price-ratio fn from a fixed commodity→ratio map. */
function ratios(map: Partial<Record<CommodityType, number>>): CommodityPriceRatioFn {
  return (commodity) => map[commodity] ?? null;
}

describe("computeMacroProductionPolicy", () => {
  it("ramps production when the supplied commodity trades at a premium", () => {
    // agriculture supplies food; price 40% above base → strong positive, capped at 25.
    const target = computeMacroProductionPolicy("agriculture", "US", ratios({ food: 1.4 }));
    expect(target).toBe(25);
  });

  it("returns 0 on glut — never commands lean-ops contraction from price", () => {
    // Depressed food price used to drive productionPolicy to −25. That lever's
    // intentional input>output cut asymmetry worsens economy-wide gluts and
    // pinned NPC sectors at max contraction for ~98 turns (GH #3370).
    const target = computeMacroProductionPolicy("agriculture", "US", ratios({ food: 0.7 }));
    expect(target).toBe(0);
  });

  it("returns 0 within the price deadband (ignores market noise)", () => {
    expect(computeMacroProductionPolicy("agriculture", "US", ratios({ food: 1.02 }))).toBe(0);
    expect(computeMacroProductionPolicy("agriculture", "US", ratios({ food: 0.98 }))).toBe(0);
  });

  it("weights multi-commodity sectors by supply rate", () => {
    // manufacturing supplies steel (0.4) + building_materials (0.2).
    // steel +25%, building_materials flat → weightedDev = 0.4*0.25 / 0.6 ≈ 0.1667
    // 0.1667 * 75 ≈ 12.5 → 13 (lower than the 19 a steel-only read would give).
    const target = computeMacroProductionPolicy(
      "manufacturing",
      "US",
      ratios({ steel: 1.25, building_materials: 1.0 })
    );
    expect(target).toBe(13);
  });

  it("returns null when no price signal is available (leave policy untouched)", () => {
    // agriculture has a supply mapping, but no price for food → null.
    expect(computeMacroProductionPolicy("agriculture", "US", ratios({}))).toBeNull();
  });

  it("prefers the national price ratio via the provided fn (country-scoped)", () => {
    const fn: CommodityPriceRatioFn = (commodity, countryId) =>
      commodity === "food" && countryId === "JP" ? 1.5 : null;
    expect(computeMacroProductionPolicy("agriculture", "JP", fn)).toBe(25);
    expect(computeMacroProductionPolicy("agriculture", "US", fn)).toBeNull();
  });
});

describe("sectorShortageScore", () => {
  // Re-import here for clarity; same module as above.
  it("scores shortage premium above 1 and glut below 1", () => {
    expect(sectorShortageScore("agriculture", "US", ratios({ food: 1.4 }))).toBeCloseTo(1.4, 10);
    expect(sectorShortageScore("agriculture", "US", ratios({ food: 0.7 }))).toBeCloseTo(0.7, 10);
  });

  it("weights multi-output sectors by supply rate", () => {
    // manufacturing: steel 0.4 @1.25, building_materials 0.2 @1.0
    // → (0.4*1.25 + 0.2*1.0) / 0.6 ≈ 1.1667
    expect(
      sectorShortageScore("manufacturing", "US", ratios({ steel: 1.25, building_materials: 1.0 }))
    ).toBeCloseTo((0.4 * 1.25 + 0.2 * 1.0) / 0.6, 10);
  });

  it("returns neutral 1 with no price signal (unpriced types rank neither up nor down)", () => {
    expect(sectorShortageScore("agriculture", "US", ratios({}))).toBe(1);
  });
});

describe("makeNppCorpDecision — fill-awareness (chronic low fill, t899)", () => {
  function decide(sectorOverrides: Partial<CorporateSector>, priceRatioOf: CommodityPriceRatioFn) {
    const corp = {
      _id: new ObjectId(),
      countryId: "US",
      type: "agriculture",
      headquartersState: "CA",
      liquidCapital: 50_000_000,
      ceoType: "npp",
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      sectorType: "agriculture",
      countryId: "US",
      stateId: "CA",
      revenue: 10_000_000,
      profitMargin: 30, // strong band → would normally accelerate
      targetGrowthRate: 3,
      ...sectorOverrides,
    } as unknown as CorporateSector;
    return makeNppCorpDecision(
      {
        corp,
        sectors: [sector],
        turn: 100,
        now: new Date(),
        modifiers: ceoArchetypeModifiers("cautious"),
      },
      new Map(),
      new Set<string>(),
      priceRatioOf
    );
  }

  it("caps the production policy at 0 despite a shortage premium", () => {
    // food at 1.4× base would normally push productionPolicy to +25 —
    // but the sector only sold 20% of its output last turn.
    const decision = decide({ soldFraction: 0.2, productionPolicy: 10 }, ratios({ food: 1.4 }));
    const policyUpdate = decision.sectorUpdates.find((u) => "productionPolicy" in u.update.$set);
    expect(policyUpdate?.update.$set.productionPolicy).toBe(0);
  });

  it("does not raise the growth target of a low-fill sector", () => {
    // Strong margin + shortage signal would normally bump growth to 5.
    const decision = decide({ soldFraction: 0.2 }, ratios({ food: 1.4 }));
    const growthUpdate = decision.sectorUpdates.find((u) => "targetGrowthRate" in u.update.$set);
    // Capped at min(current 3, 1) = 1 — reduced, never raised.
    expect(growthUpdate?.update.$set.targetGrowthRate).toBe(1);
  });

  it("leaves a well-filled sector's levers untouched by the cap", () => {
    const decision = decide({ soldFraction: 0.95 }, ratios({ food: 1.4 }));
    const growthUpdate = decision.sectorUpdates.find((u) => "targetGrowthRate" in u.update.$set);
    const policyUpdate = decision.sectorUpdates.find((u) => "productionPolicy" in u.update.$set);
    expect(growthUpdate?.update.$set.targetGrowthRate).toBe(5);
    expect(policyUpdate?.update.$set.productionPolicy).toBe(25);
  });
});

describe("makeNppCorpDecision — glut must not pin productionPolicy negative", () => {
  function decide(sectorOverrides: Partial<CorporateSector>, priceRatioOf: CommodityPriceRatioFn) {
    const corp = {
      _id: new ObjectId(),
      countryId: "US",
      type: "agriculture",
      headquartersState: "CA",
      liquidCapital: 50_000_000,
      ceoType: "npp",
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      sectorType: "agriculture",
      countryId: "US",
      stateId: "CA",
      revenue: 10_000_000,
      profitMargin: 30,
      targetGrowthRate: 3,
      ...sectorOverrides,
    } as unknown as CorporateSector;
    return makeNppCorpDecision(
      {
        corp,
        sectors: [sector],
        turn: 100,
        now: new Date(),
        modifiers: ceoArchetypeModifiers("cautious"),
      },
      new Map(),
      new Set<string>(),
      priceRatioOf
    );
  }

  it("does not set productionPolicy negative on a glut price signal", () => {
    const decision = decide({ productionPolicy: 0 }, ratios({ food: 0.7 }));
    const policyUpdate = decision.sectorUpdates.find((u) => "productionPolicy" in u.update.$set);
    // No update needed when already 0; if present, must not be negative.
    if (policyUpdate) {
      expect(policyUpdate.update.$set.productionPolicy).toBeGreaterThanOrEqual(0);
    }
  });

  it("walks a sector already pinned at −25 back to 0 under sustained glut", () => {
    // Recovery path for worlds already stuck from the pre-fix NPP policy.
    const decision = decide(
      { productionPolicy: -25, productionPolicyLevel: -25 },
      ratios({ food: 0.7 })
    );
    const policyUpdate = decision.sectorUpdates.find((u) => "productionPolicy" in u.update.$set);
    expect(policyUpdate?.update.$set.productionPolicy).toBe(0);
  });
});
