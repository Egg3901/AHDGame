/**
 * What drives GDP growth and what corporations can do to raise it. GDP growth is
 * the revenue-weighted average of sector growth rates in the region
 * (computeWeightedGrowthRate), so owned sectors that grow realized revenue
 * (computeRealizedRevenueGrowthRate) lift it while unowned sectors grow at
 * DEFAULT_UNOWNED_GROWTH_RATE. Unemployment follows growth by Okun's law, and sales
 * or VAT rates above a country's neutral rate cut growth (computeConsumptionTaxAdjustedGrowthRate).
 */
/**
 * GDP Growth — pure helpers & calibration constants.
 *
 * GDP growth is the revenue-weighted average of sector growth rates, adjusted by
 * a consumption-tax wedge. As of the metric-engine port (P0), the turn PHASE that
 * applies these lives in `@/lib/metricEngine` (the `economic.gdpGrowth` /
 * `economic.unemploymentRate` registry nodes + `runMetricEngine`). This module
 * now exports only the pure functions and the shared constants those nodes (and
 * the `sectorRevenueTax` provider) consume — the single source of truth for the
 * gdpGrowth/unemployment math.
 */

import type { CountryId } from "@/lib/constants/countries";
import { JP_ECONOMY } from "@/lib/countries/jp/economy";
import { US_ECONOMY } from "@/lib/countries/us/economy";
import { UK_ECONOMY } from "@/lib/countries/uk/economy";
import { DE_ECONOMY } from "@/lib/countries/de/economy";
import { CN_ECONOMY } from "@/lib/countries/cn/economy";
import { IE_ECONOMY } from "@/lib/countries/ie/economy";
import { BR_ECONOMY } from "@/lib/countries/br/economy";

/** Default daily growth rate for unowned sectors (background economy) */
export const DEFAULT_UNOWNED_GROWTH_RATE = 0.5;

/** Inertia weight for smoothing with previous reading (prevents jarring jumps) */
export const INERTIA = 0.4;

/**
 * Maximum |policyDelta| preserved across the sectorBaseline smoothing step.
 * Without this cap, an out-of-band metric value (e.g. produced by stacked
 * cabinet-order $inc loops before the metric clamp was added) gets locked
 * into the policy delta permanently. Capping it lets natural decay actually
 * pull gdpGrowth back toward sector fundamentals.
 */
// v0 balance fix (2026-06-30): 8 → 4. The policy-coexistence delta was a large
// part of the structural demand–potential wedge (+5–13% sector signal vs ~1–2%
// potential) that pinned the output gap. Halving the cap keeps the impulse closer
// to cyclical. See docs/plans/2026-06-30-macro-balance-v0.md (#2).
export const MAX_POLICY_DELTA = 4;

/**
 * Consumption taxes affect the demand side of GDP growth. The sector pass gives the
 * production-side baseline; this tax wedge nudges that baseline down when sales/VAT
 * rates rise above the country's seeded status quo, and up when they are cut.
 */
const SALES_TAX_GROWTH_COEFFICIENT = 0.05;
const SALES_TAX_GAP_CLAMP = 30;

export const NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY: Partial<Record<CountryId, number>> = {
  US: US_ECONOMY.tax.neutralFederalSalesTax,
  UK: UK_ECONOMY.tax.neutralFederalSalesTax,
  JP: JP_ECONOMY.tax.neutralFederalSalesTax,
  DE: DE_ECONOMY.tax.neutralFederalSalesTax,
};

export const NEUTRAL_STATE_SALES_TAX_BY_COUNTRY: Partial<Record<CountryId, number>> = {
  US: US_ECONOMY.tax.neutralStateSalesTax,
  UK: UK_ECONOMY.tax.neutralStateSalesTax,
  JP: JP_ECONOMY.tax.neutralStateSalesTax,
  DE: DE_ECONOMY.tax.neutralStateSalesTax,
  IE: IE_ECONOMY.tax.neutralStateSalesTax,
  BR: BR_ECONOMY.tax.neutralStateSalesTax,
  CN: CN_ECONOMY.tax.neutralStateSalesTax,
};

// ── Unemployment (simplified Okun's law) ────────────────────────────

/** GDP growth rate considered "neutral" — no employment pressure in either direction */
export const NEUTRAL_GDP_GROWTH = 2.0;

/**
 * How much unemployment drops per 1% GDP growth above neutral.
 * Raised from 0.15 → 0.2 to match a symmetric-ish response with OKUN_COEFFICIENT_UP=0.25,
 * keeping the economy more responsive to booms (intentional rebalance for game feel).
 */
export const OKUN_COEFFICIENT_DOWN = 0.2;

/** How much unemployment rises per 1% GDP growth below neutral */
export const OKUN_COEFFICIENT_UP = 0.25;

/** Inertia for unemployment smoothing (higher = slower to change) */
export const UNEMPLOYMENT_INERTIA = 0.85;

/**
 * Hard floor/ceiling for unemployment.
 * Floor 1.0 (was 2.0): a modern Western "natural rate" floor snapped FR
 * Île-de-France's authored 1953 1.5% (near-full reconstruction employment)
 * up to 2 on turn one. Matches metricDefinitions unemploymentRate minValue.
 */
export const UNEMPLOYMENT_MIN = 1.0;
export const UNEMPLOYMENT_MAX = 15.0;

/**
 * Compute revenue-weighted average growth rate for a collection of sectors.
 * Owned sectors contribute their growthRate; unowned sectors use a low background growth
 * rate so owned-sector contractions can still pull state GDP negative.
 */
export function computeWeightedGrowthRate(
  ownedSectors: Array<{ revenue: number; currentGrowthRate: number; sectorType?: string }>,
  unownedSectors: Array<{ revenue: number; sectorType?: string }>,
  /**
   * §6.1 economic-model concentration (P7b): multiplies each sector's WEIGHT by
   * its alignment to the region's model. Defaults to 1 (no concentration) — when
   * omitted the result is byte-identical to the pre-P7b weighted average, keeping
   * the golden masters green.
   */
  weightMultiplier?: (sectorType: string | undefined) => number
): number {
  const wm = weightMultiplier ?? (() => 1);
  let totalRevenue = 0;
  let weightedGrowth = 0;

  for (const sector of ownedSectors) {
    const w = sector.revenue * wm(sector.sectorType);
    totalRevenue += w;
    weightedGrowth += sector.currentGrowthRate * w;
  }

  for (const sector of unownedSectors) {
    const w = sector.revenue * wm(sector.sectorType);
    totalRevenue += w;
    // Unowned sectors contribute default background growth
    weightedGrowth += DEFAULT_UNOWNED_GROWTH_RATE * w;
  }

  if (totalRevenue === 0) return DEFAULT_UNOWNED_GROWTH_RATE;

  return weightedGrowth / totalRevenue;
}

/**
 * Σ owned-sector realized revenue in HOST-STATE currency (the unit
 * `CorporateSector.revenue` / `realizedRevenue` are stored in).
 *
 * The plants cyclical signal MUST compare this sum turn-to-turn, not the
 * ₳-normalized one. ₳ restatement uses each turn's FX, so a 0.2% GBP move
 * annualizes to ~10pp of phantom GDP growth — the UK "jig every turn"
 * (ticket #1084). Host/host cancels FX. Same per-sector realized-vs-nameplate
 * preference as {@link sumRealizedRevenue} under plants.
 */
export function sumHostRealizedRevenue(
  sectors: Array<{ hostRevenue: number; hostRealizedRevenue?: number }>
): number {
  let total = 0;
  for (const s of sectors) {
    if (typeof s.hostRealizedRevenue === "number" && Number.isFinite(s.hostRealizedRevenue)) {
      total += s.hostRealizedRevenue;
      continue;
    }
    if (typeof s.hostRevenue === "number" && Number.isFinite(s.hostRevenue)) {
      total += s.hostRevenue;
    }
  }
  return total;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Bounds of the `economic.sectorGrowth` node (the cyclical signal). Exported so
 * the plants-mode realized-revenue signal can be clamped to the SAME range
 * BEFORE it reaches the node's EMA, instead of letting a one-turn spike be
 * smoothed in and then bound afterwards.
 */
export const SECTOR_SIGNAL_MIN = -10;
export const SECTOR_SIGNAL_MAX = 15;

/**
 * Plants mode (P2, decision D7) — the cyclical sector signal from REALIZED
 * revenue instead of the sector `currentGrowthRate` field.
 *
 * Under `marketSystemMode >= "plants"` revenue is derived from produced units
 * against plant capacity, so `currentGrowthRate` no longer drives revenue and is
 * vestigial: feeding it into the GDP demand impulse would read a number nothing
 * else respects. The honest replacement is the region's realized-revenue delta,
 * annualized:
 *
 *   growth = (now / prev − 1) × 100 × (turnsPerYear / turnsSincePrev)
 *
 * Region level, not per sector: there is no per-sector previous-revenue snapshot
 * in the engine's pipeline, whereas the phase already persists per-region stocks
 * on the `states` doc (`outputGap`, `capitalStock`) — the region rollup rides
 * that same pattern and needs one number per region.
 *
 * The unowned mass does NOT enter this formula. Its old job was the 0.5 pin that
 * damped owned-sector swings in a weighted average; a realized-revenue delta is
 * already bounded here and smoothed by the node EMA downstream, so the pin would
 * only be a constant drag.
 *
 * Returns `null` when there is no usable baseline (flip turn, unseeded region,
 * zero/absent prior, non-positive turn gap) — the caller then falls back to the
 * legacy signal so the flip turn produces no artificial spike.
 */
export function computeRealizedRevenueGrowthRate(
  realizedNow: number,
  realizedPrev: number | undefined,
  turnsSincePrev: number | undefined,
  turnsPerYear: number
): number | null {
  if (typeof realizedPrev !== "number" || !Number.isFinite(realizedPrev) || realizedPrev <= 0) {
    return null;
  }
  if (!Number.isFinite(realizedNow) || realizedNow < 0) return null;
  if (
    typeof turnsSincePrev !== "number" ||
    !Number.isFinite(turnsSincePrev) ||
    turnsSincePrev <= 0
  ) {
    return null;
  }
  const raw = (realizedNow / realizedPrev - 1) * 100 * (turnsPerYear / turnsSincePrev);
  if (!Number.isFinite(raw)) return null;
  return clamp(raw, SECTOR_SIGNAL_MIN, SECTOR_SIGNAL_MAX);
}

// ── Trailing revenue trend (the one-turn amplifier fix) ─────────────
//
// Annualizing a single turn's realized-revenue delta multiplies ordinary
// revenue churn by turnsPerYear: a ±10% settlement-timing wobble becomes a
// ±480% annualized print, saturating the [-10, 15] signal clamp. Because the
// clamp runs BEFORE the node EMA, the information is destroyed and the
// asymmetric bounds bias the smoothed signal upward, parking the output gap
// open and turning every dip into a deep negative print (the US sawtooth).
//
// The trailing trend measures growth the only way a ±10%-noisy level series
// supports: EMA-smooth the level, log a snapshot of that EMA every few turns,
// and compare the current EMA against a snapshot ~a year back. Both endpoints
// are smoothed and the span divides the noise instead of multiplying it.

/** EMA weight on the CURRENT turn's revenue sum (lag ≈ (1-α)/α ≈ 5.7 turns). */
export const REVENUE_EMA_ALPHA = 0.15;
/** Log an EMA snapshot every N turns. */
export const REVENUE_SNAPSHOT_EVERY = 8;
/** Snapshots retained (7 × 8 = 56 turns ≈ 14 months of baseline depth). */
export const REVENUE_SNAPSHOT_KEEP = 7;
/** Preferred measurement span: one game year. */
export const REVENUE_TREND_TARGET_SPAN = 48;
/** Youngest usable baseline; below this the one-turn fallback still applies. */
export const REVENUE_TREND_MIN_SPAN = 8;

export interface RevenueSnapshot {
  turn: number;
  value: number;
}

export interface RevenueTrendBaseline {
  value: number;
  spanTurns: number;
}

/**
 * A bracketing pair for baseline interpolation: the two sanitized snapshots
 * whose turns straddle `targetTurn` (`older.turn <= targetTurn <= newer.turn`),
 * plus the explicit convex weight on the newer endpoint:
 *
 *   weightNewer = (targetTurn - older.turn) / (newer.turn - older.turn)
 *   value(targetTurn) = older.value + weightNewer * (newer.value - older.value)
 *
 * When `targetTurn` lands exactly on a snapshot the bracket collapses to a
 * single point (weight 0 or 1); callers return that snapshot directly.
 */
export interface RevenueBaselineBracket {
  older: RevenueSnapshot;
  newer: RevenueSnapshot;
  weightNewer: number;
}

/** One turn of revenue-level smoothing. No prior EMA ⇒ seed at the level. */
export function advanceRevenueEma(prevEma: number | undefined, now: number): number {
  if (typeof prevEma !== "number" || !Number.isFinite(prevEma) || prevEma <= 0) return now;
  if (!Number.isFinite(now) || now < 0) return prevEma;
  return prevEma + REVENUE_EMA_ALPHA * (now - prevEma);
}

/**
 * Append the current EMA to the snapshot log when due (first write, or
 * `REVENUE_SNAPSHOT_EVERY` turns since the newest entry), trimming to the
 * retention cap. Entries are kept newest-last.
 */
export function updateRevenueSnapshots(
  snapshots: RevenueSnapshot[] | undefined,
  turn: number,
  emaNow: number
): RevenueSnapshot[] {
  const log = (snapshots ?? []).filter(
    (s) => Number.isFinite(s.turn) && Number.isFinite(s.value) && s.turn < turn
  );
  const newest = log[log.length - 1];
  if (newest !== undefined && turn - newest.turn < REVENUE_SNAPSHOT_EVERY) return log;
  return [...log, { turn, value: emaNow }].slice(-REVENUE_SNAPSHOT_KEEP);
}

/**
 * Sanitize a snapshot log for baseline use: drop entries from the current or a
 * future turn, entries with non-finite turns, and entries with non-finite or
 * non-positive values (zero / corrupt / legacy placeholders carry no level
 * information). Sort ascending by turn and collapse duplicate turns, keeping
 * the last write. Returns the sanitized log, oldest-first.
 */
export function sanitizeRevenueSnapshots(
  snapshots: RevenueSnapshot[] | undefined,
  turn: number
): RevenueSnapshot[] {
  const byTurn = new Map<number, number>();
  for (const s of snapshots ?? []) {
    if (typeof s?.turn !== "number" || !Number.isFinite(s.turn) || s.turn >= turn) continue;
    if (typeof s?.value !== "number" || !Number.isFinite(s.value) || s.value <= 0) continue;
    byTurn.set(s.turn, s.value);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([snapTurn, value]) => ({ turn: snapTurn, value }));
}

/**
 * Find the bracketing pair around `targetTurn` in an already-sanitized
 * (ascending, deduped) log: the newest snapshot at or before the target and
 * the oldest snapshot at or after it. Null when the target falls outside the
 * log (history shallower or staler than the target) or the log is empty.
 * `weightNewer` is the convex interpolation weight on the newer endpoint.
 */
export function bracketRevenueBaselineTarget(
  sanitized: RevenueSnapshot[],
  targetTurn: number
): RevenueBaselineBracket | null {
  let older: RevenueSnapshot | null = null;
  let newer: RevenueSnapshot | null = null;
  for (const s of sanitized) {
    if (s.turn <= targetTurn) older = s;
    if (s.turn >= targetTurn && newer === null) newer = s;
  }
  if (older === null || newer === null) return null;
  if (newer.turn === older.turn) return { older, newer, weightNewer: 0 };
  return {
    older,
    newer,
    weightNewer: (targetTurn - older.turn) / (newer.turn - older.turn),
  };
}

/**
 * Evaluate a bracket at its target turn: level-linear interpolation between
 * the two endpoints. Exact hits return the snapshot value itself.
 */
export function interpolateRevenueBaselineValue(bracket: RevenueBaselineBracket): number {
  return bracket.older.value + bracket.weightNewer * (bracket.newer.value - bracket.older.value);
}

/**
 * The baseline the trend measures against: the interpolated EMA level exactly
 * `REVENUE_TREND_TARGET_SPAN` turns back, linearly interpolated between the
 * two snapshots bracketing that target turn (span 48, so the annualizer is 1).
 * The interpolated value rolls continuously as the target turn advances one
 * turn at a time and meets each snapshot exactly as the target crosses it, so
 * baseline handoff carries no discontinuity.
 *
 * Fallbacks, in order: an exact snapshot hit returns that snapshot; when the
 * target falls outside the log (shallow history above the minimum span, stale
 * snapshots, or a single point) the nearest snapshot at least
 * `REVENUE_TREND_MIN_SPAN` turns old is returned with its actual span, exactly
 * as before. Null while the log is too young — the caller falls back to the
 * one-turn signal.
 */
export function selectRevenueTrendBaseline(
  snapshots: RevenueSnapshot[] | undefined,
  turn: number
): RevenueTrendBaseline | null {
  const log = sanitizeRevenueSnapshots(snapshots, turn);
  if (log.length === 0) return null;
  const targetTurn = turn - REVENUE_TREND_TARGET_SPAN;
  const bracket = bracketRevenueBaselineTarget(log, targetTurn);
  if (bracket !== null) {
    if (bracket.newer.turn === bracket.older.turn || bracket.weightNewer === 0) {
      return { value: bracket.older.value, spanTurns: REVENUE_TREND_TARGET_SPAN };
    }
    if (bracket.weightNewer === 1) {
      return { value: bracket.newer.value, spanTurns: REVENUE_TREND_TARGET_SPAN };
    }
    return {
      value: interpolateRevenueBaselineValue(bracket),
      spanTurns: REVENUE_TREND_TARGET_SPAN,
    };
  }
  let best: RevenueTrendBaseline | null = null;
  for (const s of log) {
    const span = turn - s.turn;
    if (span < REVENUE_TREND_MIN_SPAN) continue;
    if (
      best === null ||
      Math.abs(span - REVENUE_TREND_TARGET_SPAN) <
        Math.abs(best.spanTurns - REVENUE_TREND_TARGET_SPAN)
    ) {
      best = { value: s.value, spanTurns: span };
    }
  }
  return best;
}

/**
 * Annualized growth of the smoothed revenue level over the baseline span,
 * clamped to the same signal bounds as every other sector-signal source.
 */
export function computeTrailingRevenueGrowthRate(
  emaNow: number | undefined,
  baseline: RevenueTrendBaseline | null | undefined,
  turnsPerYear: number
): number | null {
  if (typeof emaNow !== "number" || !Number.isFinite(emaNow) || emaNow < 0) return null;
  if (!baseline || !Number.isFinite(baseline.value) || baseline.value <= 0) return null;
  if (!Number.isFinite(baseline.spanTurns) || baseline.spanTurns <= 0) return null;
  const raw = (emaNow / baseline.value - 1) * 100 * (turnsPerYear / baseline.spanTurns);
  if (!Number.isFinite(raw)) return null;
  return clamp(raw, SECTOR_SIGNAL_MIN, SECTOR_SIGNAL_MAX);
}

/**
 * Σ owned-sector REALIZED revenue for a region (the plants-mode realized rollup).
 *
 * Prefers each sector's persisted `realizedRevenue` — what it actually earned
 * after every realization leg — falling back to nominal `revenue` for sectors
 * the turn processor has not written one for yet. Same basis as
 * `sectorEconomicRevenue` (src/lib/corporations/sectorRevenueBasis.ts).
 *
 * The distinction is load-bearing under plants: there `revenue` is the capacity
 * NAMEPLATE (capacity × mixPrice), and P2 capacity only depreciates. Summing
 * nameplate made both this rollup AND the baseline snapshot the phase persists
 * fall at the depreciation rate every turn, so the cyclical signal read a
 * permanent ~-2.4%/yr recession with no player cause. Both ends must use the
 * realized basis or the delta compares unlike quantities.
 *
 * BELOW plants the realized basis must NOT be used. `realizedRevenue` is written
 * by the sector turn in EVERY mode, so preferring it unconditionally would shift
 * state GDP and the persisted `sectorRealizedRevenue` baseline from nameplate to
 * realized on every capital-mode and legacy-mode world. `plantsEnabled` is
 * therefore required, not optional: callers must thread the mode they already
 * resolved for the phase rather than defaulting it.
 */
export function sumRealizedRevenue(
  sectors: Array<{ revenue: number; realizedRevenue?: number }>,
  plantsEnabled: boolean
): number {
  let total = 0;
  for (const s of sectors) {
    if (
      plantsEnabled &&
      typeof s.realizedRevenue === "number" &&
      Number.isFinite(s.realizedRevenue)
    ) {
      total += s.realizedRevenue;
      continue;
    }
    if (typeof s.revenue === "number" && Number.isFinite(s.revenue)) total += s.revenue;
  }
  return total;
}

export function getNeutralFederalSalesTaxRate(countryId: string): number {
  return NEUTRAL_FEDERAL_SALES_TAX_BY_COUNTRY[countryId as CountryId] ?? 0;
}

export function getNeutralStateSalesTaxRate(countryId: string): number {
  return NEUTRAL_STATE_SALES_TAX_BY_COUNTRY[countryId as CountryId] ?? 0;
}

export function computeConsumptionTaxAdjustedGrowthRate(
  sectorGrowth: number,
  federalSalesTaxRate: number,
  stateSalesTaxRate: number,
  countryId: string
): number {
  const neutralFederal = getNeutralFederalSalesTaxRate(countryId);
  const neutralState = getNeutralStateSalesTaxRate(countryId);
  const taxGap = clamp(
    federalSalesTaxRate - neutralFederal + stateSalesTaxRate - neutralState,
    -SALES_TAX_GAP_CLAMP,
    SALES_TAX_GAP_CLAMP
  );
  return sectorGrowth - taxGap * SALES_TAX_GROWTH_COEFFICIENT;
}
