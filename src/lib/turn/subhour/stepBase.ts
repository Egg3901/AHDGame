import { hasSubhourStep, type SubhourStepStamp } from "./stepFraction";

/**
 * Start-of-hour values the :30 half step overwrote, so the turn can apply the
 * hour's step from exactly where it would have started without the tick.
 *
 * Why the turn rewinds instead of stepping the remaining fraction forward from
 * the half-way value: the inputs that drive a step (sector signal, commodity
 * prices, the clamp on inflation's per-turn move) are refreshed by the turn
 * itself, so the second half cannot be the first half's continuation without
 * changing the hour's result. Rewinding to the stored start value and taking
 * the full step makes "half at :30 plus remainder at the turn" equal the plain
 * hourly step by construction, rounding included.
 *
 * `written` is what the half step stored. If something else moved the field in
 * between (a crisis shock is a `$inc`), the turn keeps that move as an offset
 * on top of the restored start value instead of discarding it.
 */
export interface SubhourBaseValue {
  /** Value before the :30 half step. */
  base: number;
  /** Value the :30 half step wrote. */
  written: number;
}

/** federalBudget: the inflation half step's start values. */
export interface SubhourInflationBase {
  turn: number;
  inflationRate: SubhourBaseValue;
  householdPriceIndex: SubhourBaseValue;
}

/** states: the growth half step's stock start values. */
export interface SubhourGrowthStateBase {
  turn: number;
  gdp: SubhourBaseValue;
  outputGap: SubhourBaseValue;
}

/** exchangeRates: the forex half step's start values. */
export interface SubhourForexBase {
  turn: number;
  rate: SubhourBaseValue;
  macroTarget?: SubhourBaseValue;
}

/**
 * macroMetrics (regional and national) and federalBudget: the growth half
 * step's displayed-rate start value.
 */
export interface SubhourGrowthMetricBase {
  turn: number;
  gdpGrowth: SubhourBaseValue;
}

/**
 * The base record when it belongs to `turn` and the document carries the
 * matching stamp; null otherwise (no tick, a stale record from an earlier
 * hour, or a stamp written by a different system's half step).
 */
export function activeSubhourBase<T extends { turn: number }>(
  stamp: SubhourStepStamp | null | undefined,
  base: T | null | undefined,
  turn: number
): T | null {
  if (!base || base.turn !== turn) return null;
  return hasSubhourStep(stamp, turn) ? base : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Start value for a level-like field (inflation, output gap, a rate). */
export function restoreAdditive(current: unknown, record: SubhourBaseValue): number {
  if (current === record.written || !finite(current)) return record.base;
  return current - (record.written - record.base);
}

/** Start value for a compounding stock (GDP, a price index). */
export function restoreMultiplicative(current: unknown, record: SubhourBaseValue): number {
  if (current === record.written || !finite(current) || !(record.written > 0)) return record.base;
  return current * (record.base / record.written);
}
