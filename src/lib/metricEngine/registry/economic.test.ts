import { describe, expect, it } from "vitest";
import {
  sectorGrowthNode,
  gdpGrowthNode,
  unemploymentNode,
  consumerConfidenceNode,
  investorConfidenceNode,
  medianIncomeNode,
  povertyRateNode,
  type SectorRevenueTaxPayload,
} from "./economic";
import { publicTrustNode } from "./governance";
import { evalNode } from "../coexistence";
import { advanceOutputGap } from "../outputGap";
import type { EngineNodeContext } from "../types";
import {
  LABOUR_UNEMPLOYMENT_WAGE_K,
  LABOUR_UNEMPLOYMENT_WAGE_CAP_PP,
  LABOUR_UNEMPLOYMENT_AUTOMATION_K,
  LABOUR_UNEMPLOYMENT_AUTOMATION_CAP_PP,
} from "@/lib/labour/laborCost";
import {
  LABOUR_UNEMPLOYMENT_TIGHTNESS_CAP_PP,
  accumulateLabourDemand,
  computeLabourTightness,
  labourUnemploymentTightnessPressure,
  makeLabourDemandByState,
  roundTightness,
} from "@/lib/labour/labourMarket";

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
  it("hands off a young physical history gradually without a measurement cliff", () => {
    const inputs = payload({
      plantsEnabled: true,
      revenueEmaNow: 1100,
      revenueTrendBaseline: { value: 1000, spanTurns: 48 },
      outputEmaNow: 1000,
      outputTrendBaseline: { value: 1000, spanTurns: 8 },
    });
    expect(sectorGrowthNode.compute!(ctx({ providers: { sectorRevenueTax: inputs } }))).toBeCloseTo(
      10
    );
  });

  it("does not turn a price-only revenue decline into an output contraction", () => {
    const inputs = payload({
      plantsEnabled: true,
      revenueEmaNow: 800,
      revenueTrendBaseline: { value: 1000, spanTurns: 48 },
      outputEmaNow: 1000,
      outputTrendBaseline: { value: 1000, spanTurns: 48 },
    });
    expect(sectorGrowthNode.compute!(ctx({ providers: { sectorRevenueTax: inputs } }))).toBe(0);
  });

  it("retains an actual output contraction even when nominal revenue is flat", () => {
    const inputs = payload({
      plantsEnabled: true,
      revenueEmaNow: 1000,
      revenueTrendBaseline: { value: 1000, spanTurns: 48 },
      outputEmaNow: 950,
      outputTrendBaseline: { value: 1000, spanTurns: 48 },
    });
    expect(sectorGrowthNode.compute!(ctx({ providers: { sectorRevenueTax: inputs } }))).toBeCloseTo(
      -5
    );
  });

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

  it("prefers the trailing revenue trend over the one-turn delta under plants", () => {
    // One-turn delta says +4.8 annualized (1001/1000 × 48); trailing trend says
    // +10 over a year. The trend wins; the one-turn path is fallback only.
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: {
          sectorRevenueTax: payload({
            plantsEnabled: true,
            realizedRevenueNow: 1001,
            realizedRevenuePrev: 1000,
            turnsSincePrev: 1,
            revenueEmaNow: 1100,
            revenueTrendBaseline: { value: 1000, spanTurns: 48 },
            unowned: [],
          }),
        },
      }),
      "s1"
    );
    // US neutral taxes in the default payload → no tax wedge. 10 − 0 = 10.
    expect(out.value).toBe(10);
  });

  it("falls back to the one-turn delta while the trend baseline is immature", () => {
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: {
          sectorRevenueTax: payload({
            plantsEnabled: true,
            realizedRevenueNow: 1001,
            realizedRevenuePrev: 1000,
            turnsSincePrev: 1,
            revenueEmaNow: 1100,
            revenueTrendBaseline: null,
            unowned: [],
          }),
        },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(4.8, 2);
  });

  it("uses realizedRevenueNow for the plants delta (ticket #1084 host/host)", () => {
    // Identical host revenue both turns → 0% even if ₳ restatement would jig.
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: {
          sectorRevenueTax: payload({
            plantsEnabled: true,
            realizedRevenueNow: 1000,
            realizedRevenuePrev: 1000,
            turnsSincePrev: 1,
            countryId: "UK",
            federalSalesTax: 20,
            stateSalesTax: 0,
            unowned: [],
          }),
        },
      }),
      "s1"
    );
    expect(out.value).toBe(0);
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

describe("unemploymentNode — #791 measured-tightness channel", () => {
  const base = {
    current: { "economic.gdpGrowth": 2 },
    prevSimBaseline: { "economic.unemploymentRate": 5 },
  };

  it("a tight market lowers the target and a slack market raises it", () => {
    const baseline = unemploymentNode.compute!(ctx(base));
    const tight = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": 2 },
      })
    );
    const slack = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": 0.5 },
      })
    );
    expect(tight).toBeLessThan(baseline);
    expect(slack).toBeGreaterThan(baseline);
  });

  it("chains production headcounts through tightness into the target", () => {
    // Build the signal the way the corp turn does: accumulate sector headcounts,
    // divide by the metric engine labour force, persist rounded. Nothing here
    // is derived from unemployment, so this also pins the anti-circularity.
    const demand = makeLabourDemandByState();
    accumulateLabourDemand(demand, "s1", 150);
    accumulateLabourDemand(demand, "s1", 250);
    const tight = roundTightness(computeLabourTightness(demand.get("s1")!, 200)!);
    expect(tight).toBe(2);
    const baseline = unemploymentNode.compute!(ctx(base));
    const withMeasured = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": tight },
      })
    );
    expect(withMeasured).toBeLessThan(baseline);
    expect(baseline - withMeasured).toBeCloseTo(-labourUnemploymentTightnessPressure(2), 9);

    // Mirror image from headcounts: 100 wanted over a 200-strong force reads
    // slack and lifts the target by the symmetric amount.
    const slackDemand = makeLabourDemandByState();
    accumulateLabourDemand(slackDemand, "s1", 100);
    const slackTight = roundTightness(computeLabourTightness(slackDemand.get("s1")!, 200)!);
    expect(slackTight).toBe(0.5);
    const withSlack = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": slackTight },
      })
    );
    expect(withSlack).toBeGreaterThan(baseline);
    expect(withSlack - baseline).toBeCloseTo(baseline - withMeasured, 9);
  });

  it("a sustained demand shock drifts unemployment down turn after turn", () => {
    const run = (tightness: number | undefined) => {
      let value = 5;
      let simBaseline = 5;
      const history = [];
      for (let turn = 0; turn < 12; turn++) {
        const out = evalNode(
          unemploymentNode,
          ctx({
            current: {
              "economic.gdpGrowth": 2,
              ...(tightness !== undefined ? { "economic.labourTightness": tightness } : {}),
            },
            prevSimBaseline: { "economic.unemploymentRate": simBaseline },
            policyValue: value,
          }),
          "s1"
        );
        value = out.value;
        simBaseline = out.simBaseline;
        history.push(value);
      }
      return history;
    };
    const shocked = run(2);
    const calm = run(undefined);
    // gdp at potential ⇒ Okun holds the calm path flat; the shock path falls.
    expect(calm[11]).toBeCloseTo(5, 9);
    expect(shocked[11]).toBeLessThan(4.9);
    for (let i = 1; i < shocked.length; i++) {
      expect(shocked[i]).toBeLessThanOrEqual(shocked[i - 1]);
    }
    // Mirror image: sustained slack drifts it up.
    const slack = run(0.5);
    expect(slack[11]).toBeGreaterThan(5.1);
  });

  it("an extreme one-turn reading cannot move the target more than the cap", () => {
    const baseline = unemploymentNode.compute!(ctx(base));
    const spike = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": 200 },
      })
    );
    const collapse = unemploymentNode.compute!(
      ctx({
        ...base,
        current: { ...base.current, "economic.labourTightness": 0.001 },
      })
    );
    expect(baseline - spike).toBeCloseTo(LABOUR_UNEMPLOYMENT_TIGHTNESS_CAP_PP, 9);
    expect(collapse - baseline).toBeCloseTo(LABOUR_UNEMPLOYMENT_TIGHTNESS_CAP_PP, 9);
  });

  it("cold start (no measured tightness) is byte-identical to today", () => {
    const baseline = unemploymentNode.compute!(ctx(base));
    for (const tightness of [undefined, Number.NaN, 0, -2]) {
      const out = unemploymentNode.compute!(
        ctx({
          ...base,
          current:
            tightness === undefined
              ? { ...base.current }
              : { ...base.current, "economic.labourTightness": tightness },
        })
      );
      expect(out).toBe(baseline);
    }
  });

  it("keeps the GDP, wage and automation channels alongside the new one", () => {
    const gdpOnly = unemploymentNode.compute!(ctx(base));
    const all = unemploymentNode.compute!(
      ctx({
        current: {
          "economic.gdpGrowth": 4,
          "economic.labourWageIndexDelta": 0.1,
          "economic.automationIndexDelta": -0.1,
          "economic.labourTightness": 2,
        },
        prevSimBaseline: { "economic.unemploymentRate": 5 },
      })
    );
    // gdp 4 vs potential 2 ⇒ Okun pulls down; wage hike + automation push up;
    // tight market pulls down again. Net must differ from every partial read.
    expect(all).not.toBe(gdpOnly);
    const noTightness = unemploymentNode.compute!(
      ctx({
        current: {
          "economic.gdpGrowth": 4,
          "economic.labourWageIndexDelta": 0.1,
          "economic.automationIndexDelta": -0.1,
        },
        prevSimBaseline: { "economic.unemploymentRate": 5 },
      })
    );
    expect(all).toBeLessThan(noTightness);
  });

  it("downstream poverty and trust stay bounded and move in the right direction", () => {
    const runUnemployment = (tightness: number | undefined) => {
      let value = 5;
      let simBaseline = 5;
      const history = [];
      for (let turn = 0; turn < 12; turn++) {
        const out = evalNode(
          unemploymentNode,
          ctx({
            current: {
              "economic.gdpGrowth": 2,
              ...(tightness !== undefined ? { "economic.labourTightness": tightness } : {}),
            },
            prevSimBaseline: { "economic.unemploymentRate": simBaseline },
            policyValue: value,
          }),
          "s1"
        );
        value = out.value;
        simBaseline = out.simBaseline;
        history.push(value);
      }
      return history;
    };
    const calm = runUnemployment(undefined);
    const shocked = runUnemployment(2);
    for (let i = 0; i < calm.length; i++) {
      const povertyCalm = povertyRateNode.compute!(
        ctx({ current: { "economic.unemploymentRate": calm[i] } })
      );
      const povertyShocked = povertyRateNode.compute!(
        ctx({ current: { "economic.unemploymentRate": shocked[i] } })
      );
      // Lower unemployment lowers poverty; the 0.6/pp slope keeps the gap small.
      expect(povertyShocked).toBeLessThanOrEqual(povertyCalm);
      expect(povertyCalm - povertyShocked).toBeLessThan(0.5);
      const trustCalm = publicTrustNode.compute!(
        ctx({
          current: { "economic.unemploymentRate": calm[i] },
          providers: { governmentApproval: 45 },
        })
      );
      const trustShocked = publicTrustNode.compute!(
        ctx({
          current: { "economic.unemploymentRate": shocked[i] },
          providers: { governmentApproval: 45 },
        })
      );
      // Lower unemployment lifts trust; the -1/pp slope keeps the gap small.
      expect(trustShocked).toBeGreaterThanOrEqual(trustCalm);
      expect(trustShocked - trustCalm).toBeLessThan(1);
    }
  });
});
