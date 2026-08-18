import { describe, it, expect } from "vitest";
import {
  calculateInflation,
  calculateInflationWithBreakdown,
  computeHousingCostPressure,
  computeEffectivePrimeRate,
  getCostOfLivingNeutralIndex,
  getInflationTarget,
  getNeutralPrimeRate,
  type InflationInputs,
} from "./inflation";
import { computeMacroTarget, applyDrift } from "../currency/rateCalculation";

/** Baseline "healthy economy" inputs — should produce ~2% (target) inflation */
const baseline: InflationInputs = {
  unemployment: 5.0, // at NAIRU
  gdpGrowth: 2.0, // at trend
  primeRate: 3.0, // at neutral
  surplusToGdp: 0.0, // balanced budget
  tariffRate: 3.0, // at baseline
  wageGrowth: 2.5, // at baseline
  commodityPressure: 0.0, // at base (no commodity cost-push)
  forexPressure: 0.0, // at calibration rate (no FX depreciation)
  savingsPressure: 0.0, // no net savings flow
  previousInflation: 2.0,
};

describe("calculateInflation", () => {
  it("returns ~2% at baseline (healthy economy)", () => {
    const rate = calculateInflation(baseline);
    expect(rate).toBeCloseTo(2.0, 0);
  });

  // ── Demand-pull ──────────────────────────────────────────────────────────

  it("increases with low unemployment (Phillips curve)", () => {
    const rate = calculateInflation({ ...baseline, unemployment: 3.0 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("decreases with high unemployment (two-sided Phillips curve)", () => {
    // Unemployment above NAIRU → deflationary pressure (slack labor market)
    const rate = calculateInflation({ ...baseline, unemployment: 7.0 });
    expect(rate).toBeLessThan(2.0);
  });

  it("increases with high GDP growth", () => {
    const rate = calculateInflation({ ...baseline, gdpGrowth: 5.0 });
    expect(rate).toBeGreaterThan(2.0);
  });

  // ── Monetary policy ──────────────────────────────────────────────────────

  it("increases when prime rate is below neutral", () => {
    const rate = calculateInflation({ ...baseline, primeRate: 1.0 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("decreases when prime rate is above neutral", () => {
    const rate = calculateInflation({ ...baseline, primeRate: 6.0 });
    expect(rate).toBeLessThan(2.0);
  });

  // ── Fiscal policy ────────────────────────────────────────────────────────

  it("increases with a budget deficit", () => {
    // 5% of GDP deficit
    const rate = calculateInflation({ ...baseline, surplusToGdp: -0.05 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("decreases slightly with a surplus (two-sided fiscal)", () => {
    const rate = calculateInflation({ ...baseline, surplusToGdp: 0.05 });
    // Surplus is mildly deflationary (weaker coefficient than deficit)
    expect(rate).toBeLessThan(2.0);
  });

  // ── Cost-push ────────────────────────────────────────────────────────────

  it("increases with high tariffs", () => {
    const rate = calculateInflation({ ...baseline, tariffRate: 10.0 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("increases with high wage growth", () => {
    const rate = calculateInflation({ ...baseline, wageGrowth: 5.0 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("increases when national commodity prices are above base (positive pressure)", () => {
    // 20% above base → 0.2 * 3.0 = 0.6 pp commodity cost-push
    const rate = calculateInflation({ ...baseline, commodityPressure: 0.2 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("decreases when national commodity prices are below base (negative pressure, weaker)", () => {
    // 10% below base → 0.1 * 1.5 = 0.15 pp commodity deflation
    const rate = calculateInflation({ ...baseline, commodityPressure: -0.1 });
    expect(rate).toBeLessThan(2.0);
  });

  it("increases when currency has depreciated (positive forex pressure)", () => {
    // 10% depreciation → 0.1 * 8.0 = 0.8 pp import cost-push
    const rate = calculateInflation({ ...baseline, forexPressure: 0.1 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("decreases when currency has appreciated (negative forex pressure, weaker)", () => {
    // 5% appreciation → 0.05 * 4.0 = 0.2 pp deflationary FX effect
    const rate = calculateInflation({ ...baseline, forexPressure: -0.05 });
    expect(rate).toBeLessThan(2.0);
  });

  it("increases when net savings are being drawn down (positive savings pressure)", () => {
    // Withdrawals = 50% of balance → pressure = 0.5 * 1.0 = 0.5 pp inflationary
    const rate = calculateInflation({ ...baseline, savingsPressure: 0.5 });
    expect(rate).toBeGreaterThan(2.0);
  });

  it("does NOT add inflation from a high cost-of-living level (term retired)", () => {
    // A high price level is not inflation (cf. Switzerland: high CoL, ~1% CPI).
    const rate = calculateInflation({ ...baseline, housingCostPressure: 10 });
    expect(rate).toBe(calculateInflation({ ...baseline, housingCostPressure: 0 }));
  });

  it("cost-of-living/housing term is retired — a price LEVEL never drives inflation", () => {
    // The term mapped a price level to an inflation rate (dimensionally wrong: a
    // high cost of living is not high inflation). It is now zeroed, so ANY CoL
    // pressure — even a large one — contributes 0pp. This is what prevents both
    // the −15pp deflation (CoL 40 vs neutral 100) and the symmetric +stagflation.
    const huge = calculateInflationWithBreakdown({ ...baseline, housingCostPressure: 40 });
    const none = calculateInflationWithBreakdown({ ...baseline, housingCostPressure: 0 });
    expect(huge.breakdown.housing).toBe(0);
    expect(huge.rate).toBe(none.rate);
  });

  it("uses country-aware inflation target and neutral prime rate when provided", () => {
    const targetInflation = getInflationTarget("BR");
    const neutralPrimeRate = getNeutralPrimeRate("BR");
    const { rate, breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      targetInflation,
      neutralPrimeRate,
      primeRate: neutralPrimeRate,
      previousInflation: targetInflation,
    });

    expect(targetInflation).toBe(4.0);
    expect(neutralPrimeRate).toBe(8.0);
    expect(breakdown.monetary).toBeCloseTo(0, 6);
    expect(rate).toBeCloseTo(targetInflation, 1);
  });

  it("does not treat Nigeria crisis inflation as the policy target", () => {
    expect(getInflationTarget("NG")).toBe(6.0);
    expect(getNeutralPrimeRate("NG")).toBe(12.0);
  });

  // ── Era-aware anchors (1953/1979/1991) ───────────────────────────────────

  it("resolves era-authored CB anchors in 1953 worlds; modern path is untouched", () => {
    // Late-1970s calibration stays for era-less / 1979 / modern resolution
    // (the 1979 era table repeats the global table's IT 15.0 verbatim)…
    expect(getInflationTarget("IT")).toBe(15.0);
    expect(getInflationTarget("IT", 1979)).toBe(15.0);
    expect(getInflationTarget("IT", 2019)).toBe(15.0);
    // …but a 1953 world resolves the 1953 anchor (was pinned at the 15% cap).
    expect(getInflationTarget("IT", 1953)).toBe(2.5);
    expect(getNeutralPrimeRate("IT", 1953)).toBe(4.0);
    expect(getInflationTarget("TR", 1953)).toBe(5.0);
    expect(getNeutralPrimeRate("TR", 1953)).toBe(6.0);
    expect(getInflationTarget("ES", 1953)).toBe(4.0);
    expect(getInflationTarget("RU", 1953)).toBe(1.0);
  });

  it("GRADUATION: targets re-key on the CURRENT in-game year as a world advances", () => {
    // A 1953-default world over its life: 1953 anchors while in the 1953 era…
    expect(getInflationTarget("IT", 1955)).toBe(2.5);
    expect(getNeutralPrimeRate("IT", 1955)).toBe(4.0);
    // …the 1979 stagflation anchors through 1979-1990…
    expect(getInflationTarget("IT", 1985)).toBe(15.0);
    // …the 1991 disinflation anchors through 1991-1998…
    expect(getInflationTarget("IT", 1995)).toBe(5.5);
    expect(getInflationTarget("US", 1995)).toBe(4.0);
    // …and the modern table from 1999 on. The live 1991-default world at
    // in-game ~2015 resolves modern anchors (its pre-era-table behavior).
    expect(getInflationTarget("US", 2015)).toBe(getInflationTarget("US"));
    expect(getNeutralPrimeRate("US", 2015)).toBe(getNeutralPrimeRate("US"));
    expect(getInflationTarget("IT", 2015)).toBe(15.0);
    // Fail-safe: absent year → modern.
    expect(getInflationTarget("IT", undefined)).toBe(15.0);
    expect(getInflationTarget("IT", null)).toBe(15.0);
  });

  it("countries without a 1953 override fall through to the modern baseline", () => {
    expect(getInflationTarget("US", 1953)).toBe(getInflationTarget("US"));
    expect(getNeutralPrimeRate("US", 1953)).toBe(getNeutralPrimeRate("US"));
    expect(getInflationTarget("UK", 1953)).toBe(getInflationTarget("UK"));
  });

  it("neutral cost-of-living index matches the SEED era's data scale (not currentYear)", () => {
    // INCIDENT (t1165 deflation spiral): a flat neutral of 100 assumed all seed
    // data is 100-centered, but 1954-1991-seeded worlds run national CoL near ~50
    // (live prod 1991 world: US 40.1 flat since t1081). Neutral 100 against CoL ~40
    // made the housing term (40−100)×0.25 = −15pp — a permanent deflation force.
    // The neutral must track the SEED era's CoL scale: ~50 for 1954-1991 seeds,
    // 100 for 1953-and-earlier and modern (1999+) seeds. Keyed on seedYear
    // (gameState.startingYear), NOT currentYear — seeded CoL does not rescale as
    // the clock advances. Long-term fix: a data-derived dynamic baseline.
    expect(getCostOfLivingNeutralIndex(1953)).toBe(100);
    expect(getCostOfLivingNeutralIndex(1979)).toBe(50);
    expect(getCostOfLivingNeutralIndex(1991)).toBe(50);
    expect(getCostOfLivingNeutralIndex(2019)).toBe(100);
    expect(getCostOfLivingNeutralIndex(undefined)).toBe(100);
    // A country sitting at its era's CoL center has a zero housing term.
    expect(computeHousingCostPressure(100, getCostOfLivingNeutralIndex(1953))).toBe(0);
    expect(computeHousingCostPressure(50, getCostOfLivingNeutralIndex(1991))).toBe(0);
  });

  // ── Era-aware anchors (1979/1991) ────────────────────────────────────────

  it("resolves honest stagflation-era anchors in 1979 worlds", () => {
    // With the CoL lever gone, the 1979 table is the sole source of era CPI.
    expect(getInflationTarget("US", 1979)).toBe(10.0); // 1979 CPI 11.3%
    expect(getNeutralPrimeRate("US", 1979)).toBe(12.0); // prime ~12.7%
    expect(getInflationTarget("UK", 1979)).toBe(12.0); // RPI 13.4%
    expect(getInflationTarget("JP", 1979)).toBe(4.0);
    expect(getInflationTarget("DE", 1979)).toBe(4.0);
    // FR/IT/ES/SE/TR 1979 anchors are value-identical to the global table
    // (that table's late-1970s calibration IS 1979).
    expect(getInflationTarget("FR", 1979)).toBe(getInflationTarget("FR"));
    expect(getInflationTarget("TR", 1979)).toBe(getInflationTarget("TR"));
    expect(getNeutralPrimeRate("SE", 1979)).toBe(getNeutralPrimeRate("SE"));
  });

  it("resolves moderate disinflation-era anchors in 1991 worlds", () => {
    // Real 1991-97 CPI: US 4.2→2.3, UK 5.9→3, JP 3.3→0.5, DE 4→1.5. The old
    // behavior (modern 2.0 targets + the CoL 50 lever) produced 6.5-8.6%/yr.
    expect(getInflationTarget("US", 1991)).toBe(4.0);
    expect(getInflationTarget("UK", 1991)).toBe(4.5);
    expect(getInflationTarget("JP", 1991)).toBe(2.5);
    expect(getInflationTarget("DE", 1991)).toBe(3.5);
    expect(getInflationTarget("CN", 1991)).toBe(5.0);
    // Layer-1 countries stop inheriting the late-1970s calibration in 1991
    // worlds (IT 15/ES 16/TR 20 read as permanent crisis two decades late).
    expect(getInflationTarget("IT", 1991)).toBe(5.5);
    expect(getInflationTarget("ES", 1991)).toBe(5.5);
    expect(getInflationTarget("FR", 1991)).toBe(3.0);
    expect(getInflationTarget("TR", 1991)).toBe(12.0);
  });

  it("converges to the era target at neutral drivers (steady-state arithmetic)", () => {
    // Closed form: at equilibrium π = prev = rate with raw = T + X,
    //   π = 0.92·(0.35π + 0.65(T+X)) + 0.08T  ⇒  π = T + (0.598/0.678)·X ≈ T + 0.882X.
    // With CoL sitting at its era's neutral center the housing term X_h is 0, so
    // a neutral economy settles at its era target: 1953 ≈ 1-3, 1979 ≈ 8-12,
    // 1991 ≈ 3-5, modern ≈ 2.
    const settle = (countryId: "US" | "UK" | "IT", year?: number) => {
      const targetInflation = getInflationTarget(countryId, year);
      const neutralPrimeRate = getNeutralPrimeRate(countryId, year);
      let inflation = 2.5; // seed value
      for (let t = 0; t < 200; t++) {
        inflation = calculateInflation({
          ...baseline,
          targetInflation,
          neutralPrimeRate,
          primeRate: neutralPrimeRate,
          primeRateHistory: Array(12).fill(neutralPrimeRate),
          housingCostPressure: computeHousingCostPressure(
            getCostOfLivingNeutralIndex(year),
            getCostOfLivingNeutralIndex(year)
          ),
          previousInflation: inflation,
        });
      }
      return inflation;
    };

    expect(settle("IT", 1953)).toBeCloseTo(2.5, 1); // miracolo economico
    expect(settle("US", 1979)).toBeCloseTo(10.0, 1); // stagflation
    expect(settle("UK", 1979)).toBeCloseTo(12.0, 1);
    expect(settle("US", 1991)).toBeCloseTo(4.0, 1); // early-90s disinflation
    expect(settle("UK", 1991)).toBeCloseTo(4.5, 1);
    expect(settle("US", 2019)).toBeCloseTo(2.0, 1); // modern — unchanged
    expect(settle("US")).toBeCloseTo(2.0, 1); // era-less — unchanged
  });

  it("decreases when net savings are being built up (negative savings pressure, weaker)", () => {
    // Net deposits = 80% of balance → pressure = -0.8 * 0.5 = 0.4 pp deflationary
    const rate = calculateInflation({ ...baseline, savingsPressure: -0.8 });
    expect(rate).toBeLessThan(2.0);
  });

  // ── Inertia ──────────────────────────────────────────────────────────────

  it("blends with previous inflation (inertia)", () => {
    // Same economy, but previous inflation was 8% — inertia pulls result up
    const rate = calculateInflation({ ...baseline, previousInflation: 8.0 });
    expect(rate).toBeGreaterThan(2.0);
    // Per-turn delta clamp limits the drop to 1.5 pp, so from 8% it falls to 6.5%
    expect(rate).toBeLessThan(7.0);
  });

  // ── Clamping ─────────────────────────────────────────────────────────────

  it("clamps to max 100%", () => {
    // All drivers maxed out, starting from near the ceiling. The per-turn delta
    // clamp (1.5pp) limits single-turn movement, so reaching 100 requires
    // sustained extreme pressure over many turns. This test verifies the hard
    // ceiling is 100, not 15.
    const extreme: InflationInputs = {
      unemployment: 1.0,
      gdpGrowth: 10.0,
      primeRate: 0.0,
      surplusToGdp: -0.2,
      tariffRate: 30.0,
      wageGrowth: 15.0,
      commodityPressure: 0.5,
      forexPressure: 0.25,
      savingsPressure: 1.0,
      previousInflation: 99.0,
    };
    expect(calculateInflation(extreme)).toBeLessThanOrEqual(100.0);
  });

  it("clamps deflation at the -2% floor (prevents unbounded deflation spiral)", () => {
    // Deeply deflationary drivers from a slightly-negative start. Without the floor
    // this compounds down 1.5pp/turn to -Infinity (the t1166 spiral). The floor pins it.
    const deflationary: InflationInputs = {
      unemployment: 12.0,
      gdpGrowth: -2.0,
      primeRate: 10.0,
      surplusToGdp: 0.1,
      tariffRate: 0.0,
      wageGrowth: 0.0,
      commodityPressure: 0.0,
      forexPressure: 0.0,
      savingsPressure: 0.0,
      previousInflation: -1.5,
    };
    const rate = calculateInflation(deflationary);
    expect(rate).toBeGreaterThanOrEqual(-2.0);
    expect(rate).toBe(-2.0);
  });

  it("allows high-inflation economies above 15% (Brazil 1964 ~90%, Turkey ~30%)", () => {
    // Brazil 1964-style: near-zero unemployment, high wage growth, loose
    // monetary policy, large deficit, depreciated currency. The old 15% cap
    // would pin this at exactly 15, hiding the true magnitude.
    const highInflation: InflationInputs = {
      unemployment: 2.0,
      gdpGrowth: 6.0,
      primeRate: 2.0,
      surplusToGdp: -0.08,
      tariffRate: 20.0,
      wageGrowth: 25.0,
      commodityPressure: 0.3,
      forexPressure: 0.2,
      savingsPressure: 0.5,
      previousInflation: 20.0,
    };
    const rate = calculateInflation(highInflation);
    expect(rate).toBeGreaterThan(15.0);
  });

  it("a normal economy still lands in a single-digit band (raising ceiling does not raise typical values)", () => {
    // Healthy economy at equilibrium: all drivers at neutral, previous
    // inflation at target. Should settle at ~2% regardless of the ceiling.
    const rate = calculateInflation(baseline);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThan(10.0);
    expect(rate).toBeCloseTo(2.0, 0);
  });

  it("recovers deep stale deflation quickly when current drivers are near target", () => {
    const rate = calculateInflation({
      ...baseline,
      previousInflation: -10.0,
    });

    expect(rate).toBeGreaterThan(-5.0);
    expect(rate).toBeLessThanOrEqual(2.0);
  });

  it("sanitizes non-finite inputs instead of returning NaN", () => {
    const rate = calculateInflation({
      unemployment: Number.NaN,
      gdpGrowth: Number.NaN,
      primeRate: Number.NaN,
      primeRateHistory: [3.0, Number.NaN, Number.POSITIVE_INFINITY],
      surplusToGdp: Number.NaN,
      tariffRate: Number.NaN,
      wageGrowth: Number.NaN,
      commodityPressure: Number.NaN,
      forexPressure: Number.NaN,
      savingsPressure: Number.NaN,
      previousInflation: Number.NaN,
    });

    expect(rate).toBeCloseTo(2.0, 0);
    expect(Number.isFinite(rate)).toBe(true);
  });

  // ── Combined scenarios ───────────────────────────────────────────────────

  it("models stagflation: high unemployment + cost-push", () => {
    const stagflation: InflationInputs = {
      ...baseline,
      unemployment: 8.0, // high unemployment
      gdpGrowth: 0.5, // low growth
      tariffRate: 15.0, // trade war
      wageGrowth: 6.0, // wage-price spiral
      previousInflation: 5.0,
    };
    const rate = calculateInflation(stagflation);
    // Despite high unemployment, cost-push should keep inflation above target
    expect(rate).toBeGreaterThan(2.5);
  });

  it("models overheating: low unemployment + loose policy", () => {
    const overheating: InflationInputs = {
      ...baseline,
      unemployment: 3.0,
      gdpGrowth: 4.5,
      primeRate: 1.0,
      surplusToGdp: -0.04,
      wageGrowth: 5.0,
      previousInflation: 3.0,
    };
    const rate = calculateInflation(overheating);
    expect(rate).toBeGreaterThan(4.0);
  });

  it("low rates meaningfully push inflation above target (with no history, uses spot rate)", () => {
    // No history → uses spot rate directly
    const rate = calculateInflation({ ...baseline, primeRate: 0.5 });
    expect(rate).toBeGreaterThan(2.5);
  });

  // ── Monetary lag (trailing rate) ─────────────────────────────────────────

  it("rate cut has minimal immediate effect when history is all neutral", () => {
    // Rate was at neutral (3.0) for 12 turns, just cut to 1.0 this turn.
    // The trailing average should still be close to 3.0, so inflation barely moves.
    const history = [...Array(11).fill(3.0), 1.0]; // 11 turns at 3.0, then 1.0
    const rate = calculateInflation({
      ...baseline,
      primeRate: 1.0,
      primeRateHistory: history,
    });
    // Should be much closer to 2.0 than the no-lag case (~2.8)
    expect(rate).toBeLessThan(2.3);
  });

  it("rate cut fully propagates after being held for 12+ turns", () => {
    // Rate has been at 1.0 for 12+ turns — fully propagated
    const history = Array(12).fill(1.0);
    const rate = calculateInflation({
      ...baseline,
      primeRate: 1.0,
      primeRateHistory: history,
    });
    // Should behave like the spot-rate case (mean reversion pulls slightly toward 2.0)
    expect(rate).toBeGreaterThan(2.4);
  });

  it("rate cut at halfway (6 turns) produces partial effect", () => {
    // Rate was neutral for 6 turns, then cut to 1.0 for 6 turns
    const history = [...Array(6).fill(3.0), ...Array(6).fill(1.0)];
    const ratePartial = calculateInflation({
      ...baseline,
      primeRate: 1.0,
      primeRateHistory: history,
    });
    const rateImmediate = calculateInflation({ ...baseline, primeRate: 1.0 });
    const rateNeutral = calculateInflation(baseline);
    // Partial should be between neutral and full effect
    expect(ratePartial).toBeGreaterThan(rateNeutral);
    expect(ratePartial).toBeLessThan(rateImmediate);
  });

  it("models tight policy taming inflation", () => {
    const tightPolicy: InflationInputs = {
      ...baseline,
      primeRate: 7.0, // aggressive rate hike
      surplusToGdp: 0.01, // balanced-ish
      previousInflation: 6.0,
    };
    const rate = calculateInflation(tightPolicy);
    // High rates would pull inflation down quickly, but the per-turn delta clamp
    // limits the drop to 1.5 pp, so from 6% it can only fall to 4.5% in one turn.
    expect(rate).toBeLessThan(5.0);
    expect(rate).toBeGreaterThan(4.0);
  });
});

describe("policy stance pressure", () => {
  it("adds a positive policy term to the rate and breakdown", () => {
    const { rate, breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      policyStancePressure: 0.4,
    });
    const base = calculateInflation(baseline);
    expect(breakdown.policy).toBeCloseTo(0.4, 10);
    expect(rate).toBeGreaterThan(base);
  });

  it("defaults policy to 0 when omitted (no behaviour change)", () => {
    const { breakdown } = calculateInflationWithBreakdown(baseline);
    expect(breakdown.policy).toBe(0);
  });

  it("a negative (tightening) policy term lowers the rate", () => {
    const tightened = calculateInflation({ ...baseline, policyStancePressure: -0.4 });
    expect(tightened).toBeLessThan(calculateInflation(baseline));
  });
});

describe("FX↔inflation deflation feedback loop", () => {
  const HALFLIFE = 4.0; // FOREX_DEFLATION_ATTENUATION_HALFLIFE

  it("leaves the deflationary forex arm unattenuated at target", () => {
    // previousInflation at target (2.0) → deflationDepth 0 → attenuation 1.0
    const { breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      forexPressure: -0.25, // fully appreciated (clamp edge)
      previousInflation: 2.0,
    });
    // -0.25 * FOREX_PRESSURE_COEFF_DOWN(4.0) = -1.0, untouched
    expect(breakdown.forex).toBeCloseTo(-1.0, 6);
  });

  it("attenuates the deflationary forex arm when already in deflation", () => {
    // previousInflation -8.0 → depth 10 → attenuation 4/(4+10) = 0.2857…
    const { breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      forexPressure: -0.25,
      previousInflation: -8.0,
    });
    expect(breakdown.forex).toBeCloseTo(-1.0 * (HALFLIFE / (HALFLIFE + 10)), 6);
  });

  it("attenuation deepens monotonically as deflation worsens", () => {
    const fx = (prev: number) =>
      calculateInflationWithBreakdown({
        ...baseline,
        forexPressure: -0.25,
        previousInflation: prev,
      }).breakdown.forex;
    // Strictly less deflationary drag the deeper the starting deflation.
    expect(fx(-2)).toBeGreaterThan(fx(2)); // some deflation < at target
    expect(fx(-8)).toBeGreaterThan(fx(-2)); // deeper deflation = weaker drag
    // All remain negative (still deflationary, just damped) and bounded by raw.
    expect(fx(-8)).toBeLessThan(0);
  });

  it("does NOT attenuate the inflationary arm during deflation", () => {
    // A depreciating currency is still fully inflationary even mid-deflation —
    // only the loop's reinforcing (deflationary) arm is damped.
    const { breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      forexPressure: 0.25, // depreciated
      previousInflation: -8.0,
    });
    // 0.25 * FOREX_PRESSURE_COEFF_UP(8.0) = 2.0, untouched
    expect(breakdown.forex).toBeCloseTo(2.0, 6);
  });

  it("near-target appreciation passes through unchanged (regression)", () => {
    // The original behaviour: -0.05 * 4.0 = -0.2 pp at target.
    const { breakdown } = calculateInflationWithBreakdown({
      ...baseline,
      forexPressure: -0.05,
    });
    expect(breakdown.forex).toBeCloseTo(-0.2, 6);
  });

  it("coupled FX+inflation loop recovers from a deflation shock instead of locking deep", () => {
    // All non-FX drivers neutral (would settle inflation at the 2.0 target on their
    // own). The only thing pushing inflation away is the forex term, and the only
    // thing moving the FX rate is inflation — the exact loop we are damping.
    const baseRate = 1.0;
    let rate = 0.7; // currency already deeply appreciated (-30% shock)
    let inflation = -6.0; // deep deflation shock

    for (let t = 0; t < 80; t++) {
      const forexPressure = rate / baseRate - 1;
      inflation = calculateInflation({
        ...baseline,
        forexPressure,
        previousInflation: inflation,
      });
      const macroTarget = computeMacroTarget(
        baseRate,
        { primeRate: 3.0, inflationRate: inflation, gdpGrowth: 2.5, tradeGrowth: 0 }, // US FX-neutral
        "US"
      );
      rate = applyDrift(rate, macroTarget);
    }

    // Without a stabiliser the appreciated currency keeps deflation pinned low.
    // With the brake, both recover toward their neutral equilibrium (≈2% / baseRate).
    expect(inflation).toBeGreaterThan(1.0);
    expect(inflation).toBeLessThanOrEqual(2.0);
    expect(rate).toBeGreaterThan(0.9);
    expect(rate).toBeLessThanOrEqual(1.0);
  });
});

describe("computeEffectivePrimeRate", () => {
  it("returns spot rate when no history", () => {
    expect(computeEffectivePrimeRate(2.0)).toBe(2.0);
    expect(computeEffectivePrimeRate(2.0, [])).toBe(2.0);
  });

  it("returns spot rate when history is all the same value", () => {
    const rate = computeEffectivePrimeRate(3.0, Array(12).fill(3.0));
    expect(rate).toBeCloseTo(3.0, 1);
  });

  it("spot rate has immediate partial effect (30%)", () => {
    // 11 turns at 3.0, then sudden cut to 0.0
    const history = [...Array(11).fill(3.0), 0.0];
    const effective = computeEffectivePrimeRate(0.0, history);
    // 30% of 0.0 + 70% of ~3.0 trailing ≈ 2.1
    // Old behavior: effective > 2.5 (spot had ~8% weight)
    // New behavior: effective should be lower because spot has 30% weight
    expect(effective).toBeLessThan(2.5);
    expect(effective).toBeGreaterThan(1.5);
  });

  it("converges to new rate after 12 turns at that rate", () => {
    const history = Array(12).fill(1.0);
    const effective = computeEffectivePrimeRate(1.0, history);
    expect(effective).toBeCloseTo(1.0, 1);
  });

  it("works with fewer than 12 turns of history", () => {
    // Only 3 turns of history at 1.0
    const effective = computeEffectivePrimeRate(1.0, [1.0, 1.0, 1.0]);
    // Should still produce ~1.0 since all entries are the same
    expect(effective).toBeCloseTo(1.0, 1);
  });

  it("rate cut has meaningful same-turn effect", () => {
    // Rate was 5.0 for 12 turns, just cut to 2.0
    const history = Array(12).fill(5.0);
    const effective = computeEffectivePrimeRate(2.0, history);
    // 30% of 2.0 + 70% of ~5.0 = 0.6 + 3.5 = 4.1
    // Should be noticeably below 5.0 on the very first turn
    expect(effective).toBeLessThan(4.5);
    expect(effective).toBeGreaterThan(3.5);
  });
});

// ── BR/GR audit follow-up: fiscal-term clamp + ratchet/gravity regression ──
//
// Context: a seed audit against a 1953-default sandbox world (turn ~656, year
// 1966) found BR and GR inflation pinned exactly at the model's old 15% cap
// and their NPP central-bank chairs chasing it to 16.7%/16.5% prime rates.
// Root-caused to two DISTINCT bugs (see `monetaryEra.test.ts` for GR's half):
//   - GR had no 1953-era monetary-baseline entry, so it inherited the modern
//     table's late-1970s drachma calibration (target 15.0) a quarter-century
//     early — its OWN target sat at the cap, so it settled there by design,
//     not by a ratchet.
//   - BR's inflation was being driven by an UNCLAMPED fiscal deficit/GDP term:
//     the sandbox BR sits at debt/GDP ≈ 10.1 (maxed CCC credit, 14% interest,
//     debt ceiling frozen since 1953 while principal grew ~46x past it), a
//     fiscal-side one-way ratchet that fed a single-year deficit/GDP ≈ -152%
//     into this file's fiscal term — +22.9pp with no cap, versus commodity and
//     forex pressure which were both already clamped for exactly this reason.
describe("fiscal deficit/GDP clamp (BR debt-spiral guard)", () => {
  it("saturates the fiscal contribution instead of scaling with an unbounded deficit/GDP ratio", () => {
    // -0.50 surplusToGdp = 50% of GDP deficit = the clamp ceiling.
    const atCeiling = calculateInflationWithBreakdown({ ...baseline, surplusToGdp: -0.5 });
    // BR's actual sandbox ratio (~-1.5253, i.e. a 152.5% of GDP deficit) —
    // far beyond the ceiling, and would keep growing turn over turn as the
    // underlying debt-service spiral compounds.
    const beyondCeiling = calculateInflationWithBreakdown({
      ...baseline,
      surplusToGdp: -1.5253,
    });
    // A still-more-extreme ratio (debt/GDP compounding another few years)
    // must NOT push the fiscal term (or the resulting rate) any higher.
    const evenWorse = calculateInflationWithBreakdown({ ...baseline, surplusToGdp: -4.0 });

    expect(beyondCeiling.breakdown.fiscal).toBeCloseTo(atCeiling.breakdown.fiscal, 6);
    expect(evenWorse.breakdown.fiscal).toBeCloseTo(atCeiling.breakdown.fiscal, 6);
    expect(evenWorse.rate).toBeCloseTo(beyondCeiling.rate, 6);

    // The clamp still lets a genuinely catastrophic (but bounded) deficit
    // produce a large, real cost-push term — 50 * 0.15 = 7.5pp — it just
    // stops growing past that.
    expect(atCeiling.breakdown.fiscal).toBeCloseTo(7.5, 3);
  });

  it("surplus side is clamped too (generous, but finite)", () => {
    const atFloor = calculateInflationWithBreakdown({ ...baseline, surplusToGdp: 0.3 });
    const beyondFloor = calculateInflationWithBreakdown({ ...baseline, surplusToGdp: 5.0 });
    expect(beyondFloor.breakdown.fiscal).toBeCloseTo(atFloor.breakdown.fiscal, 6);
  });
});

describe("ratchet regression: inflation comes back DOWN under corrective policy", () => {
  it("a BR-like world in fiscal crisis recovers once fiscal policy turns responsible and rates tighten", () => {
    // Start where a high-attractor crisis world sits: inflation resting near
    // the (old) 15% ceiling, against a chronically-elevated target (10) and
    // neutral (12), driven by a severe deficit, with a chair that has already
    // hiked hard (16.72%) in response. Numbers are a crisis scenario, not
    // BR's 1953 policy target (see monetaryEra.ts / ticket 1124).
    let inflation = 15.0;
    const crisisYears = 30;
    for (let t = 0; t < crisisYears; t++) {
      inflation = calculateInflation({
        targetInflation: 10.0,
        neutralPrimeRate: 12.0,
        unemployment: 5.0,
        gdpGrowth: 2.0,
        primeRate: 16.72,
        primeRateHistory: Array(12).fill(16.72),
        surplusToGdp: -1.5, // still-catastrophic deficit (clamped, but real)
        tariffRate: 3.0,
        wageGrowth: 4.0,
        commodityPressure: 0.0,
        forexPressure: 0.1,
        savingsPressure: 0.0,
        previousInflation: inflation,
      });
    }
    const atCrisisPeak = inflation;
    expect(atCrisisPeak).toBeGreaterThan(10.0); // still in genuine crisis territory

    // Corrective policy: the deficit is brought back to balance (debt
    // restructuring / austerity) while the chair holds a firmly restrictive
    // rate relative to this scenario's own neutral. No ratchet should prevent
    // this from working now that the fiscal term is clamped instead of chasing
    // an ever-worsening (compounding-debt) deficit ratio forever.
    for (let t = 0; t < 100; t++) {
      inflation = calculateInflation({
        targetInflation: 10.0,
        neutralPrimeRate: 12.0,
        unemployment: 5.0,
        gdpGrowth: 2.0,
        primeRate: 16.0, // held well above this scenario's own neutral rate
        primeRateHistory: Array(12).fill(16.0),
        surplusToGdp: 0.0, // fiscal crisis resolved
        tariffRate: 3.0,
        wageGrowth: 2.5,
        commodityPressure: 0.0,
        forexPressure: 0.0,
        savingsPressure: 0.0,
        previousInflation: inflation,
      });
    }

    // There IS a path back down: corrective policy brings inflation
    // meaningfully below where the crisis had it pinned.
    expect(inflation).toBeLessThan(atCrisisPeak - 5.0);
    expect(inflation).toBeLessThan(10.0);
  });
});

describe("gravity-not-rails regression: high inflation stays reachable under bad policy", () => {
  it("sustained deficit spending + an accommodative chair still drives inflation into hyperinflation-adjacent territory", () => {
    let inflation = 10.0;
    for (let t = 0; t < 150; t++) {
      inflation = calculateInflation({
        targetInflation: 10.0, // chronically-elevated attractor (crisis scenario)
        neutralPrimeRate: 12.0,
        unemployment: 1.5, // overheating labor market
        gdpGrowth: 8.0,
        primeRate: 0.0, // dovish chair holding far below neutral throughout
        primeRateHistory: Array(12).fill(0.0),
        surplusToGdp: -0.5, // sustained deficit at (or beyond) the fiscal clamp ceiling
        tariffRate: 30.0,
        wageGrowth: 20.0,
        commodityPressure: 0.5,
        forexPressure: 0.25,
        savingsPressure: 0.8,
        previousInflation: inflation,
      });
    }
    // Gravity: irresponsible fiscal + monetary policy is still able to
    // produce sustained, severe (hyperinflation-adjacent) inflation — the
    // fiscal clamp bounds any single term's growth, it does not cap how high
    // inflation itself can go (MAX_INFLATION is 100, not 15).
    expect(inflation).toBeGreaterThan(25.0);
  });
});

describe("commodity cost-push is a rate, not a level", () => {
  const base = {
    targetInflation: 2.0,
    neutralPrimeRate: 3.0,
    unemployment: 5.0,
    gdpGrowth: 2.0,
    primeRate: 3.0,
    surplusToGdp: 0,
    tariffRate: 3.0,
    wageGrowth: 2.5,
    forexPressure: 0,
    savingsPressure: 0,
    previousInflation: 2.0,
  };

  it("contributes 0.30pp per 1pp of annual commodity inflation", () => {
    // Basket rising 10%/yr → +3.0pp of CPI.
    const { breakdown } = calculateInflationWithBreakdown({
      ...base,
      commodityPressure: 0.1,
    });
    expect(breakdown.commodity).toBeCloseTo(3.0, 6);
  });

  it("passes falling prices through at half rate (downward stickiness)", () => {
    const { breakdown } = calculateInflationWithBreakdown({
      ...base,
      commodityPressure: -0.1,
    });
    expect(breakdown.commodity).toBeCloseTo(-1.5, 6);
  });

  it("clamps an acute supply crisis to +9pp rather than an unbounded shock", () => {
    const { breakdown } = calculateInflationWithBreakdown({
      ...base,
      commodityPressure: 3.0, // +300%/yr
    });
    expect(breakdown.commodity).toBeCloseTo(9.0, 6);
  });

  it("clamps a collapsing basket to -2.25pp", () => {
    const { breakdown } = calculateInflationWithBreakdown({
      ...base,
      commodityPressure: -0.9,
    });
    expect(breakdown.commodity).toBeCloseTo(-2.25, 6);
  });

  it("lets CPI settle at target once commodity prices stop moving", () => {
    // The whole point of the change: a zero rate-of-change contributes nothing,
    // so a bank at neutral with no other pressure converges on its target. Under
    // the old level signal this was impossible — prices sitting above their
    // frozen basePrice injected a permanent constant no policy could answer.
    let rate = 8.0;
    for (let i = 0; i < 200; i++) {
      rate = calculateInflation({ ...base, commodityPressure: 0, previousInflation: rate });
    }
    expect(rate).toBeCloseTo(2.0, 1);
  });
});
