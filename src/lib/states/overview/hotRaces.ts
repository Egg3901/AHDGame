/**
 * Per-race competitiveness classifier and rollup count.
 *
 * Each race is individually classified as `hot`, `lean`, or `safe`:
 *   - hot:  tight margin (≤ 8) OR no incumbent
 *   - safe: wide margin (> 15) AND incumbent running
 *   - lean: everything in between
 *
 * The user-facing "Competitive Races" KPI counts hot + lean across the
 * `primary` and `general` phases (excludes `upcoming` and `completed`).
 *
 * Threshold tunability: the `≤ 8` and `> 15` cutoffs are starting defaults,
 * not load-bearing constants. Tune via the calibration script under
 * `scripts/debug/race-margin-distribution.mjs` (Phase 1 D4) once real
 * margin distributions are available.
 *
 * See plan §"Phase 1 — Task 1.1" and the `Competitive Race` glossary entry.
 */

export type RaceClassification = "hot" | "lean" | "safe";

export type RacePhase = "primary" | "general" | "completed" | "upcoming";

export interface RaceClassifierInput {
  /** Margin between top two candidates / parties, in percentage points (0..100). */
  topTwoMargin: number;
  /** Whether an incumbent is running. */
  hasIncumbent: boolean;
  /** Election phase discriminant. */
  phase: RacePhase;
}

const HOT_MARGIN_THRESHOLD = 8;
const SAFE_MARGIN_THRESHOLD = 15;

export function classifyRace(input: RaceClassifierInput): RaceClassification {
  if (!input.hasIncumbent) return "hot";
  // Treat invalid input (NaN, negative) as "lean" — conservative for data
  // integrity issues. The adapter in `electionToRaceInput.ts` is expected
  // to default to 100 (safe) when polling/tallies are unavailable; values
  // here outside [0, 100] are anomalies.
  const margin = Number.isFinite(input.topTwoMargin) ? Math.abs(input.topTwoMargin) : 12;
  if (margin <= HOT_MARGIN_THRESHOLD) return "hot";
  if (margin > SAFE_MARGIN_THRESHOLD) return "safe";
  return "lean";
}

export function countCompetitiveRaces(races: RaceClassifierInput[]): number {
  return races.filter(
    (r) => (r.phase === "general" || r.phase === "primary") && classifyRace(r) !== "safe"
  ).length;
}
