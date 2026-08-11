import { describe, it, expect } from "vitest";
import {
  aggregateTechEffects,
  techEffectCategory,
  describeTechEffect,
  TECH_MARGIN_BONUS_CAP_PP,
  TECH_GROWTH_REDUCTION_CAP,
  TECH_LABOR_REDUCTION_CAP,
  type TechEffect,
} from "./effects";

describe("aggregateTechEffects", () => {
  it("caps total margin bonus but keeps the raw sum", () => {
    const effects: TechEffect[] = Array.from({ length: 6 }, () => ({
      kind: "marginBonus" as const,
      pp: 3,
    }));
    const agg = aggregateTechEffects(effects); // raw 18
    expect(agg.marginBonusPpRaw).toBe(18);
    expect(agg.marginBonusPp).toBe(TECH_MARGIN_BONUS_CAP_PP);
  });

  it("caps growth reduction", () => {
    const agg = aggregateTechEffects([
      { kind: "growthCostReduction", pct: 0.5 },
      { kind: "growthCostReduction", pct: 0.5 },
    ]);
    expect(agg.growthCostMultiplier).toBeCloseTo(1 - TECH_GROWTH_REDUCTION_CAP);
  });

  it("sums labor-cost reduction into a multiplier and caps it", () => {
    expect(aggregateTechEffects([]).laborCostMultiplier).toBe(1);
    const partial = aggregateTechEffects([
      { kind: "laborCostReduction", pct: 0.05 },
      { kind: "laborCostReduction", pct: 0.1 },
    ]);
    expect(partial.laborCostMultiplier).toBeCloseTo(0.85);
    const capped = aggregateTechEffects([
      { kind: "laborCostReduction", pct: 0.4 },
      { kind: "laborCostReduction", pct: 0.4 },
    ]);
    expect(capped.laborCostMultiplier).toBeCloseTo(1 - TECH_LABOR_REDUCTION_CAP);
  });

  it("describes and categorizes the labor-cost effect", () => {
    expect(describeTechEffect({ kind: "laborCostReduction", pct: 0.1 })).toContain("labor cost");
    expect(techEffectCategory("laborCostReduction")).toBe("growth");
  });

  it("builds per-commodity input (down) and output (up) multipliers", () => {
    const agg = aggregateTechEffects([
      { kind: "inputCost", commodity: "oil", pct: 0.5 },
      { kind: "inputCost", commodity: "oil", pct: 0.5 }, // stacks multiplicatively → 0.25
      { kind: "outputRate", commodity: "energy", pct: 0.1 },
    ]);
    expect(agg.inputRateMult.oil).toBeCloseTo(0.25);
    expect(agg.outputRateMult.energy).toBeCloseTo(1.1);
  });

  it("sums and caps the shield effects", () => {
    const agg = aggregateTechEffects([
      { kind: "dominanceShield", pct: 0.25 },
      { kind: "dominanceShield", pct: 0.5 }, // 0.75 → capped
      { kind: "tariffShield", pct: 0.3 },
      { kind: "expansionDiscount", pct: 0.2 },
    ]);
    expect(agg.dominanceShield).toBe(0.6); // TECH_SHIELD_CAP
    expect(agg.tariffShield).toBeCloseTo(0.3);
    expect(agg.expansionDiscount).toBeCloseTo(0.2);
  });
});

describe("effect display", () => {
  it("categorizes each kind for the UI icon", () => {
    expect(techEffectCategory("inputCost")).toBe("input");
    expect(techEffectCategory("outputRate")).toBe("output");
    expect(techEffectCategory("marginBonus")).toBe("margin");
  });
  it("describes the new commodity effects readably", () => {
    expect(describeTechEffect({ kind: "inputCost", commodity: "oil", pct: 0.5 })).toBe(
      "−50% oil input"
    );
    expect(describeTechEffect({ kind: "outputRate", commodity: "natural_gas", pct: 0.1 })).toBe(
      "+10% natural gas output"
    );
  });
  it("describes the shield effects", () => {
    expect(describeTechEffect({ kind: "dominanceShield", pct: 0.25 })).toBe(
      "−25% market-dominance penalty"
    );
    expect(techEffectCategory("dominanceShield")).toBe("dominance");
    expect(techEffectCategory("expansionDiscount")).toBe("expansion");
  });
});
