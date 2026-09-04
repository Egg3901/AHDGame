/**
 * The bulk National-HQ tool only drives Build Org now (Contest was folded into
 * Build Org's rival-poach on 2026-06-24). Kept as a single-member union so the
 * container's `bulkMode` state and the estimate plumbing stay explicit.
 */
export type BulkMode = "build";

export type BulkPreview =
  | {
      ok: true;
      effectiveCost: number;
      projectedGain?: number;
      /** Cash price of this state's click. Absent on a pre-2026-09-02 response. */
      cashPrice?: number;
    }
  | { ok: false; reason?: string };

export interface BulkEstimateResult {
  /** Number of eligible (ok) selected states. */
  states: number;
  /** Total PS cost across eligible states. */
  totalPS: number;
  /**
   * Total cash price across eligible states, in the party's local currency.
   *
   * Bulk Build Org spends the NATIONAL pool, so every selected state bills one
   * shared treasury — unlike the PS ladder, which is per-state. That makes the
   * cash the cost that actually scales with the size of the selection, and it
   * has to be totalled and checked before the run rather than discovered when
   * the loop starts failing halfway through.
   */
  totalCash: number;
  /** Total Org gain across eligible states, 2-decimal rounded. */
  totalDelta: number;
  /** Selected states whose preview returned ok:false (no presence / nothing to build). */
  skipped: string[];
  /** Selected states with no cached preview yet (still loading). */
  pending: string[];
}

/**
 * Sum cached per-state Build Org previews for the current bulk selection. Pure
 * so the running estimate can recompute instantly as the selection toggles — the
 * container caches previews by region and passes them in.
 */
export function sumBulkEstimate(input: {
  selected: string[];
  previews: Record<string, BulkPreview | undefined>;
}): BulkEstimateResult {
  let states = 0;
  let totalPS = 0;
  let totalCash = 0;
  let totalDelta = 0;
  const skipped: string[] = [];
  const pending: string[] = [];

  for (const id of input.selected) {
    const p = input.previews[id];
    if (!p) {
      pending.push(id);
      continue;
    }
    if (!p.ok) {
      skipped.push(id);
      continue;
    }
    states += 1;
    totalPS += p.effectiveCost;
    totalCash += p.cashPrice ?? 0;
    totalDelta += p.projectedGain ?? 0;
  }

  return {
    states,
    totalPS,
    totalCash,
    totalDelta: Math.round(totalDelta * 100) / 100,
    skipped,
    pending,
  };
}
