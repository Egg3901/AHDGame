/**
 * Dynamic inflation calculation per country.
 *
 * Combines real economic drivers that the game already tracks:
 *   - Demand-pull   (Phillips curve: GDP growth + unemployment)
 *   - Monetary       (central bank prime rate vs neutral rate)
 *   - Fiscal         (government deficit as share of GDP)
 *   - Cost-push      (tariff rate + wage growth)
 *
 * The result replaces the static 2.5% `inflationRate` on EconomicGrowthFactors
 * each turn, making inflation emergent from player decisions.
 *
 * **Currency (v0.2.6):** Inflation math here is entirely ratio-based — GDP growth
 * %, unemployment %, prime-rate %, deficit÷GDP %, tariff %, wage growth %. All
 * inputs are dimensionless, so the output percentage is unit-agnostic. The
 * numerator/denominator cancellations (e.g. deficit/GDP) keep the ratio stable
 * regardless of which country currency the underlying budgets denominate in, so
 * no FX conversion is needed.
 */

import { ObjectId, type Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import type { GameState } from "@/lib/db/types/gameState";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import type { Tariff } from "@/lib/db/types/tariff";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { isCommandEconomy } from "@/lib/constants/commandEconomy";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { MONETARY_BASELINES } from "@/lib/constants/currencies";
import { getEraMonetaryBaseline, getEraTrendGdpGrowth } from "@/lib/constants/monetaryEra";
import { transmissionMultiplier } from "@/lib/centralBank/credibility";
import { computeCountryTariffPressure } from "@/lib/tariffs/tariffEffects";
import { buildFtaCoverageLookup, loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { getBankId } from "@/lib/centralBank/helpers";

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Fallback central bank target inflation rate (%) */
const BASE_TARGET = 2.0;

/** Fallback "neutral" real interest rate — the rate at which monetary policy is neither
 *  stimulative nor restrictive. Most central banks peg this around 2.5–3%. */
const NEUTRAL_RATE = 3.0;

/**
 * Phillips-curve coefficients — NOW TWO-SIDED.
 * Unemployment below NAIRU → inflationary (tight labor market).
 * Unemployment above NAIRU → deflationary (slack labor market).
 * Same for GDP growth vs trend.
 *
 * Upward pressure is stronger than downward (asymmetric) because
 * prices are stickier on the way down in the real world.
 */
const NAIRU = 5.0; // Non-accelerating inflation rate of unemployment
const UNEMPLOYMENT_COEFF_UP = 0.3; // tight labor → inflation
const UNEMPLOYMENT_COEFF_DOWN = 0.2; // slack labor → deflation (weaker)
const GDP_GROWTH_COEFF_UP = 0.2; // hot economy → inflation
const GDP_GROWTH_COEFF_DOWN = 0.15; // recession → deflation (weaker)
const TREND_GDP_GROWTH = 2.0;

/** Monetary-policy coefficients: each 1 pp away from neutral rate → this much inflation change.
 *  Asymmetric: high rates (above neutral) suppress demand 3× harder than low rates stimulate. */
const MONETARY_COEFF_LOW = 0.4; // below neutral → stimulative
const MONETARY_COEFF_HIGH = 1.2; // above neutral → deflationary (3× low rate)

/** Number of turns over which a rate change propagates to full effect on inflation.
 *  A change made this turn contributes 1/LAG_TURNS of its effect; a change made
 *  LAG_TURNS ago contributes its full effect. */
const MONETARY_LAG_TURNS = 12;

/** Fiscal coefficient: each 1 pp of deficit/GDP → this much inflation.
 *  Surpluses are mildly deflationary (weaker coefficient). */
const FISCAL_COEFF_DEFICIT = 0.15;
const FISCAL_COEFF_SURPLUS = 0.08;

/**
 * Deficit/GDP clamp (percentage points), applied BEFORE the FISCAL_COEFF
 * multipliers — the same defensive pattern already used for commodity
 * (`COMMODITY_PRESSURE_ROW_*`) and forex (`FOREX_PRESSURE_CLAMP`) pressure,
 * which this term never got.
 *
 * Unlike those two, `deficitPct` has no natural bound: it is a live country's
 * `-surplus/gdp * 100`, and `surplus` is a per-fiscal-year FLOW while `debt`
 * is the compounding STOCK it feeds. A background/layer-1 country (no active
 * GDP-growth engine, so `gdp` never grows) whose debt/GDP ratio has already
 * maxed the credit ladder (`debt.ts` DEBT_THRESHOLDS tops out at 14% interest
 * at CCC) pays ever-larger interest on an ever-larger principal every year
 * with nothing to arrest the ratio — a fiscal-side one-way ratchet distinct
 * from (but upstream of) this file's inflation math. Confirmed live: the 1953
 * sandbox world's BR sits at debt/GDP ≈ 10.1 (CCC, 14% interest, debt ceiling
 * frozen at its 1953 seed value while principal grew ~46x past it), producing
 * a single-year deficit/GDP ≈ -152% that fed a +22.9pp UNCLAMPED fiscal term
 * — enough on its own to explain BR's inflation resting at the model's old
 * 15.0 cap and its NPP chair chasing it to a 16.7% prime rate. Clamping here
 * does not fix the debt-service spiral (that needs a fix in the fiscal/debt
 * engine, tracked separately) but it stops that spiral's fiscal SIGNAL from
 * injecting an unbounded, ever-growing inflation contribution every turn —
 * once deficit/GDP crosses the ceiling the fiscal term stops growing, so
 * mean-reversion (MEAN_REVERSION_COEFF) and the monetary term can still pull
 * inflation back down given corrective policy, instead of chasing a target
 * that recedes forever. The ceiling (50% of GDP) is deliberately generous —
 * real hyperinflation-era deficits (Weimar Germany, Zimbabwe 2008) ran
 * 30-60%+ of GDP, so genuinely catastrophic (but finite) fiscal policy still
 * produces a large, high-teens-pp cost-push term; only an unbounded/still-
 * compounding value is capped.
 */
const FISCAL_DEFICIT_PCT_FLOOR = -30;
const FISCAL_DEFICIT_PCT_CEILING = 50;

/** Cost-push coefficients — now two-sided.
 *  Below-baseline wages/tariffs are mildly deflationary. */
const TARIFF_BASELINE = 3.0;
const TARIFF_COEFF_UP = 0.05;
const TARIFF_COEFF_DOWN = 0.025;
const WAGE_GROWTH_BASELINE = 2.5;
const WAGE_COEFF_UP = 0.15;
const WAGE_COEFF_DOWN = 0.08;

/**
 * Commodity cost-push coefficients.
 *
 * Signal is the median ANNUALIZED CHANGE in the country's national commodity
 * prices (see inflationRecalc.ts) — 0.10 means the basket is rising 10%/yr. The
 * coefficient is therefore a basket weight: at COEFF_UP=30 a basket rising
 * 10%/yr contributes 3.0pp of CPI, i.e. 0.30pp per 1pp of commodity inflation.
 *
 * The weight is deliberately well under 1. Commodity prices ARE most prices, so
 * this channel feeds back on itself: CPI settles near
 * (target + other terms) / (1 - weight), a bounded 1.43x amplification at 0.30
 * that would run away as the weight approached 1.
 *
 * It used to be 3.0 against a price LEVEL (`P_national / P_base - 1`) rather
 * than a rate. `basePrice` is a frozen seed constant, so that term grew without
 * bound and no policy could ever return CPI to target — on prod at turn 221 it
 * was worth +4.1pp (US) to +8.4pp (FR) permanently, with those countries' prices
 * actually flat over the preceding game year. See the block comment in
 * inflationRecalc.ts, and HOUSING_PRESSURE_COEFF below, which retired the
 * identical error in the cost-of-living channel.
 *
 * Asymmetric: falling commodity prices pass through at half the rate of rising
 * ones (downward price stickiness), matching the forex arm.
 */
const COMMODITY_PRESSURE_COEFF_UP = 30.0;
const COMMODITY_PRESSURE_COEFF_DOWN = 15.0;
/**
 * Bounds on the annualized commodity signal before the coefficient, so a country
 * in an acute supply crisis contributes at most +9pp (and a collapsing basket at
 * most -2.25pp) rather than an unbounded shock. FR on prod runs ~+36%/yr and
 * clamps here.
 */
const COMMODITY_PRESSURE_CLAMP_UP = 0.3;
const COMMODITY_PRESSURE_CLAMP_DOWN = -0.15;

/**
 * Forex depreciation cost-push coefficients.
 * Signal is rate / baseRate - 1 — positive = currency depreciated (inflationary import costs).
 * Stronger coefficient than commodity because FX pass-through to consumer prices is fast.
 *
 * Pressure is clamped to [-0.25, 0.25] before applying coefficients, bounding the
 * per-turn contribution to [-1pp, +2pp]. Without the clamp, a rate crossing the baseRate
 * threshold in a single turn triggers a coefficient sign-flip (8.0 → −4.0) that can produce
 * a ~5pp single-turn inflation cliff.
 */
const FOREX_PRESSURE_COEFF_UP = 8.0;
const FOREX_PRESSURE_COEFF_DOWN = 4.0;
const FOREX_PRESSURE_CLAMP = 0.25;

/**
 * Breaks the FX↔inflation deflation feedback loop.
 *
 * The two channels are individually realistic but mutually reinforcing on the
 * way down: below-target inflation lowers a currency's macro FX target
 * (`computeMacroTarget` in rateCalculation.ts), the currency appreciates
 * (`rate / baseRate` falls), and an appreciated currency feeds a *deflationary*
 * forex term back into inflation here — which lowers the FX target again. In a
 * model where the prime rate is player-controlled, there is no automatic
 * monetary-policy reaction to arrest this, so once a currency hits the FX
 * appreciation guardrail the forex term becomes a near-constant deflationary
 * drag that roughly cancels mean-reversion and locks inflation deep below target.
 *
 * The economically-grounded brake is downward price stickiness: once consumer
 * prices are already falling, importers and retailers stop passing through a
 * still-appreciating currency. We model that by attenuating ONLY the deflationary
 * forex arm, scaled by how far below target inflation already sits. At the target
 * the attenuation is 1.0 (no change); `HALFLIFE` pp below target it is 0.5; it
 * decays smoothly toward 0 in deep deflation. The inflationary arm (depreciation)
 * and all near-target behaviour are untouched.
 */
const FOREX_DEFLATION_ATTENUATION_HALFLIFE = 4.0;

/**
 * Savings-flow cost-push coefficients.
 * Signal is (withdrawals - deposits) / balance over 12 turns, clamped to [-1, 1].
 * Positive = net spending out of savings (inflationary demand-pull).
 * Negative = net saving (disinflationary — money leaving circulation).
 * Calibrated from live data: current max observed effect ~0.5 pp at these coefficients.
 */
const SAVINGS_PRESSURE_COEFF_UP = 1.0;
const SAVINGS_PRESSURE_COEFF_DOWN = 0.5;

/**
 * RETIRED (coeff 0). The cost-of-living/housing term is dimensionally wrong: it
 * mapped a price LEVEL `(costOfLiving − baseline)` to an inflation RATE. A high
 * price level is not inflation — Switzerland has a permanently high cost of living
 * and ~1% CPI. No choice of baseline (50, 100, or a dynamic median) fixes that;
 * it only relocates a spurious constant. It is also CIRCULAR (costOfLiving is a
 * consumer price index — using it to predict inflation is using the price index to
 * predict its own growth) and REDUNDANT with the commodity/wage/forex cost-push
 * channels. In prod `costOfLiving` is near-static, so a rate version would be ~0
 * anyway. Term zeroed; the (now inert) baseline/pressure plumbing is removed in a
 * follow-up. See ops-knowledge [[ahd-dynamic-cost-of-living-baseline-plan]] and the
 * t1165 incident [[ahd-deflation-spiral-incident-2026-07-18]]. */
const HOUSING_PRESSURE_COEFF = 0;

/** Hard clamps so inflation stays in a realistic game range.
 *  The -2.0 floor is load-bearing: without it a forex/demand deflation impulse
 *  compounds unbounded (each turn falls by MAX_PER_TURN_DELTA toward an ever-more-
 *  negative target) and, via DEFLATION_PENALTY_COEFF, applies an uncapped negative
 *  corp-margin modifier that bankrupts every company — the t1166 deflation-spiral
 *  incident. The floor also caps the deflation margin penalty at DEFLATION_PENALTY_COEFF
 *  * 2pp. inflationDiagnostics.ts already assumes this -2.0 floor. */
export const MIN_INFLATION = -2.0;
export const MAX_INFLATION = 100.0;

/** Inertia weight: new inflation = INERTIA * previous + (1 - INERTIA) * calculated.
 *  0.35 strikes a balance between policy responsiveness and dampening runaway
 *  feedback loops. Previously 0.2, but at that level any persistently-elevated
 *  factor (e.g. a static wageGrowth seed) becomes a permanent inflation floor
 *  because raw recalculates with the same elevated contribution every turn,
 *  and inertia just averages two equally-high values. */
const INERTIA = 0.35;

/** Mean-reversion pull toward BASE_TARGET applied to the smoothed value.
 *  Each turn, MEAN_REVERSION_COEFF × (BASE_TARGET − smoothed) is added.
 *  Acts as a soft anchor: even if cost-push factors stay elevated, inflation
 *  drifts back toward the central-bank target over time, preventing the
 *  "inertia trap" where prev≈raw locks the rate at whatever it is. */
const MEAN_REVERSION_COEFF = 0.08;

/** Maximum |Δ inflation| allowed per turn from this calculation.
 *  Prevents a single-turn spike when a previously-stuck wageGrowth value
 *  suddenly normalizes (or vice versa). 1.5pp/turn = up to 18pp/year, more
 *  than enough headroom for genuine economic shocks. */
const MAX_PER_TURN_DELTA = 1.5;

/** Deep deflation recovery threshold below target before allowing a faster upward correction. */
const DEEP_DEFLATION_RECOVERY_GAP = 4.0;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ── Public interface ─────────────────────────────────────────────────────────

export interface InflationInputs {
  /** Central bank target inflation rate (%) */
  targetInflation?: number;
  /** Country-specific neutral prime rate (%) */
  neutralPrimeRate?: number;
  /** National average unemployment rate (%) */
  unemployment: number;
  /** National average GDP growth rate (%) */
  gdpGrowth: number;
  /** Central bank prime rate (%) — used as fallback when no history available */
  primeRate: number;
  /** Recent prime rate history, most recent last. When provided, the monetary
   *  policy effect uses a trailing weighted average so rate changes take
   *  MONETARY_LAG_TURNS (12) turns to reach full effect. */
  primeRateHistory?: number[];
  /** Budget surplus as share of GDP (negative = deficit) */
  surplusToGdp: number;
  /** Tariff rate (%) — currently static, will become dynamic */
  tariffRate: number;
  /** Annual wage growth rate (%) */
  wageGrowth: number;
  /**
   * Commodity cost-push signal: avg(P_national / P_base - 1) across all commodities.
   * Positive = commodities above base (inflationary); negative = below base.
   * Defaults to 0.0 when not yet available.
   */
  commodityPressure: number;
  /**
   * Forex depreciation pressure: rate / baseRate - 1.
   * Positive = currency has depreciated since calibration (inflationary — imports cost more).
   * Defaults to 0.0 when not available.
   */
  forexPressure: number;
  /**
   * Savings flow pressure: net 12-turn ledger flow divided by an effective stock
   * (reported national balance plus macro floors and a gross-churn term), clamped
   * to [-1, 1]. Positive = net withdrawals (inflationary); negative = net deposits
   * (mildly deflationary). Not the same as a national "personal savings rate".
   */
  savingsPressure: number;
  /** Cost-of-living index deviation from country baseline, driven mainly by housing/rent pressure. */
  housingCostPressure?: number;
  /** Previous year's inflation rate for inertia smoothing */
  previousInflation: number;
  /**
   * Discretionary monetary-policy stance pressure (pp), summed from the active
   * central-bank-governor stance + orders + emergency. Positive = easing
   * (inflationary), negative = tightening. Steady-state while active. Defaults to 0.
   */
  policyStancePressure?: number;
  /** Annualized M2 growth. Converted to bounded excess-money-growth pressure. */
  moneySupplyGrowthPct?: number;
  /**
   * Central-bank scrutiny (0-100). Dampens the MONETARY term only: a bank the
   * market does not believe has to move further for the same effect on
   * expectations. Loan rates, cost of capital and bond pricing are deliberately
   * untouched, so policy is never inert. Defaults to full credibility.
   */
  centralBankScrutiny?: number;
}

/** Fraction of the spot rate that takes effect immediately (before lag). */
const SPOT_RATE_IMMEDIATE_WEIGHT = 0.3;

/**
 * Compute the effective prime rate for inflation purposes.
 *
 * The spot rate contributes 30% immediately — a rate cut or hike has a
 * meaningful same-turn effect. The remaining 70% comes from a trailing
 * weighted average of recent history (up to MONETARY_LAG_TURNS entries),
 * where older entries carry more weight because they've had more time to
 * propagate through the economy.
 *
 * After 12 turns at a constant rate, effective ≈ spot (both components agree).
 *
 * Falls back to the spot rate when no history is available.
 */
export function computeEffectivePrimeRate(spotRate: number, history?: number[]): number {
  if (!history || history.length === 0) return spotRate;

  // Take at most the last MONETARY_LAG_TURNS entries (most recent last)
  const window = history.slice(-MONETARY_LAG_TURNS);
  const n = window.length;

  // Trailing weighted average: older entries (further from now) get more weight
  // because they've had more time to propagate. Minimum weight of 1/LAG so even
  // the most recent history entry contributes something to the trailing component.
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < n; i++) {
    const turnsAgo = n - 1 - i;
    const propagation = Math.max(
      1 / MONETARY_LAG_TURNS,
      Math.min(1, turnsAgo / MONETARY_LAG_TURNS)
    );
    weightedSum += window[i] * propagation;
    totalWeight += propagation;
  }

  const trailingAvg = totalWeight > 0 ? weightedSum / totalWeight : spotRate;

  // Blend: 30% spot (immediate signal) + 70% trailing (lagged propagation)
  return SPOT_RATE_IMMEDIATE_WEIGHT * spotRate + (1 - SPOT_RATE_IMMEDIATE_WEIGHT) * trailingAvg;
}

/**
 * Signed pp contribution of each inflation driver.
 * All values are in percentage-points. Positive = inflationary, negative = deflationary.
 */
export interface InflationBreakdown {
  /** Base central bank target (always 2.0 pp) */
  base: number;
  /** Demand-pull from unemployment gap vs NAIRU */
  unemployment: number;
  /** Demand-pull from GDP growth gap vs trend */
  gdp: number;
  /** Monetary policy (prime rate vs neutral rate) */
  monetary: number;
  /** Fiscal stance (deficit/surplus as % of GDP) */
  fiscal: number;
  /** Cost-push from tariff rate vs baseline */
  tariff: number;
  /** Cost-push from wage growth vs baseline */
  wage: number;
  /** Cost-push from commodity prices vs base prices */
  commodity: number;
  /** Cost-push from currency depreciation (forex) */
  forex: number;
  /** Demand-pull from net savings outflow */
  savings: number;
  /** Housing/rent pressure from national cost-of-living deviation */
  housing: number;
  /** Discretionary monetary-policy stance (PBoC stance / orders / emergency) */
  policy: number;
  /** Excess annualized M2 growth over real GDP growth. */
  moneySupply?: number;
  /** Net stabilization adjustment: smoothing, mean reversion, limits and rounding. */
  inertia: number;
}

/**
 * Compute inflation and return both the final rate and the signed contribution (pp) of each driver.
 * The single source of truth for the calculation; `calculateInflation` delegates to this.
 */
export function calculateInflationWithBreakdown(inputs: InflationInputs): {
  rate: number;
  breakdown: InflationBreakdown;
} {
  const targetInflationInput = finiteOr(inputs.targetInflation, BASE_TARGET);
  const neutralPrimeRateInput = finiteOr(inputs.neutralPrimeRate, NEUTRAL_RATE);
  const unemploymentInput = finiteOr(inputs.unemployment, NAIRU);
  const gdpGrowthInput = finiteOr(inputs.gdpGrowth, TREND_GDP_GROWTH);
  const primeRateInput = finiteOr(inputs.primeRate, neutralPrimeRateInput);
  const primeRateHistoryInput = inputs.primeRateHistory?.filter(
    (rate): rate is number => typeof rate === "number" && Number.isFinite(rate)
  );
  const surplusToGdpInput = finiteOr(inputs.surplusToGdp, 0);
  const tariffRateInput = finiteOr(inputs.tariffRate, TARIFF_BASELINE);
  const wageGrowthInput = finiteOr(inputs.wageGrowth, WAGE_GROWTH_BASELINE);
  const commodityPressureInput = finiteOr(inputs.commodityPressure, 0);
  const forexPressureInput = finiteOr(inputs.forexPressure, 0);
  const savingsPressureInput = finiteOr(inputs.savingsPressure, 0);
  const housingCostPressureInput = finiteOr(inputs.housingCostPressure, 0);
  const previousInflationInput = finiteOr(inputs.previousInflation, targetInflationInput);
  const policyStancePressureInput = finiteOr(inputs.policyStancePressure, 0);
  const moneySupplyGrowthInput = finiteOr(inputs.moneySupplyGrowthPct, gdpGrowthInput);

  // 1. Demand-pull (Phillips curve) — TWO-SIDED
  const uGap = NAIRU - unemploymentInput; // positive = tight, negative = slack
  const unemployment = uGap >= 0 ? uGap * UNEMPLOYMENT_COEFF_UP : uGap * UNEMPLOYMENT_COEFF_DOWN;

  const gGap = gdpGrowthInput - TREND_GDP_GROWTH; // positive = hot, negative = cold
  const gdp = gGap >= 0 ? gGap * GDP_GROWTH_COEFF_UP : gGap * GDP_GROWTH_COEFF_DOWN;

  // 2. Monetary policy — trailing weighted average so rate changes take 12 turns to fully propagate
  const effectiveRate = computeEffectivePrimeRate(primeRateInput, primeRateHistoryInput);
  const rateGap = neutralPrimeRateInput - effectiveRate;
  const monetaryRaw = rateGap >= 0 ? rateGap * MONETARY_COEFF_LOW : rateGap * MONETARY_COEFF_HIGH;
  // Credibility scales the expectations channel, floored so a discredited bank
  // still gets most of the effect. Full credibility (scrutiny 0) is x1, so this
  // is a no-op for any bank hitting its targets.
  const monetary = monetaryRaw * transmissionMultiplier(inputs.centralBankScrutiny ?? 0);

  // 3. Fiscal pressure — TWO-SIDED
  const deficitPctRaw = -surplusToGdpInput * 100; // positive = deficit
  const deficitPct = Math.max(
    FISCAL_DEFICIT_PCT_FLOOR,
    Math.min(FISCAL_DEFICIT_PCT_CEILING, deficitPctRaw)
  );
  const fiscal =
    deficitPct >= 0 ? deficitPct * FISCAL_COEFF_DEFICIT : deficitPct * FISCAL_COEFF_SURPLUS;

  // 4. Cost-push — TWO-SIDED
  const tariffGap = tariffRateInput - TARIFF_BASELINE;
  const tariff = tariffGap >= 0 ? tariffGap * TARIFF_COEFF_UP : tariffGap * TARIFF_COEFF_DOWN;

  const wageGap = wageGrowthInput - WAGE_GROWTH_BASELINE;
  const wage = wageGap >= 0 ? wageGap * WAGE_COEFF_UP : wageGap * WAGE_COEFF_DOWN;

  const clampedCommodity = Math.max(
    COMMODITY_PRESSURE_CLAMP_DOWN,
    Math.min(COMMODITY_PRESSURE_CLAMP_UP, commodityPressureInput)
  );
  const commodity =
    clampedCommodity >= 0
      ? clampedCommodity * COMMODITY_PRESSURE_COEFF_UP
      : clampedCommodity * COMMODITY_PRESSURE_COEFF_DOWN;

  const clampedForex = Math.max(
    -FOREX_PRESSURE_CLAMP,
    Math.min(FOREX_PRESSURE_CLAMP, forexPressureInput)
  );
  const rawForex =
    clampedForex >= 0
      ? clampedForex * FOREX_PRESSURE_COEFF_UP
      : clampedForex * FOREX_PRESSURE_COEFF_DOWN;
  // Attenuate only the deflationary arm when inflation already sits below target,
  // breaking the FX↔inflation deflation feedback loop (see constant docs above).
  const deflationDepth = Math.max(0, targetInflationInput - previousInflationInput);
  const forex =
    rawForex < 0
      ? rawForex *
        (FOREX_DEFLATION_ATTENUATION_HALFLIFE /
          (FOREX_DEFLATION_ATTENUATION_HALFLIFE + deflationDepth))
      : rawForex;

  const savings =
    savingsPressureInput >= 0
      ? savingsPressureInput * SAVINGS_PRESSURE_COEFF_UP
      : savingsPressureInput * SAVINGS_PRESSURE_COEFF_DOWN;

  const housing = housingCostPressureInput * HOUSING_PRESSURE_COEFF;

  const policy = policyStancePressureInput;
  const moneySupply = Math.max(
    -1.5,
    Math.min(2.5, (moneySupplyGrowthInput - gdpGrowthInput) * 0.08)
  );

  const base = targetInflationInput;
  const rawInflation =
    base +
    unemployment +
    gdp +
    monetary +
    fiscal +
    tariff +
    wage +
    commodity +
    forex +
    savings +
    housing +
    policy +
    moneySupply;

  // Inertia smoothing: INERTIA * previous + (1 - INERTIA) * raw
  // inertia term = smoothed - raw = INERTIA * (previous - raw)
  const smoothedRaw = INERTIA * previousInflationInput + (1 - INERTIA) * rawInflation;

  // Mean-reversion pull toward target inflation: even if cost-push factors stay
  // elevated, this drifts inflation back toward the central-bank target.
  // Without this, an inertia-locked rate (where prev≈raw) never decays.
  const meanReversion = MEAN_REVERSION_COEFF * (targetInflationInput - smoothedRaw);
  const smoothed = smoothedRaw + meanReversion;

  // Per-turn delta clamp: prevents a one-shot wage-growth normalization (or
  // any other large factor shift) from producing a single-turn cliff. The
  // clamp is generous enough not to interfere with normal volatility.
  const delta = smoothed - previousInflationInput;
  const recoveringFromDeepDeflation =
    previousInflationInput < targetInflationInput - DEEP_DEFLATION_RECOVERY_GAP &&
    rawInflation > targetInflationInput - 1 &&
    delta > 0;
  const maxPositiveDelta = recoveringFromDeepDeflation
    ? Math.max(MAX_PER_TURN_DELTA, targetInflationInput - previousInflationInput)
    : MAX_PER_TURN_DELTA;
  const clampedDelta = Math.max(-MAX_PER_TURN_DELTA, Math.min(maxPositiveDelta, delta));
  const clampedSmoothed = previousInflationInput + clampedDelta;

  const rate =
    Math.round(Math.max(MIN_INFLATION, Math.min(MAX_INFLATION, clampedSmoothed)) * 100) / 100;
  // The explanation must reconcile to the settled rate even when a floor,
  // ceiling or per-turn limit binds. Keep economic contributions unchanged;
  // the stabilization row accounts for the complete final adjustment.
  const inertia = rate - rawInflation;

  return {
    rate,
    breakdown: {
      base,
      unemployment,
      gdp,
      monetary,
      fiscal,
      tariff,
      wage,
      commodity,
      forex,
      savings,
      housing,
      policy,
      moneySupply,
      inertia,
    },
  };
}

/**
 * Pure function: compute inflation from economic inputs.
 * Exported for unit-testing; the DB-aware wrapper is `calculateCountryInflation`.
 */
export function calculateInflation(inputs: InflationInputs): number {
  return calculateInflationWithBreakdown(inputs).rate;
}

// ── DB-aware wrapper ─────────────────────────────────────────────────────────

export function computeHousingCostPressure(
  nationalCostOfLiving: number,
  nationalCostOfLivingBaseline: number
): number {
  return finiteOr(nationalCostOfLiving, 100) - finiteOr(nationalCostOfLivingBaseline, 100);
}

/**
 * Neutral (zero-pressure) cost-of-living index for the housing term.
 *
 * MUST match the scale the world's live `costOfLiving` DATA actually sits on —
 * which is fixed by the SEED era and does NOT rescale as the in-game clock
 * advances. The housing term is `(costOfLiving − neutral) × 0.25`, so a neutral
 * that does not match the data's center injects a constant, uncorrectable
 * inflation bias (mean-reversion at coeff 0.08 cannot overcome it).
 *
 * INCIDENT (t1165 deflation spiral, 2026-07-18): this returned a hardcoded 100
 * on the theory that seed CoL is "100-centered." That is true for modern
 * (1999+) seeds, but the LIVE 1991-default prod world runs national CoL flat at
 * ~40-68 (US 40.1 since t1081, DE 49, IE 40, UK 68). Against neutral=100 that
 * made the US housing term (40.1−100)×0.25 = −15pp — a permanent ~−12.5pp
 * deflation force vs the −2.5pp it was at neutral=50. Combined with the removed
 * −2% floor (05f59109c) it drove unbounded deflation. See ops-knowledge
 * [[ahd-deflation-spiral-incident-2026-07-18]] and the dynamic-baseline plan
 * [[ahd-dynamic-cost-of-living-baseline-plan]].
 *
 * Keyed on the SEED year (`gameState.startingYear`), NOT currentYear: the CoL
 * data is calibrated once at seed time and stays there. 1954-1991 seeds center
 * near 50; 1953-and-earlier and modern (1999+) seeds center at 100. This is a
 * stopgap — the long-term fix is a baseline computed from the world's actual CoL
 * distribution (see the plan) so it can never drift from the data again.
 */
export function getCostOfLivingNeutralIndex(seedYear: number | null | undefined): number {
  const year = finiteOr(seedYear, STARTING_YEAR);
  if (year <= 1953) return 100;
  return year <= 1991 ? 50 : 100;
}

/**
 * Central-bank inflation target. Pass the CURRENT in-game year
 * (`gameState.currentYear`) to resolve era-authored anchors (1953/1979/1991
 * spans) — a long-lived world graduates to later anchors as its clock
 * advances. Without a year — or at 1999+ — this resolves from
 * `MONETARY_BASELINES` exactly as before.
 */
export function getInflationTarget(countryId: CountryId, currentYear?: number | null): number {
  const era = getEraMonetaryBaseline(countryId, currentYear);
  if (era) return era.targetInflation;
  return finiteOr(MONETARY_BASELINES[countryId]?.targetInflation, BASE_TARGET);
}

/** Neutral prime rate; era-aware like {@link getInflationTarget}. */
export function getNeutralPrimeRate(countryId: CountryId, currentYear?: number | null): number {
  const era = getEraMonetaryBaseline(countryId, currentYear);
  if (era) return era.neutralPrimeRate;
  return finiteOr(MONETARY_BASELINES[countryId]?.neutralPrimeRate, NEUTRAL_RATE);
}

/**
 * Gather inputs from MongoDB and compute inflation for one country.
 * Called each turn by `recalculateInflationPerTurn()` and during
 * fiscal-year processing in `processFiscalYear()`.
 *
 * Returns the new inflation rate (annual %) — caller persists.
 */
export async function calculateCountryInflation(
  db: Db,
  countryId: CountryId,
  budget: FederalBudget,
  commodityPressure = 0.0,
  forexPressure = 0.0,
  savingsPressure = 0.0,
  policyStancePressure = 0.0,
  moneySupplyGrowthPct = 0.0
): Promise<number> {
  // `typeof NaN === "number"`, so `?? fallback` does not catch NaN that slipped
  // into a persisted field. Any NaN reaching the inflation math recurses every
  // turn via inflationHistory → forexTurn → exchangeRates, so every read is
  // guarded with a finite check and a sane default.
  const finiteOr = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  // 0. World era — drives era-authored anchors (CB targets, neutral rates,
  // trend growth for metric-less countries, CoL neutral index). Keyed on the
  // CURRENT in-game year so anchors graduate as the world's clock advances;
  // absent → modern behavior (fail-safe).
  // Both reads gate the command-economy early return below, and neither depends
  // on the other, so they share one round-trip.
  const [gameState, gc] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentYear: 1, startingYear: 1 } }),
    // Command-economy CPI is administered (held at the era target), not market-driven.
    db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
  ]);
  const currentYear = gameState?.currentYear;
  const commandEconomyEnabled = gc?.commandEconomyEnabled === true;
  if (isCommandEconomy(countryId, currentYear, commandEconomyEnabled)) {
    return getInflationTarget(countryId, currentYear);
  }

  // Everything past the early return is independent of everything else here
  // (national metrics, the central bank doc, tariff layers, this country's
  // sectors, and the FTA pair set), so the five reads share one round-trip
  // instead of running back-to-back. Only `corporations` below depends on a
  // result (`sectors`), so it stays sequential.
  //
  // 1. National-level metrics (unemployment, GDP growth)
  // 2. Central bank prime rate + rate history for trailing monetary lag
  // 4. Tariff cost-push — collapse active tariff layers into one macro pressure
  //    number.
  const nationalDocId = getNationalDocId(countryId);
  const [nationalMetrics, centralBank, tariffs, sectors, activeFtaPairs] = await Promise.all([
    nationalDocId
      ? db.collection<StateMetrics>("macroMetrics").findOne({ _id: nationalDocId })
      : null,
    db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
    db.collection<Tariff>("tariffs").find({ countryId }).toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find(
        { countryId },
        { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } }
      )
      .toArray(),
    loadActiveFtaPairs(db),
  ]);

  const unemployment = finiteOr(nationalMetrics?.economic?.unemploymentRate?.value, 5.0);
  // Countries without a national metrics doc (layer-1) fall back to the
  // era-authored trend growth when one exists, else the legacy 2.5.
  const gdpGrowth = finiteOr(
    nationalMetrics?.economic?.gdpGrowth?.value,
    getEraTrendGdpGrowth(countryId, currentYear) ?? 2.5
  );
  const nationalCostOfLiving = finiteOr(nationalMetrics?.economic?.costOfLiving?.value, 100);
  // Seed year (not currentYear): CoL data is calibrated at seed time and does not
  // rescale as the clock advances — the neutral must match the data's scale.
  const nationalCostOfLivingBaseline = getCostOfLivingNeutralIndex(gameState?.startingYear);
  const housingCostPressure = computeHousingCostPressure(
    nationalCostOfLiving,
    nationalCostOfLivingBaseline
  );

  const primeRate = finiteOr(centralBank?.primeRate, 3.0);
  const centralBankScrutiny = finiteOr(centralBank?.chairInfamy, 0);
  const primeRateHistory = centralBank?.interestRateHistory
    ?.map((s: { rate: number }) => s.rate)
    .filter((r): r is number => typeof r === "number" && Number.isFinite(r));

  // 3. Fiscal stance (surplus / GDP; negative means deficit)
  const gdp = budget.gdp || 27_000_000_000_000;
  const surplusToGdp = finiteOr(budget.surplus, 0) / gdp;

  const corporationIds = [...new Set(sectors.map((sector) => sector.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const corporations =
    corporationIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corporationIds } }, { projection: { countryId: 1 } })
          .toArray()
      : [];
  const corpById = new Map(
    corporations.map((corporation) => [corporation._id.toString(), corporation])
  );
  // FTA coverage neutralises the foreign-trade portion of every tariff layer
  // (broad scopes scale by `1 − partner-share`, narrow scopes flip binary), so
  // partnered trade no longer drives consumer-price inflation.
  const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, activeFtaPairs);
  const tariffRate = finiteOr(
    computeCountryTariffPressure(tariffs, countryId, sectors, corpById, ftaCoverage),
    0
  );

  // 5. Wage growth from economic factors
  const wageGrowth = finiteOr(budget.economicFactors?.wageGrowth, 3.0);

  // 6. Previous inflation for inertia
  const previousInflation = finiteOr(budget.economicFactors?.inflationRate, 2.5);
  const targetInflation = getInflationTarget(countryId, currentYear);
  const neutralPrimeRate = getNeutralPrimeRate(countryId, currentYear);

  const newRate = calculateInflation({
    targetInflation,
    neutralPrimeRate,
    unemployment,
    gdpGrowth,
    primeRate,
    primeRateHistory,
    surplusToGdp,
    tariffRate,
    wageGrowth,
    commodityPressure: finiteOr(commodityPressure, 0),
    forexPressure: finiteOr(forexPressure, 0),
    savingsPressure: finiteOr(savingsPressure, 0),
    policyStancePressure: finiteOr(policyStancePressure, 0),
    moneySupplyGrowthPct: finiteOr(moneySupplyGrowthPct, 0),
    centralBankScrutiny,
    housingCostPressure,
    previousInflation,
  });

  // Last line of defense: if any post-calc sanity check still produces NaN,
  // fall back to the previous turn's rate rather than poison every downstream.
  if (!Number.isFinite(newRate)) {
    console.warn("[calculateCountryInflation] Non-finite inflation result; falling back", {
      countryId,
      unemployment,
      gdpGrowth,
      primeRate,
      primeRateHistoryLength: primeRateHistory?.length ?? 0,
      surplusToGdp,
      tariffRate,
      wageGrowth,
      commodityPressure,
      forexPressure,
      savingsPressure,
      targetInflation,
      neutralPrimeRate,
      nationalCostOfLiving,
      nationalCostOfLivingBaseline,
      housingCostPressure,
      previousInflation,
    });
    return previousInflation;
  }

  return newRate;
}
