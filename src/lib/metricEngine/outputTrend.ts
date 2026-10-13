/**
 * Output TREND and output GAP measured from real output, not from a calibrated
 * potential.
 *
 * Headline `gdpGrowth` is the measured real output growth (the sector signal).
 * Inflation, Okun's law and migration still need to know whether an economy is
 * running hot or cold, so this module tracks a Holt (level + slope) trend of
 * the real output index the headline growth integrates, and reports the gap
 * between actual output and that trend:
 *
 *   predicted gap = gap + (growth − trendGrowth) / turnsPerYear
 *   gap           = (1 − LEVEL_ALPHA) · predicted gap
 *   trendGrowth  += SLOPE_BETA · LEVEL_ALPHA · predicted gap · turnsPerYear
 *
 * Steady growth at any rate converges to gap 0 with trendGrowth equal to that
 * rate, so a fast-growing economy is not "overheating" just for growing. A
 * slowdown opens a negative gap until the trend learns the new pace. The trend
 * is learned from the economy's own history; nothing pulls headline growth.
 *
 * Only the gap and the trend growth are stored: the level form is never needed
 * because the update depends only on their difference.
 */

/** Share of the predicted gap the trend level absorbs per turn (~17-turn half-life). */
export const TREND_LEVEL_ALPHA = 0.04;
/** How fast the trend's growth rate follows a persistent gap. */
export const TREND_SLOPE_BETA = 0.1;
/** The gap is a percent deviation; bounded so a mis-fed signal cannot run away. */
export const TREND_GAP_BOUND: readonly [number, number] = [-15, 15];
/** Trend growth shares the headline growth bounds (annual %). */
export const TREND_GROWTH_BOUND: readonly [number, number] = [-15, 15];

/** Turns over which a live world moves from the legacy headline to the measured one. */
export const REAL_OUTPUT_BLEND_TURNS = 24;

export interface OutputTrendState {
  /** Actual output vs trend (%). Positive = above trend (hot). */
  gap: number;
  /** The trend's annual growth rate (%), learned from measured growth. */
  trendGrowth: number;
}

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const finiteOr = (v: number | undefined, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * First observation for a region with no trend yet: the trend starts AT the
 * measured growth with no gap, so starting the tracker opens no gap by itself.
 */
export function seedOutputTrend(growth: number): OutputTrendState {
  return { gap: 0, trendGrowth: clamp(finiteOr(growth, 0), TREND_GROWTH_BOUND) };
}

/** Advance the trend by one step of `turnsPerYear` given this step's measured growth (annual %). */
export function advanceOutputTrend(
  prev: OutputTrendState,
  growth: number,
  turnsPerYear: number
): OutputTrendState {
  const tpy = Number.isFinite(turnsPerYear) && turnsPerYear > 0 ? turnsPerYear : 1;
  const g = clamp(finiteOr(growth, prev.trendGrowth), TREND_GROWTH_BOUND);
  const gap0 = clamp(finiteOr(prev.gap, 0), TREND_GAP_BOUND);
  const trend0 = clamp(finiteOr(prev.trendGrowth, g), TREND_GROWTH_BOUND);
  const predicted = gap0 + (g - trend0) / tpy;
  const gap = clamp((1 - TREND_LEVEL_ALPHA) * predicted, TREND_GAP_BOUND);
  const trendGrowth = clamp(
    trend0 + TREND_SLOPE_BETA * TREND_LEVEL_ALPHA * predicted * tpy,
    TREND_GROWTH_BOUND
  );
  return { gap, trendGrowth };
}

/**
 * Weight of the measured headline (0 = all legacy, 1 = all measured) at `turn`
 * for a region whose cutover started at `startTurn`. Missing start reads as a
 * completed blend.
 */
export function realOutputBlendWeight(turn: number, startTurn: number | undefined): number {
  if (typeof startTurn !== "number" || !Number.isFinite(startTurn)) return 1;
  return clamp((turn - startTurn) / REAL_OUTPUT_BLEND_TURNS, [0, 1]);
}

/**
 * Cutover start turn for a region with none stored. A region that already ran
 * the legacy gap (it has a stored output gap) blends from now; a fresh region
 * has no legacy headline to protect and starts fully on the measured one.
 */
export function resolveRealOutputStartTurn(
  storedStartTurn: number | undefined,
  hasLegacyGap: boolean,
  turn: number
): number {
  if (typeof storedStartTurn === "number" && Number.isFinite(storedStartTurn))
    return storedStartTurn;
  return hasLegacyGap ? turn : turn - REAL_OUTPUT_BLEND_TURNS;
}

/** Linear blend from the legacy value to the measured one. */
export function blendToMeasured(legacy: number, measured: number, weight: number): number {
  const w = clamp(finiteOr(weight, 1), [0, 1]);
  if (w >= 1) return measured;
  return (1 - w) * finiteOr(legacy, measured) + w * measured;
}
