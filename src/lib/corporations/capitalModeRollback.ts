/**
 * D13 ROLLBACK SAFETY — capital-mode restore point. Remove this module after
 * the rollback drill passes.
 *
 * Flipping `marketSystemMode` from "plants" back down to "capital" is not
 * self-healing. Under plants the turn processor RESTATES `revenue` from plant
 * output every turn instead of compounding it, so on the turn after a rollback
 * the capital-mode chain would pick up whatever the last plants turn happened
 * to derive and compound forward from there — a silent, permanent rebase of
 * every sector's income, in whichever direction the plants restatement had
 * drifted.
 *
 * `sectorTurn` therefore writes `legacyRevenueShadow` every plants turn: what
 * the pre-plants chain WOULD have written. This module turns that shadow into
 * the document mutation a rollback needs. It is pure — no db, no io — so the
 * decision of what a rollback does is testable on its own, separate from the
 * script that applies it.
 */
import type { CorporateSector } from "@/lib/db/types/corporation";

/** The sector fields a rollback reads. Structural so partial projections fit. */
export interface CapitalModeRollbackInput {
  revenue?: number | null;
  legacyRevenueShadow?: number | null;
  legacyGrowthRateShadow?: number | null;
  legacyTargetGrowthRateShadow?: number | null;
}

export interface CapitalModeRollbackMutation {
  /**
   * `$set` fragment: the nameplate the capital-mode chain must resume from,
   * plus the growth rates it must resume compounding it AT. Plants forces
   * `targetGrowthRate` to 0 and lets `currentGrowthRate` trend down to meet it,
   * so a rollback that restored only `revenue` would hand capital mode a
   * correct nameplate and a permanently frozen growth rate. The rate keys are
   * omitted when the sector carries no growth shadow (pre-fix documents), in
   * which case the live fields are left alone for a human to decide.
   */
  set: { revenue: number; currentGrowthRate?: number; targetGrowthRate?: number };
  /**
   * `$unset` fragment: the shadow itself, plus the plants-only fields that
   * capital mode neither writes nor reads. Left in place they are dead weight
   * that a later re-flip would mistake for live state.
   */
  unset: readonly string[];
}

export interface CapitalModeRollbackResult {
  /** Null when there is nothing to restore — see the skip reasons below. */
  mutation: CapitalModeRollbackMutation | null;
  /** Why a sector was skipped. `null` when a mutation was produced. */
  skipReason: "no-shadow" | "already-equal" | null;
}

/**
 * Compute the rollback mutation for ONE sector.
 *
 * Returns `null` (with a reason) rather than a no-op mutation in two cases:
 *
 * - `no-shadow`   — the sector has no `legacyRevenueShadow`. Either it never
 *                   ran a plants turn, or it was created after the flip. There
 *                   is no restore point, so the rollback MUST leave `revenue`
 *                   alone: writing a guessed value would be worse than the
 *                   plants-derived one, which is at least internally coherent.
 *                   The caller should report these as they are the population
 *                   that needs a human decision.
 * - `already-equal` — shadow and revenue agree (the flip turn is a no-op by
 *                   construction, so a corp rolled back immediately hits this).
 *                   Nothing to write.
 *
 * Non-finite or negative shadows are treated as absent: a corrupt restore point
 * is not a restore point.
 */
export function restoreCapitalModeFromShadow(
  sector: CapitalModeRollbackInput
): CapitalModeRollbackResult {
  const shadow = sector.legacyRevenueShadow;
  if (typeof shadow !== "number" || !Number.isFinite(shadow) || shadow < 0) {
    return { mutation: null, skipReason: "no-shadow" };
  }
  const current = typeof sector.revenue === "number" ? sector.revenue : 0;
  const rate = (v: number | null | undefined): number | undefined =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  const currentGrowthRate = rate(sector.legacyGrowthRateShadow);
  const targetGrowthRate = rate(sector.legacyTargetGrowthRateShadow);
  // `already-equal` only when there is genuinely nothing to write. A sector on
  // the flip turn matches on revenue by construction, but if it carries a
  // growth shadow the rates still have to be put back.
  if (current === shadow && currentGrowthRate === undefined && targetGrowthRate === undefined) {
    return { mutation: null, skipReason: "already-equal" };
  }
  return {
    mutation: {
      set: {
        revenue: shadow,
        ...(currentGrowthRate !== undefined ? { currentGrowthRate } : {}),
        ...(targetGrowthRate !== undefined ? { targetGrowthRate } : {}),
      },
      unset: CAPITAL_MODE_ROLLBACK_UNSET_FIELDS,
    },
    skipReason: null,
  };
}

/**
 * Plants-only sector fields cleared by a rollback, alongside the shadow itself.
 *
 * `capitalStock` is deliberately NOT here: capital mode owns that field too
 * (it is the pre-plants capacity series), and clearing it would zero out the
 * capital-mode capacity the rollback is trying to return to.
 */
export const CAPITAL_MODE_ROLLBACK_UNSET_FIELDS = [
  "legacyRevenueShadow",
  "legacyGrowthRateShadow",
  "legacyTargetGrowthRateShadow",
  "buildQueue",
  "constructionInProgressAnchor",
  // P5 paid basis: a plants-only field, and meaningless below plants (there is
  // no build path there for the basis to diverge from list price). Leaving it
  // behind would have a rolled-back sector carrying a book value derived from
  // builds that mode no longer has.
  "capacityBookAnchor",
  "mothballed",
  "plantsStartTurn",
] as const;

/** Aggregate counts for a rollback run. */
export interface CapitalModeRollbackSummary {
  scanned: number;
  restored: number;
  noShadow: number;
  alreadyEqual: number;
}

/** Fold {@link restoreCapitalModeFromShadow} over a batch, for reporting. */
export function summarizeCapitalModeRollback(
  sectors: readonly (CapitalModeRollbackInput & Partial<Pick<CorporateSector, "_id">>)[]
): CapitalModeRollbackSummary {
  const summary: CapitalModeRollbackSummary = {
    scanned: 0,
    restored: 0,
    noShadow: 0,
    alreadyEqual: 0,
  };
  for (const s of sectors) {
    summary.scanned++;
    const { mutation, skipReason } = restoreCapitalModeFromShadow(s);
    if (mutation) summary.restored++;
    else if (skipReason === "no-shadow") summary.noShadow++;
    else summary.alreadyEqual++;
  }
  return summary;
}
