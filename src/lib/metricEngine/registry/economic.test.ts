import { describe, expect, it } from "vitest";
import {
  sectorGrowthNode,
  gdpGrowthNode,
  unemploymentNode,
  consumerConfidenceNode,
  investorConfidenceNode,
  medianIncomeNode,
  type SectorRevenueTaxPayload,
} from "./economic";
import { evalNode } from "../coexistence";
import { advanceOutputGap } from "../outputGap";
import type { EngineNodeContext } from "../types";
import {
  LABOUR_UNEMPLOYMENT_WAGE_K,
  LABOUR_UNEMPLOYMENT_WAGE_CAP_PP,
  LABOUR_UNEMPLOYMENT_AUTOMATION_K,
  LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP,
} from "@/lib/labour/laborCost";

const ctx = (over: Partial<EngineNodeContext>): EngineNodeContext => ({
  current: {},
  prev: {},
  prevSimBaseline: {},
  providers: {},
  spending: {},
  policyValue: NaN,
  ...over,
});

const payload = (over: Partial<SectorRevenueTaxPayload> = {}): SectorRevenueTaxPayload => ({
  owned: [{ revenue: 1000, currentGrowthRate: 3 }],
  unowned: [{ revenue: 500 }],
  federalSalesTax: 0,
  stateSalesTax: 6,
  countryId: "US",
  ...over,
});

describe("sectorGrowthNode (the cyclical signal — old gdpGrowth logic)", () => {
  it("computes the revenue-weighted, tax-adjusted sector growth as the sim target", () => {
    // (1000*3 + 500*0.5)/1500 = 2.1667 ; US neutral tax (fed0/state6) → gap 0
    const out = evalNode(
      sectorGrowthNode,
      ctx({ providers: { sectorRevenueTax: payload() } }),
      "s1"
    );
    expect(out.value).toBe(2.167);
  });

  it("preserves a capped policy delta (MAX_POLICY_DELTA=4)", () => {
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: {
          sectorRevenueTax: payload({
            owned: [{ revenue: 1000, currentGrowthRate: 2 }],
            unowned: [],
          }),
        },
        policyValue: 15,
        prevSimBaseline: { "economic.sectorGrowth": 2 },
      }),
      "s1"
    );
    // base 2 + capped policy delta 4 (MAX_POLICY_DELTA, lowered from 8 in v0 #2)
    expect(out.value).toBe(6);
  });

  it("clamps to the declared [-10,15] bounds", () => {
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: {
          sectorRevenueTax: payload({
            owned: [{ revenue: 1000, currentGrowthRate: 20 }],
            unowned: [],
          }),
        },
        policyValue: 20,
        prevSimBaseline: { "economic.sectorGrowth": 20 },
      }),
      "s1"
    );
    expect(out.value).toBe(15);
  });
});

describe("gdpGrowthNode (potential + output-gap integration, P1c-2)", () => {
  it("integrates the sector signal toward potential via the gap (cold-start gap 0 → equals sector)", () => {
    const sector = 6;
    const potential = 2;
    const out = evalNode(
      gdpGrowthNode,
      ctx({
        current: {
          "economic.sectorGrowth": sector,
          "economic.potentialGrowth": potential,
          "economic.outputGapPrev": 0,
        },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(advanceOutputGap(0, sector, potential, 48).gdpGrowth, 2);
  });

  it("a positive prior gap with the sector back at potential dips gdpGrowth below potential (bust)", () => {
    const out = evalNode(
      gdpGrowthNode,
      ctx({
        current: {
          "economic.sectorGrowth": 2,
          "economic.potentialGrowth": 2,
          "economic.outputGapPrev": 8,
        },
      }),
      "s1"
    );
    expect(out.value).toBeLessThan(2);
  });
});

describe("unemploymentNode", () => {
  it("blends prev unemployment toward the Okun target (value-EMA, 2dp)", () => {
    // gdp 4, potential fallback 2 → dev 2 → coeff 0.2 → target 4.1 ; 0.85*4.5+0.15*4.1 = 4.44
    const out = evalNode(
      unemploymentNode,
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      }),
      "s1"
    );
    expect(out.value).toBe(4.44);
  });

  it("keys Okun off the output gap (gdp − potential), not a fixed 2.0", () => {
    // potential 5, gdp 5 → gap 0 → no change ; EMA(4.5, 4.5) = 4.5
    const out = evalNode(
      unemploymentNode,
      ctx({
        current: { "economic.gdpGrowth": 5, "economic.potentialGrowth": 5 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      }),
      "s1"
    );
    expect(out.value).toBe(4.5);
  });

  it("never applies a policy delta (value-EMA shape)", () => {
    const out = evalNode(
      unemploymentNode,
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
        policyValue: 99, // ignored: maxPolicyDelta 0
      }),
      "s1"
    );
    expect(out.value).toBe(4.44);
  });
});

describe("unemploymentNode — v2-3a labour wage-index Δ → jobs (gated on labourSystemMode ≥ 'macro')", () => {
  it("a zero/absent Δ is byte-identical to the pre-v2-3 Okun target (parity)", () => {
    const absent = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const zero = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.labourWageIndexDelta": 0 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    // gdp 4, potential fallback 2 → dev 2 → coeff 0.2 → okunTarget 4.5-0.4=4.1
    expect(absent).toBe(4.1);
    expect(zero).toBe(absent);
  });

  it("a positive wage-index Δ raises the unemployment target", () => {
    const baseline = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const withDelta = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.labourWageIndexDelta": 0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(withDelta).toBeGreaterThan(baseline);
    expect(withDelta).toBeCloseTo(baseline + 0.1 * LABOUR_UNEMPLOYMENT_WAGE_K, 9);
  });

  it("a negative wage-index Δ (wage cut) lowers the unemployment target", () => {
    const baseline = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const withDelta = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.labourWageIndexDelta": -0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(withDelta).toBeLessThan(baseline);
  });

  it("an extreme Δ is capped, not allowed to dominate the Okun target", () => {
    const out = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.labourWageIndexDelta": 5 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    // okunTarget 4.1 + capped pressure (LABOUR_UNEMPLOYMENT_WAGE_CAP_PP)
    expect(out).toBeCloseTo(4.1 + LABOUR_UNEMPLOYMENT_WAGE_CAP_PP, 9);
  });

  it("the combined value is re-clamped to the node's [2,15] bounds", () => {
    const out = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": -50, "economic.labourWageIndexDelta": 5 },
        prevSimBaseline: { "economic.unemploymentRate": 14.9 },
      })
    );
    expect(out).toBeLessThanOrEqual(15);
  });
});

describe("unemploymentNode — v2-3b automation-index Δ → jobs (gated on labourSystemMode ≥ 'macro')", () => {
  it("a zero/absent automation Δ is byte-identical to the pre-v2-3b baseline (parity)", () => {
    const absent = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const zero = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.automationIndexDelta": 0 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(zero).toBe(absent);
  });

  it("more automation (a DROP in the index, negative Δ) raises unemployment", () => {
    const baseline = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const withDelta = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.automationIndexDelta": -0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(withDelta).toBeGreaterThan(baseline);
    expect(withDelta).toBeCloseTo(baseline + 0.1 * LABOUR_UNEMPLOYMENT_AUTOMATION_K, 9);
  });

  it("less automation (a RISE in the index, positive Δ) lowers unemployment", () => {
    const baseline = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const withDelta = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.automationIndexDelta": 0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(withDelta).toBeLessThan(baseline);
  });

  it("an extreme automation Δ is capped, not allowed to dominate the Okun target", () => {
    const out = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.automationIndexDelta": -5 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    expect(out).toBeCloseTo(4.1 + LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP, 9);
  });

  it("the wage and automation pressures sum together in the same turn", () => {
    const wageOnly = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.labourWageIndexDelta": 0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const automationOnly = unemploymentNode.compute!(
      ctx({
        current: { "economic.gdpGrowth": 4, "economic.automationIndexDelta": -0.1 },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    const both = unemploymentNode.compute!(
      ctx({
        current: {
          "economic.gdpGrowth": 4,
          "economic.labourWageIndexDelta": 0.1,
          "economic.automationIndexDelta": -0.1,
        },
        prevSimBaseline: { "economic.unemploymentRate": 4.5 },
      })
    );
    // okunTarget 4.1 + 0.15 (wage) + 0.25 (automation) = 4.5
    expect(both).toBeCloseTo(wageOnly + automationOnly - 4.1, 9);
  });
});

describe("medianIncomeNode", () => {
  it("grows by productivity + tightness when the labour Δ is absent (parity)", () => {
    const out = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 1.2, "economic.unemploymentRate": 5 },
      })
    );
    // tightness = (5-5)*0.3 = 0 ; wageGrowthAnnualPct = 1.2
    expect(out).toBeCloseTo(50_000 * (1 + 1.2 / 100 / 48), 6);
  });

  it("v2-2: a zero labour Δ is byte-identical to the Δ-absent case", () => {
    const absent = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 1.2, "economic.unemploymentRate": 5 },
      })
    );
    const zero = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: {
          "economic.productivityGrowth": 1.2,
          "economic.unemploymentRate": 5,
          "economic.labourWageIndexDelta": 0,
        },
      })
    );
    expect(zero).toBe(absent);
  });

  it("v2-2: a positive labour wage-index Δ adds a one-time wage-growth impulse", () => {
    const baseline = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 1.2, "economic.unemploymentRate": 5 },
      })
    );
    const withDelta = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: {
          "economic.productivityGrowth": 1.2,
          "economic.unemploymentRate": 5,
          "economic.labourWageIndexDelta": 0.1, // +10% wage hike this turn
        },
      })
    );
    expect(withDelta).toBeGreaterThan(baseline);
    // labourPressure = 0.1*100*0.5 = 5pp ; wageGrowthAnnualPct = 1.2+5 = 6.2
    expect(withDelta).toBeCloseTo(50_000 * (1 + 6.2 / 100 / 48), 4);
  });

  it("v2-2: a negative labour wage-index Δ (wage cut) lowers the growth impulse", () => {
    const baseline = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: { "economic.productivityGrowth": 1.2, "economic.unemploymentRate": 5 },
      })
    );
    const withDelta = medianIncomeNode.compute!(
      ctx({
        prevSimBaseline: { "economic.medianIncome": 50_000 },
        current: {
          "economic.productivityGrowth": 1.2,
          "economic.unemploymentRate": 5,
          "economic.labourWageIndexDelta": -0.1,
        },
      })
    );
    expect(withDelta).toBeLessThan(baseline);
  });
});

describe("consumerConfidenceNode", () => {
  it("sits at the 60 baseline when conditions are neutral (unemp 5, col 100)", () => {
    const target = consumerConfidenceNode.compute!(
      ctx({ current: { "economic.unemploymentRate": 5, "economic.costOfLiving": 100 } })
    );
    expect(target).toBe(60);
  });

  it("falls when unemployment and cost of living rise", () => {
    const target = consumerConfidenceNode.compute!(
      ctx({ current: { "economic.unemploymentRate": 9, "economic.costOfLiving": 120 } })
    );
    // 60 − (9−5)*2.5 − (120−100)*0.3 = 60 − 10 − 6 = 44
    expect(target).toBe(44);
  });
});

describe("investorConfidenceNode", () => {
  it("sits at the 60 baseline at neutral growth + root small-business rate", () => {
    const target = investorConfidenceNode.compute!(
      ctx({ current: { "economic.gdpGrowth": 2, "economic.smallBusinessFormation": 8 } })
    );
    expect(target).toBe(60);
  });

  it("rises with growth above neutral and a strong formation rate", () => {
    const target = investorConfidenceNode.compute!(
      ctx({ current: { "economic.gdpGrowth": 4, "economic.smallBusinessFormation": 12 } })
    );
    // 60 + (4−2)*4 + (12−8)*1.5 = 60 + 8 + 6 = 74
    expect(target).toBe(74);
  });
});
