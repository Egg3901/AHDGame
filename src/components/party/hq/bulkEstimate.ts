/**
 * The bulk National-HQ tool only drives Build Org now (Contest was folded into
 * Build Org's rival-poach on 2026-06-24). Kept as a single-member union so the
 * container's `bulkMode` state and the estimate plumbing stay explicit.
 */
export type BulkMode = "build";

export type BulkPreview =
  { ok: true; effectiveCost: number; projectedGain?: number } | { ok: false; reason?: string };

export interface BulkEstimateResult {
  /** Number of eligible (ok) selected states. */
  states: number;
  /** Total PS cost across eligible states. */
  totalPS: number;
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
    totalDelta += p.projectedGain ?? 0;
  }

  return {
    states,
    totalPS,
    totalDelta: Math.round(totalDelta * 100) / 100,
    skipped,
    pending,
  };
}
