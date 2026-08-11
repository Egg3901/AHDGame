import { describe, expect, it } from "vitest";
import {
  wageGrowthNode,
  REAL_WAGE_CLAMP,
  WAGE_INFLATION_PASSTHROUGH,
  tradeGrowthNode,
  WORLD_TRADE_BASELINE,
  TARIFF_WEDGE_K,
  FTA_OPENNESS_K,
  BLOC_MEMBER_BONUS,
  TRADE_NX_WEIGHT,
  sectorGrowthNode,
  type SectorRevenueTaxPayload,
} from "./economic";
import { evalNode } from "../coexistence";
import type { EngineNodeContext } from "../types";
import type { FiscalTradeInputs } from "../providers";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { THRESHOLDS } from "@/lib/utils/metricScoring";
import { APPROVAL_EXCLUDED_METRICS } from "@/lib/utils/governmentApproval";
import { applyGrowthToFederalBases, applyPerTurnGrowthToFederalBases } from "@/lib/budget/revenue";

const ctx = (over: Partial<EngineNodeContext>): EngineNodeContext => ({
  current: {},
  prev: {},
  prevSimBaseline: {},
  providers: {},
  spending: {},
  policyValue: NaN,
  ...over,
});

const trade = (over: Partial<FiscalTradeInputs> = {}): FiscalTradeInputs => ({
  tariff: 0,
  foreignCorporateTax: 0,
  forexStrength: 0,
  ftaPartnerCount: 0,
  blocMember: false,
  inflationRate: 0,
  ...over,
});

/** medianIncome grown from `prev` by `annualRealPct` for ONE turn (the engine's
 *  per-turn slice — annualizing it back must recover `annualRealPct`). */
const grow = (prev: number, annualRealPct: number) =>
  prev * (1 + annualRealPct / 100 / TURNS_PER_YEAR);

describe("wageGrowthNode (real medianIncome Δ + lagged inflation passthrough)", () => {
  it("tracks the annualized real growth of medianIncome (zero inflation)", () => {
    const prev = 50_000;
    const out = evalNode(
      wageGrowthNode,
      ctx({
        current: { "economic.medianIncome": grow(prev, 3) }, // 3%/yr real
        prev: { "economic.medianIncome": prev },
        providers: { fiscalTradeInputs: trade({ inflationRate: 0 }) },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(3, 1);
  });

  it("adds the lagged-inflation passthrough on top of the real component", () => {
    const prev = 50_000;
    const out = evalNode(
      wageGrowthNode,
      ctx({
        current: { "economic.medianIncome": grow(prev, 3) },
        prev: { "economic.medianIncome": prev },
        providers: { fiscalTradeInputs: trade({ inflationRate: 10 }) },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(3 + WAGE_INFLATION_PASSTHROUGH * 10, 1);
  });

  it("clamps the REAL component but lets the NOMINAL passthrough run (hyperinflation)", () => {
    const prev = 50_000;
    const out = evalNode(
      wageGrowthNode,
      ctx({
        current: { "economic.medianIncome": grow(prev, 40) }, // 40%/yr real → clamped
        prev: { "economic.medianIncome": prev },
        providers: { fiscalTradeInputs: trade({ inflationRate: 480 }) },
      }),
      "s1"
    );
    const expected = REAL_WAGE_CLAMP[1] + WAGE_INFLATION_PASSTHROUGH * 480;
    expect(out.value).toBeCloseTo(expected, 1);
    // The nominal slice is NOT capped at the real clamp — hyperinflation flows through.
    expect(out.value).toBeGreaterThan(REAL_WAGE_CLAMP[1]);
  });

  it("cold-starts with zero real growth when prev medianIncome is missing (no jump)", () => {
    const out = evalNode(
      wageGrowthNode,
      ctx({
        current: { "economic.medianIncome": 50_000 },
        providers: { fiscalTradeInputs: trade({ inflationRate: 2 }) },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(WAGE_INFLATION_PASSTHROUGH * 2, 1);
  });
});

describe("tradeGrowthNode (world baseline − tariff/foreign wedges + FTA/forex/mfg)", () => {
  // Neutral mfg competitiveness so the manufacturing-drift term is 0.
  const neutralCur = { "economic.manufacturingCompetitiveness": 60 };

  it("equals WORLD_TRADE_BASELINE with neutral inputs", () => {
    const out = evalNode(
      tradeGrowthNode,
      ctx({ current: neutralCur, providers: { fiscalTradeInputs: trade() } }),
      "s1"
    );
    expect(out.value).toBeCloseTo(WORLD_TRADE_BASELINE, 1);
  });

  it("a higher tariff strictly lowers tradeGrowth (protectionist Laffer wedge)", () => {
    const low = evalNode(
      tradeGrowthNode,
      ctx({ current: neutralCur, providers: { fiscalTradeInputs: trade({ tariff: 10 }) } }),
      "s1"
    ).value;
    const high = evalNode(
      tradeGrowthNode,
      ctx({ current: neutralCur, providers: { fiscalTradeInputs: trade({ tariff: 30 }) } }),
      "s1"
    ).value;
    expect(high).toBeLessThan(low);
    // Magnitude tracks the wedge constant (each tariff point costs TARIFF_WEDGE_K).
    expect(low - high).toBeCloseTo(TARIFF_WEDGE_K * 20, 1);
  });

  it("active FTA partners raise tradeGrowth", () => {
    const out = evalNode(
      tradeGrowthNode,
      ctx({ current: neutralCur, providers: { fiscalTradeInputs: trade({ ftaPartnerCount: 3 }) } }),
      "s1"
    );
    expect(out.value).toBeCloseTo(WORLD_TRADE_BASELINE + FTA_OPENNESS_K * 3, 1);
  });

  it("economic-bloc membership raises tradeGrowth", () => {
    const out = evalNode(
      tradeGrowthNode,
      ctx({ current: neutralCur, providers: { fiscalTradeInputs: trade({ blocMember: true }) } }),
      "s1"
    );
    expect(out.value).toBeCloseTo(WORLD_TRADE_BASELINE + BLOC_MEMBER_BONUS, 1);
  });
});

describe("wageGrowth/tradeGrowth metric registration", () => {
  it("registers both as economic metrics with negative-capable bounds (not [0,100])", () => {
    const wage = getMetricDefinition("economic", "wageGrowth");
    const trd = getMetricDefinition("economic", "tradeGrowth");
    expect(wage?.minValue).toBe(-10);
    expect(wage?.maxValue).toBe(600); // hyperinflation headroom
    expect(trd?.minValue).toBe(-30);
    expect(trd?.maxValue).toBe(30);
  });

  it("has scoring thresholds so the metric cards/approval can grade them", () => {
    expect(THRESHOLDS.wageGrowth).toBeDefined();
    expect(THRESHOLDS.tradeGrowth).toBeDefined();
    // node bounds match the metric-definition bounds (engine owns bounds, S1)
    expect(wageGrowthNode.bounds).toEqual([-10, 600]);
    expect(tradeGrowthNode.bounds).toEqual([-30, 30]);
  });

  it("excludes both from approval (engine intermediates — gdpGrowth/medianIncome carry the term)", () => {
    expect(APPROVAL_EXCLUDED_METRICS.has("wageGrowth")).toBe(true);
    expect(APPROVAL_EXCLUDED_METRICS.has("tradeGrowth")).toBe(true);
  });
});

describe("tradeGrowth → GDP net-exports coupling (T5, lagged)", () => {
  const payload = (): SectorRevenueTaxPayload => ({
    owned: [{ revenue: 1000, currentGrowthRate: 3 }],
    unowned: [{ revenue: 500 }],
    federalSalesTax: 0,
    stateSalesTax: 6,
    countryId: "US",
  });

  it("is parity-neutral when lagged tradeGrowth is at baseline (cold-start safe)", () => {
    const atBaseline = evalNode(
      sectorGrowthNode,
      ctx({
        providers: { sectorRevenueTax: payload() },
        prev: { "economic.tradeGrowth": WORLD_TRADE_BASELINE },
      }),
      "s1"
    ).value;
    const missing = evalNode(
      sectorGrowthNode,
      ctx({ providers: { sectorRevenueTax: payload() } }),
      "s1"
    ).value;
    // Baseline trade adds no NX impulse, and a missing prev defaults to baseline.
    expect(atBaseline).toBeCloseTo(missing, 3);
  });

  it("above-baseline lagged tradeGrowth lifts the cyclical sector signal", () => {
    const base = evalNode(
      sectorGrowthNode,
      ctx({
        providers: { sectorRevenueTax: payload() },
        prev: { "economic.tradeGrowth": WORLD_TRADE_BASELINE },
      }),
      "s1"
    ).value;
    const boosted = evalNode(
      sectorGrowthNode,
      ctx({
        providers: { sectorRevenueTax: payload() },
        prev: { "economic.tradeGrowth": WORLD_TRADE_BASELINE + 5 },
      }),
      "s1"
    ).value;
    expect(boosted).toBeGreaterThan(base);
    expect(boosted - base).toBeCloseTo(TRADE_NX_WEIGHT * 5, 3);
  });
});

describe("calibration (T7)", () => {
  const fedBases = () => ({
    taxableIncome: 1000,
    wagesAndSalaries: 1000,
    domesticCorporateProfits: 500,
    foreignCorporateProfits: 200,
    importValue: 1000,
    taxableSales: 800,
  });

  it("BR-1991 hyperinflation: wageGrowth compounds the income-tax base ~50%/yr (pins WAGE_INFLATION_PASSTHROUGH)", () => {
    // Real medianIncome ~flat (≈2%); inflation ≈480. The clamp must NOT cap the
    // nominal passthrough, and the base must compound on the order of ~50%/yr (not
    // the ~3% trend, not a clamped 15%). If WAGE_INFLATION_PASSTHROUGH drifts, this
    // band breaks — that is the point of this guard.
    const prev = 50_000;
    const wg = evalNode(
      wageGrowthNode,
      ctx({
        current: { "economic.medianIncome": grow(prev, 2) },
        prev: { "economic.medianIncome": prev },
        providers: { fiscalTradeInputs: trade({ inflationRate: 480 }) },
      }),
      "s1"
    ).value;
    expect(wg).toBeGreaterThan(40);
    expect(wg).toBeLessThan(60); // ~50, NOT capped at the 15% real clamp

    const grown = applyGrowthToFederalBases(fedBases(), {
      gdpGrowth: 2.5,
      wageGrowth: wg,
      inflationRate: 480,
      tradeGrowth: 2,
      lastUpdated: new Date(0),
    });
    // taxableIncome grows with wages — the base compounds ~40–60% in the hyperinflation year.
    expect(grown.taxableIncome / 1000 - 1).toBeGreaterThan(0.4);
    expect(grown.taxableIncome / 1000 - 1).toBeLessThan(0.6);
  });

  it("Laffer turn-over: tariff receipts peak at a moderate tariff, then fall", () => {
    // Receipts = rate × import base. Over a multi-year horizon the trade-Laffer
    // wedge erodes the base faster than the rate climbs, so receipts turn over.
    const HORIZON = 25 * TURNS_PER_YEAR;
    const receiptsAt = (tariff: number) => {
      const tg = evalNode(
        tradeGrowthNode,
        ctx({
          current: { "economic.manufacturingCompetitiveness": 60 },
          providers: { fiscalTradeInputs: trade({ tariff }) },
        }),
        "s1"
      ).value;
      let bases = fedBases();
      const factors = {
        gdpGrowth: 2.5,
        wageGrowth: 3,
        inflationRate: 2,
        tradeGrowth: tg,
        lastUpdated: new Date(0),
      };
      for (let i = 0; i < HORIZON; i++) bases = applyPerTurnGrowthToFederalBases(bases, factors);
      return (tariff / 100) * bases.importValue;
    };
    const low = receiptsAt(10);
    const mid = receiptsAt(30);
    const high = receiptsAt(60);
    expect(mid).toBeGreaterThan(low); // climbing the curve
    expect(mid).toBeGreaterThan(high); // over the peak — protectionism eroded the base
  });

  it("the wage↔inflation loop is convergent at the chosen passthrough (no spiral)", () => {
    // wageGrowth feeds back LAGGED inflation at WAGE_INFLATION_PASSTHROUGH; inflation
    // responds to wageGrowth with a representative sensitivity. The loop gain
    // (passthrough × sensitivity) must be < 1 so a hot start decays to a low fixed
    // point rather than diverging. Guards the passthrough magnitude.
    const INFLATION_SENSITIVITY_TO_WAGE = 0.5; // representative of inflation.ts's wage term
    let inflation = 100; // start hot
    let wage = 3;
    for (let t = 0; t < 200; t++) {
      wage = 2 + WAGE_INFLATION_PASSTHROUGH * inflation; // ~2% real + passthrough × lagged inflation
      inflation = 2 + INFLATION_SENSITIVITY_TO_WAGE * wage;
    }
    expect(Number.isFinite(inflation)).toBe(true);
    expect(inflation).toBeLessThan(20); // converged low, not a runaway spiral
  });
});

describe("§6.1 sector GDP concentration in sectorGrowthNode (P7b, lagged model)", () => {
  const payloadWith = (model?: SectorRevenueTaxPayload["model"]): SectorRevenueTaxPayload => ({
    owned: [
      { revenue: 1000, currentGrowthRate: 6, sectorType: "defense" }, // aligned, high growth
      { revenue: 1000, currentGrowthRate: 0, sectorType: "agriculture" }, // off-model, flat
    ],
    unowned: [],
    federalSalesTax: 0,
    stateSalesTax: 6, // US neutral → no consumption-tax gap
    countryId: "US",
    model,
  });

  it("with no model the sector signal is the plain revenue-weighted average (parity)", () => {
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: { sectorRevenueTax: payloadWith(undefined) },
        prev: { "economic.tradeGrowth": WORLD_TRADE_BASELINE },
      }),
      "s1"
    );
    expect(out.value).toBeCloseTo(3, 3); // (6·1000 + 0·1000)/2000
  });

  it("a held Military-Industrial model tilts the signal toward the aligned (defense) sector", () => {
    const mic: SectorRevenueTaxPayload["model"] = {
      current: "militaryIndustrial",
      intensity: 100,
      scores: {} as never,
      lastUpdated: new Date(0),
    };
    const out = evalNode(
      sectorGrowthNode,
      ctx({
        providers: { sectorRevenueTax: payloadWith(mic) },
        prev: { "economic.tradeGrowth": WORLD_TRADE_BASELINE },
      }),
      "s1"
    );
    // defense weight ×1.25 → (6·1250 + 0·1000)/2250 = 3.333 > the plain 3.0
    expect(out.value).toBeGreaterThan(3);
    expect(out.value).toBeCloseTo((6 * 1250) / 2250, 2);
  });
});
