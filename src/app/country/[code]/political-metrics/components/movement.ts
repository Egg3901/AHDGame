/**
 * Trend arithmetic shared by the registry views.
 *
 * Every metric carries a series of snapshots taken every `historyCadenceTurns`
 * turns, oldest first, so `stepsBack = 0` is the most recent snapshot. A
 * change is always "now against a snapshot", which is why the views label it
 * by the cadence ("the last 24 turns") and never as "since last turn".
 */

// Safe in a client component: historyCadence has no imports of its own, so it
// cannot drag the turn engine into the browser bundle.
import { TURNS_PER_YEAR } from "@/lib/politicalMetrics/historyCadence";

interface Series {
  history: ReadonlyArray<{ turn: number; value: number }>;
}

/** A metric's value `stepsBack` snapshots ago, or null when the series is not that deep. */
export function metricAtSnapshot(metric: Series, stepsBack: number): number | null {
  const index = metric.history.length - 1 - stepsBack;
  return index >= 0 ? metric.history[index].value : null;
}

/**
 * A category's score `stepsBack` snapshots ago: the mean of its metrics at that
 * snapshot, matching `categoryScore`. Null when any of its series is too short.
 */
export function categoryAtSnapshot(
  category: { metrics: ReadonlyArray<Series> },
  stepsBack: number
): number | null {
  if (category.metrics.length === 0) return null;
  let sum = 0;
  for (const metric of category.metrics) {
    const value = metricAtSnapshot(metric, stepsBack);
    if (value === null) return null;
    sum += value;
  }
  return sum / category.metrics.length;
}

/**
 * The overall score `stepsBack` snapshots ago, or null when the series is not
 * that deep yet.
 *
 * Computed per category and then averaged, matching `overallScore` rather than
 * flat-averaging all 63 metrics. The two agree while every category holds seven
 * families, but the category mean is the definition, and a future category of a
 * different size should not silently reweight the history.
 */
export function overallAtSnapshot(
  data: { categories: ReadonlyArray<{ metrics: ReadonlyArray<Series> }> },
  stepsBack: number
): number | null {
  if (data.categories.length === 0) return null;
  let sum = 0;
  for (const category of data.categories) {
    const value = categoryAtSnapshot(category, stepsBack);
    if (value === null) return null;
    sum += value;
  }
  return sum / data.categories.length;
}

/** How many snapshots back reach roughly a game year ago. */
export function yearStepsBack(cadenceTurns: number): number {
  return Math.max(1, Math.round(TURNS_PER_YEAR / cadenceTurns)) - 1;
}

export interface Movement {
  /** Change to one decimal place. */
  delta: number;
  /** The past value the change is measured from. */
  from: number;
}

/** The change from a past value to now, or null when there is no past value yet. */
export function movementSince(current: number, past: number | null): Movement | null {
  if (past === null) return null;
  return { delta: Math.round((current - past) * 10) / 10, from: past };
}

/** "+1.2", "-2" or "0". */
export function formatDelta(delta: number): string {
  return `${delta > 0 ? "+" : ""}${delta}`;
}

/** Gains read green and losses red; no change stays neutral. */
export function deltaTextClass(delta: number): string {
  if (delta > 0) return "text-success";
  if (delta < 0) return "text-error";
  return "text-foreground";
}

/** Shown wherever a change needs a snapshot that does not exist yet. */
export const NO_HISTORY_YET = "Not enough history yet";
