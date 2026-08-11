import { describe, it, expect } from "vitest";
import { crisisSeverity, effectImpact } from "./severity";
import type { CrisisEffect } from "@/lib/db/types/crisis";

function eff(partial: Partial<CrisisEffect>): CrisisEffect {
  return {
    effectType: "tick",
    targetType: "metric",
    metricCategory: "economic",
    metricField: "unemploymentRate",
    sectorType: null,
    strategyId: null,
    value: 0,
    label: "x",
    ...partial,
  };
}

// metric/approval/inflation effect values are stored in NATIVE units (the
// fractional authoring swing × the effectScale factor); gdpLoss stays a GDP
// fraction and profitMargin stays in percentage points. effectImpact divides the
// tick/flat weights by those same factors, so impacts are scale-invariant.
describe("effectImpact", () => {
  it("weights a real GDP loss as the heaviest contributor", () => {
    expect(effectImpact(eff({ targetType: "gdpLoss", value: 0.03 }))).toBeCloseTo(3);
  });

  it("weights a margin shock by percentage points", () => {
    expect(effectImpact(eff({ targetType: "profitMargin", value: -10 }))).toBeCloseTo(1.2);
  });

  it("weights a recurring per-turn tick by its native magnitude", () => {
    // tick weight = 8 / CRISIS_TICK_UNIT_SCALE (30) ≈ 0.2667
    expect(effectImpact(eff({ effectType: "tick", value: 3 }))).toBeCloseTo(0.8);
  });

  it("weights a one-off flat metric nudge modestly", () => {
    // flat weight = 3 / CRISIS_FLAT_UNIT_SCALE (100) = 0.03
    expect(effectImpact(eff({ effectType: "flat", value: 10 }))).toBeCloseTo(0.3);
  });
});

describe("crisisSeverity", () => {
  it("rates a physical disaster (GDP loss + ticks) as high", () => {
    const severity = crisisSeverity({
      effects: [
        eff({ targetType: "gdpLoss", effectType: "flat", value: 0.03 }), // → 3.0
        eff({ effectType: "tick", value: -0.66, metricField: "gdpGrowth" }), // → 0.18
        eff({ effectType: "tick", targetType: "approval", value: -1.2 }), // → 0.32
      ],
    });
    expect(severity).toBe("high");
  });

  it("does NOT collapse a meaningful crisis to the lowest tier (the old bug)", () => {
    // Earthquake-style ticks alone summed near 'low' under the old tick-only calc.
    // With the GDP loss counted it must read above 'low'.
    const severity = crisisSeverity({
      effects: [eff({ targetType: "gdpLoss", effectType: "flat", value: 0.02 })], // → 2.0
    });
    expect(severity).not.toBe("low");
  });

  it("rates a tiny ongoing drag as a low-tier watch", () => {
    const severity = crisisSeverity({
      effects: [eff({ effectType: "tick", value: 0.3, metricField: "gdpGrowth" })], // → 0.08
    });
    expect(severity).toBe("low");
  });
});
