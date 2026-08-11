import { describe, expect, it } from "vitest";
import { projectStrategyOutcome } from "./StrategyPanel";
import { topMarginDrivers } from "./MarginsPanel";
import type { AvailableStrategy, Margins } from "../types";

const strat = (over: Partial<AvailableStrategy> = {}): AvailableStrategy => ({
  id: "focused",
  name: "Focused",
  description: "",
  ...over,
});

describe("projectStrategyOutcome", () => {
  it("combines the margin and revenue legs into one profit delta", () => {
    // 1000 revenue at 20% margin = 200 operating profit.
    // +5pp margin and +10% revenue → 1100 × 25% = 275. Delta = +75.
    const out = projectStrategyOutcome(
      strat({ projectedMarginDelta: 5, projectedRealizationDelta: 0.1 }),
      1000,
      20
    );
    expect(out).not.toBeNull();
    expect(out!.projectedMargin).toBe(25);
    expect(out!.profitDelta).toBeCloseTo(75, 6);
  });

  it("surfaces the trade-off where more revenue costs margin", () => {
    // This is the case the player could not previously evaluate: revenue up,
    // margin down. 1000 × 20% = 200 → 1300 × 14% = 182. Net NEGATIVE despite
    // the revenue gain, which is exactly the thing worth showing.
    const out = projectStrategyOutcome(
      strat({ projectedMarginDelta: -6, projectedRealizationDelta: 0.3 }),
      1000,
      20
    );
    expect(out!.profitDelta).toBeLessThan(0);
    expect(out!.profitDelta).toBeCloseTo(-18, 6);
  });

  it("treats a missing realization leg as no revenue change, not zero revenue", () => {
    // Realization is null when the market mode is off. The margin leg must
    // still project; the revenue leg simply stays flat.
    const out = projectStrategyOutcome(
      strat({ projectedMarginDelta: 5, projectedRealizationDelta: null }),
      1000,
      20
    );
    expect(out!.profitDelta).toBeCloseTo(50, 6);
  });

  it("returns null when the projection or the baseline is unavailable", () => {
    expect(projectStrategyOutcome(strat({ projectedMarginDelta: null }), 1000, 20)).toBeNull();
    expect(projectStrategyOutcome(strat({ projectedMarginDelta: 5 }), null, 20)).toBeNull();
    expect(projectStrategyOutcome(strat({ projectedMarginDelta: 5 }), 1000, null)).toBeNull();
  });
});

const margins = (over: Partial<Margins>): Margins =>
  ({
    base: 20,
    effective: 20,
    unemploymentModifier: 0,
    gridReliabilityModifier: 0,
    corruptionModifier: 0,
    workforceSkillModifier: null,
    crimeRateModifier: null,
    broadbandModifier: null,
    roadConditionModifier: null,
    carbonEmissionsModifier: null,
    costOfLivingModifier: null,
    commodityModifier: 0,
    homeLocationModifier: 0,
    stateSectorSpecializationModifier: 0,
    sectorTypeMatchModifier: 0,
    sprawlModifier: 0,
    inflationModifier: 0,
    debtToGdpModifier: 0,
    deficitToGdpModifier: 0,
    typeSwitchModifier: 0,
    strategyTransitionModifier: 0,
    foreignTariffModifier: 0,
    domesticTariffMalus: 0,
    subsidyModifier: 0,
    dominanceMarginPenalty: 0,
    dominanceRegulatoryBurdenPp: 0,
    sustainedNegativeProductionPenalty: 0,
    unemploymentRate: null,
    gridReliability: null,
    corruptionIndex: null,
    workforceSkill: null,
    crimeRate: null,
    broadbandAccess: null,
    roadCondition: null,
    carbonEmissions: null,
    costOfLiving: null,
    inflationRate: null,
    debtToGdpRatio: null,
    deficitToGdpPct: null,
    ...over,
  }) as Margins;

describe("topMarginDrivers", () => {
  it("ranks by absolute impact, not by sign or group", () => {
    const ranked = topMarginDrivers(
      margins({
        commodityModifier: -14,
        broadbandModifier: -0.2,
        subsidyModifier: 15,
        inflationModifier: -3,
      })
    );
    expect(ranked.map((d) => d.label)).toEqual([
      "Government subsidy",
      "Commodity markets",
      "Inflation",
      "Broadband access",
    ]);
  });

  // `stateMetricsModifier` is the SUM of the individual state-metric rows and is
  // the only one the engine folds into the effective margin. Listing both levels
  // would double-count and let one state metric occupy two of five slots.
  it("uses the state-metric total instead of its components when present", () => {
    const ranked = topMarginDrivers(
      margins({
        stateMetricsModifier: -8,
        unemploymentModifier: -3,
        corruptionModifier: -5,
        commodityModifier: -2,
      })
    );
    expect(ranked.map((d) => d.label)).toEqual(["State conditions", "Commodity markets"]);
    expect(ranked.find((d) => d.label === "State conditions")!.value).toBe(-8);
  });

  it("falls back to the individual state metrics when no total is supplied", () => {
    const ranked = topMarginDrivers(
      margins({ unemploymentModifier: -3, corruptionModifier: -5, commodityModifier: -2 })
    );
    expect(ranked.map((d) => d.label)).toEqual(["Corruption", "Unemployment", "Commodity markets"]);
  });

  it("drops modifiers too small to round to a visible value", () => {
    const ranked = topMarginDrivers(
      margins({ commodityModifier: -14, broadbandModifier: 0.01, corruptionModifier: 0 })
    );
    expect(ranked.map((d) => d.label)).toEqual(["Commodity markets"]);
  });

  it("caps the list so the summary stays a summary", () => {
    const ranked = topMarginDrivers(
      margins({
        commodityModifier: -14,
        subsidyModifier: 15,
        inflationModifier: -3,
        debtToGdpModifier: -2,
        deficitToGdpModifier: -1.5,
        sprawlModifier: -1.2,
        corruptionModifier: -1.1,
      })
    );
    expect(ranked).toHaveLength(5);
  });

  it("returns nothing when every modifier is flat", () => {
    expect(topMarginDrivers(margins({}))).toEqual([]);
  });
});
