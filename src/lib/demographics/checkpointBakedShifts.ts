/**
 * Checkpoint de-duplication for the interpolated era baseline.
 *
 * THE PROBLEM
 * -----------
 * The era anchor tables (`DEMOGRAPHIC_POSITIONS` / `STATE_POSITION_OVERRIDES`
 * in `src/lib/seeds/demographicCategories.ts`) are authored from real election
 * results, so a later anchor already contains the history that the era
 * checkpoints in `eraCheckpoints.ts` model as a live pull. Alabama's
 * `race.white` economic lean is authored at −3.0 in 1953 and +2.5 in 1979 —
 * that +5.5 IS the Southern realignment. `SOUTHERN_REALIGNMENT_CHECKPOINT`
 * separately applies a durable +3.5 to the same (dim, bucket, state, axis)
 * through `durableRealignment.ts` → `layer1PositionOverrides`.
 *
 * Interpolating the anchors as a live baseline therefore counts the same
 * history twice: a 1953-seeded world reaching 1979 would land on +2.5
 * (baseline) + 3.5 (overlay) = +6.0, clamped to the +5 axis edge, pinning the
 * state at the extreme of the scale.
 *
 * THE FIX
 * -------
 * Subtract from each anchor exactly what the checkpoints had delivered by that
 * anchor's year, so that
 *
 *     interpolated baseline  +  durable overlay  ==  the authored anchor
 *
 * at every anchor, and moves smoothly between them. The checkpoint keeps
 * owning the movement (gravity), while the anchors keep describing history
 * (seed truth), and neither double-counts the other.
 *
 * WHY THIS IS SAFE TO DO UNCONDITIONALLY (given the 1953 gate)
 * -----------------------------------------------------------
 * Subtracting a shift that never gets re-added would silently move the
 * electorate the wrong way, so this is only sound where the checkpoint is
 * GUARANTEED to run. Two facts make that true:
 *
 *  1. Every checkpoint always fires. `resolveCheckpointStartTurn` returns
 *     `fallbackStartTurn` when the trigger case is missing, undecided, or
 *     diverged — a differently-composed Court delays history, it never
 *     cancels it. Brown v. Board is additionally `historicalOutcomeLocked`
 *     (`src/lib/scotus/divergence.ts`), so it always affirms at its real date.
 *  2. Checkpoints only run in 1953-seeded worlds —
 *     `eraCheckpointTurn.ts` returns early unless `startingYear === 1953`.
 *
 * So this module applies the subtraction under that exact same gate and no
 * other. A world seeded in any later era never runs the checkpoints and
 * therefore uses its authored anchors untouched. `CHECKPOINT_SEED_YEAR` below
 * is deliberately the single shared constant behind both gates: if the
 * checkpoint processor's gate ever widens, this must widen with it or the two
 * halves will disagree.
 *
 * PACING vs HISTORY
 * -----------------
 * The subtraction uses `EraCheckpoint.historicalWindow` (real-world years),
 * NOT `fallbackStartTurn`/`durationTurns` (in-world turns). The anchors were
 * authored against history, so the amount baked into the 1979 table is the
 * amount history had delivered by 1979 — independent of whether a particular
 * world's docket paced the pull early or late. Using in-world turns here would
 * make a pure function of the year depend on world state.
 *
 * In practice every registered checkpoint's window closes by 1975, so at the
 * only anchors that exist today the subtraction is all-or-nothing: zero at
 * 1953, the full `totalShift` at 1979 and later. The fractional path is
 * implemented anyway so that adding an anchor inside a window (or a checkpoint
 * spanning one) stays correct without a rewrite.
 */
import { ERA_CHECKPOINTS, type EraCheckpoint } from "./eraCheckpoints";

/**
 * The only `startingYear` whose worlds run era checkpoints. Must stay in sync
 * with the gate in `src/lib/turn/eraCheckpointTurn.ts` — see the module doc.
 */
export const CHECKPOINT_SEED_YEAR = 1953;

/**
 * Axes a baseline table can carry. The two lean axes live on the position
 * table; `turnout` is a separate substrate (bucket RATES, percentage points)
 * with its own overlay, but it needs identical de-duplication — the Voting
 * Rights Act checkpoint adds +40pp to `race:black` turnout in MS/AL and +20pp
 * in LA/GA/SC/VA, and the authored era turnout tables describe the same
 * enfranchisement. Without subtracting it the covered states would receive the
 * franchise twice.
 */
export type BakedAxis = "economicLean" | "socialLean" | "turnout";

/**
 * Fraction of a checkpoint's `totalShift` that real history had delivered by
 * `year`: 0 before the window opens, 1 after it closes, linear inside.
 * A checkpoint with no `historicalWindow` is treated as not baked into the
 * anchors at all (fraction 0) — the conservative direction, since
 * under-subtracting leaves a visible double-count to find, while
 * over-subtracting silently moves the electorate the wrong way.
 */
export function historicalDeliveredFraction(checkpoint: EraCheckpoint, year: number): number {
  const win = checkpoint.historicalWindow;
  if (!win) return 0;
  if (year <= win.startYear) return 0;
  if (year >= win.endYear) return 1;
  return (year - win.startYear) / (win.endYear - win.startYear);
}

/**
 * Total per-(dim, bucket) lean shift the checkpoints had baked into the
 * authored anchor tables for `stateId` by `year`, keyed `"dim:key"` → delta.
 *
 * Every checkpoint target is a (`dim`, `bucket`) pair and lands on its bucket
 * directly, exactly as `eraCheckpointTurn.ts` applies it, so the subtraction
 * matches what the overlay will re-add.
 *
 * Returns an empty record for any world that does not run checkpoints.
 */
export function bakedCheckpointBucketShifts(
  stateId: string,
  axis: BakedAxis,
  year: number,
  startingYear: number | null | undefined,
  countryId = "US"
): Record<string, number> {
  if (startingYear !== CHECKPOINT_SEED_YEAR) return {};

  const bucketShifts: Record<string, number> = {};
  for (const checkpoint of ERA_CHECKPOINTS) {
    if (checkpoint.countryId !== countryId) continue;
    const fraction = historicalDeliveredFraction(checkpoint, year);
    if (fraction === 0) continue;

    for (const target of checkpoint.targets) {
      if (target.axis !== axis) continue;
      if (!target.stateIds.includes(stateId)) continue;
      if (!target.dim || !target.bucket) continue;
      const k = `${target.dim}:${target.bucket}`;
      bucketShifts[k] = (bucketShifts[k] ?? 0) + target.totalShift * fraction;
    }
  }
  return bucketShifts;
}
