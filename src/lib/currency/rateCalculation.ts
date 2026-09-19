/**
 * Why an exchange rate (such as GBP to USD) rose or fell this turn. computeMacroTarget
 * sets the target: a higher prime rate, faster GDP growth and trade growth
 * strengthen a currency, inflation above its target weakens it. applyDrift closes
 * 5% of the gap per turn (about a game year to 90%), applyVolumePressure adds
 * player buy and sell pressure capped at +/-5%, applyNoise adds jitter, and
 * clampRate holds the rate within +/-50% of base.
 */
/**
 * Pure exchange rate math — no DB access.
 *
 * Three components combine each turn to produce an updated rate:
 * 1. Macro fundamental drift — rate gravitates toward a target derived from economic indicators
 * 2. Player volume pressure — net buy/sell activity creates short-term offsets (capped +/-5%)
 * 3. Random noise — small jitter prevents perfectly predictable movement
 *
 * Guardrails clamp the final rate to +/-50% of base rate.
 * See docs/design/currency-exchange.md "Rate Update Formula" for rationale.
 */

import type { CountryId } from "@/lib/constants/countries";
import { getEraMonetaryBaseline } from "@/lib/constants/monetaryEra";
import {
  DRIFT_SPEED,
  RATE_NOISE_MAX,
  RATE_FLOOR_MULTIPLIER,
  RATE_CEILING_MULTIPLIER,
  PRIME_RATE_SENSITIVITY,
  INFLATION_SENSITIVITY,
  ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD,
  ABSOLUTE_INFLATION_SENSITIVITY,
  GDP_GROWTH_SENSITIVITY,
  TRADE_GROWTH_SENSITIVITY,
  VOLUME_PRESSURE_SENSITIVITY,
  VOLUME_PRESSURE_CAP,
  VOLUME_DIRECTION_WEIGHT,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
} from "@/lib/constants/currencies";

// ── Input types ─────────────────────────────────────────────────────────────

/** Economic indicators read from CentralBank for a single country */
export interface MacroInputs {
  primeRate: number;
  inflationRate: number;
  gdpGrowth: number;
  tradeGrowth: number;
}

/** Volume data computed by the volume tracker for a single currency */
export interface VolumeInputs {
  buyVolume24: number;
  sellVolume24: number;
}

// ── 1. Macro fundamental target ─────────────────────────────────────────────

/**
 * Monetary baseline (inflation target + neutral prime rate) the macro target is
 * judged against — era-aware, keyed on the CURRENT in-game year
 * (`gameState.currentYear`). While the world's clock sits inside a historical
 * era span (< 1999: the 1953/1979/1991 spans) this resolves the era-authored
 * anchors from `monetaryEra.ts` and GRADUATES to later anchors as the year
 * advances; at 1999+ — or for callers that pass no year — it resolves
 * `MONETARY_BASELINES` byte-identically to the previous behavior. Without
 * this, a 1953 world at year 1955 whose CPI settles near its era target would
 * be measured against the late-1970s baselines (IT 15, ES 16, TR 20, FR 10)
 * and read as permanent artificial appreciation pressure — and a 1991 world
 * at year 2015 would still be judged against early-90s disinflation targets.
 */
export function resolveMonetaryBaseline(countryId: CountryId, currentYear?: number | null) {
  return getEraMonetaryBaseline(countryId, currentYear) ?? MONETARY_BASELINES[countryId];
}

/**
 * Compute the macro-fundamental target rate for a currency.
 *
 * The target reflects how economic deviations from baseline affect currency strength:
 * - Higher prime rate -> stronger (investors seek yield)
 * - Higher inflation -> weaker (purchasing power erodes)
 * - Higher GDP growth -> stronger (economic confidence)
 * - Higher trade growth -> stronger (trade surplus demand)
 *
 * `currentYear` is the CURRENT in-game year (`gameState.currentYear`); it
 * selects the era monetary baselines (see {@link resolveMonetaryBaseline}).
 * Note the asymmetry with `baseRate`: the anchor rate stays the world's own
 * SEEDED calibration (preset-keyed, see `processForexTurn`), while the
 * deviation terms below are judged against the current era's anchors.
 */
export function computeMacroTarget(
  baseRate: number,
  inputs: MacroInputs,
  countryId: CountryId,
  currentYear?: number | null
): number {
  const economicBaseline = ECONOMIC_BASELINES[countryId];
  const monetaryBaseline = resolveMonetaryBaseline(countryId, currentYear);

  // Absolute-inflation depreciation (#3064 Phase 2) — needs ONLY inflation, so it
  // applies to every currency, including forex-active ones with no full economic
  // baseline (IT/ES/SE/TR/FR/RU). Those previously returned baseRate unchanged, i.e.
  // a fixed peg that never depreciated no matter how high their inflation ran — the
  // perfect carry vehicle. Now inflation above a universal healthy ceiling weakens
  // the currency regardless of its own high baseline, so high inflation costs the
  // holder and cannot be farmed as a free real carry.
  const excessInflation = Math.max(
    0,
    inputs.inflationRate - ABSOLUTE_INFLATION_DEPRECIATION_THRESHOLD
  );
  const absoluteInflationPenalty = excessInflation * ABSOLUTE_INFLATION_SENSITIVITY;

  if (!economicBaseline || !monetaryBaseline) {
    // Not fully modelled (no economic/monetary baseline) — the deviation terms
    // can't be computed, but the absolute-inflation weakening still applies so the
    // currency is no longer a static peg.
    return baseRate * Math.max(0.01, 1 + absoluteInflationPenalty);
  }

  // Rate is "local currency per internal unit", so lower = stronger.
  // Each factor below moves the target in the direction that matches real economics:
  //   higher prime rate  → capital inflows → stronger (lower rate)  → subtract
  //   higher inflation   → purchasing-power erosion → weaker (higher rate) → add
  //   higher GDP growth  → confidence → stronger (lower rate)        → subtract
  //   higher trade growth → surplus demand → stronger (lower rate)   → subtract
  //
  // The deviation inflation term is measured against the currency's OWN
  // targetInflation, so a high-baseline currency sits at par no matter how high its
  // inflation. absoluteInflationPenalty adds the baseline-independent weakening.
  const multiplier =
    1 -
    (inputs.primeRate - monetaryBaseline.neutralPrimeRate) * PRIME_RATE_SENSITIVITY +
    (inputs.inflationRate - monetaryBaseline.targetInflation) * INFLATION_SENSITIVITY +
    absoluteInflationPenalty -
    (inputs.gdpGrowth - economicBaseline.gdpGrowth) * GDP_GROWTH_SENSITIVITY -
    (inputs.tradeGrowth - economicBaseline.tradeGrowth) * TRADE_GROWTH_SENSITIVITY;

  return baseRate * Math.max(0.01, multiplier);
}

// ── 2. Drift toward macro target ────────────────────────────────────────────

/**
 * Drift the current rate toward the macro target.
 *
 * At DRIFT_SPEED = 0.05, a rate shock takes ~48 turns (~1 game year) to converge 90%.
 * This creates multi-month currency trends that give players time to notice and act.
 */
export function applyDrift(currentRate: number, macroTarget: number): number {
  return currentRate + (macroTarget - currentRate) * DRIFT_SPEED;
}

// ── 3. Volume pressure ──────────────────────────────────────────────────────

/**
 * Compute the volume pressure multiplier from net buy/sell activity.
 *
 * Heavy buying pushes the rate above fundamentals temporarily.
 * As volume normalizes, macro drift pulls it back — classic overshoot/correction.
 * Capped at +/-5% to prevent extreme swings from outsized trades.
 */
export function computeVolumePressure(volumes: VolumeInputs): number {
  const netVolume = volumes.buyVolume24 - volumes.sellVolume24;
  const rawPressure = netVolume * VOLUME_PRESSURE_SENSITIVITY;
  return Math.max(-VOLUME_PRESSURE_CAP, Math.min(VOLUME_PRESSURE_CAP, rawPressure));
}

/**
 * Apply volume pressure as a multiplicative offset to the drifted rate.
 */
export function applyVolumePressure(driftedRate: number, volumes: VolumeInputs): number {
  const pressure = computeVolumePressure(volumes);
  // Positive pressure = net buying. Buying a currency strengthens it (lowers rate).
  return driftedRate * (1 - pressure);
}

// ── 4. Random noise ─────────────────────────────────────────────────────────

/**
 * Generate per-turn jitter in the range [-RATE_NOISE_MAX, +RATE_NOISE_MAX].
 *
 * Prevents perfectly predictable rate movement. Uses Math.random() — not
 * cryptographic, but sufficient for game simulation jitter.
 */
export function generateNoise(): number {
  // Uniform distribution in [-RATE_NOISE_MAX, +RATE_NOISE_MAX]
  return (Math.random() * 2 - 1) * RATE_NOISE_MAX;
}

/**
 * Apply noise as a multiplicative offset to the rate.
 *
 * `volatilityMultiplier` scales the jitter magnitude (default 1 = unchanged).
 * The leading reserve currency passes a value < 1 so it moves more calmly than
 * the rest of the market.
 */
export function applyNoise(rate: number, noise?: number, volatilityMultiplier = 1): number {
  const n = (noise ?? generateNoise()) * volatilityMultiplier;
  return rate * (1 + n);
}

// ── 4b. Cycle pressure ──────────────────────────────────────────────────────

/**
 * Apply a 12-hour-regime directional pressure as a multiplicative offset, using
 * the same convention as volume pressure: positive = strengthens the currency
 * (lowers the rate). `cyclePressure` comes from CYCLE_PRESSURE_BY_REGIME.
 */
export function applyCyclePressure(rate: number, cyclePressure: number): number {
  return rate * (1 - cyclePressure);
}

// ── 5. Guardrails ───────────────────────────────────────────────────────────

/**
 * Clamp a rate to the floor/ceiling guardrails (+/-50% from base rate).
 *
 * Prevents runaway devaluation or appreciation. When a rate hits the guardrail,
 * trades still execute but the rate cannot move further in that direction.
 */
export function clampRate(rate: number, baseRate: number): number {
  const floor = baseRate * RATE_FLOOR_MULTIPLIER;
  const ceiling = baseRate * RATE_CEILING_MULTIPLIER;
  return Math.max(floor, Math.min(ceiling, rate));
}

// ── Full pipeline ───────────────────────────────────────────────────────────

export interface RateUpdateResult {
  /** The new exchange rate after all components */
  rate: number;
  /** The macro-fundamental target this turn */
  macroTarget: number;
  /** The volume pressure multiplier applied (for debugging/display) */
  volumePressure: number;
  /** The active 12-hour cycle pressure applied this turn (for debugging/display) */
  cyclePressure: number;
}

/**
 * Run the full rate update pipeline for a single currency.
 *
 * Steps: macro target -> drift -> volume pressure -> cycle pressure -> noise -> clamp.
 * All inputs are pre-fetched by the caller; this function has no side effects.
 *
 * `cyclePressure` is the active 12-hour regime's directional bias (default 0).
 * `currentYear` is the CURRENT in-game year; it selects the era monetary
 * baselines for the macro target (omitted or 1999+ = modern, byte-identical
 * to prior behavior).
 */
export function computeRateUpdate(
  currentRate: number,
  baseRate: number,
  countryId: CountryId,
  macro: MacroInputs,
  volumes: VolumeInputs,
  noise?: number,
  volatilityMultiplier = 1,
  cyclePressure = 0,
  currentYear?: number | null
): RateUpdateResult {
  const macroTarget = computeMacroTarget(baseRate, macro, countryId, currentYear);
  const drifted = applyDrift(currentRate, macroTarget);
  const volumePressure = computeVolumePressure(volumes);
  // Blend 80% macro direction + 20% trade volume direction.
  // Positive pressure = net buying → strengthens currency (lowers rate), hence 1 - pressure.
  const withVolume = drifted * (1 - volumePressure * VOLUME_DIRECTION_WEIGHT);
  const withCycle = applyCyclePressure(withVolume, cyclePressure);
  const withNoise = applyNoise(withCycle, noise, volatilityMultiplier);
  const clamped = clampRate(withNoise, baseRate);

  return {
    rate: clamped,
    macroTarget,
    volumePressure,
    cyclePressure,
  };
}
