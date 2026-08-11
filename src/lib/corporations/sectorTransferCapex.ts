/**
 * Plant-state transfer rules for sector ownership changes (P3b).
 *
 * Under the plants tier a sector doc carries real, paid-for capital state:
 * `capitalStock` (built capacity), `buildQueue` (capacity paid for but not yet
 * online), `constructionInProgressAnchor` (the ₳ sitting in those orders),
 * `mothballed`, and `plantsStartTurn` (the governor ramp anchor).
 *
 * Every path that moves a sector between corps falls into one of two shapes:
 *
 *   - REASSIGN — the doc itself is re-pointed at a new `corporationId`. The
 *     plant state rides along for free; nothing here is needed.
 *   - MERGE — the incoming doc is folded into a sector the receiver already
 *     operates in that (state, sectorType) and then DELETED. Without an
 *     explicit fold, every field above is destroyed: the buyer pays a
 *     book/NPV price that included in-flight construction and receives
 *     nothing, and the ₳ in CIP simply vanishes from the world's balance
 *     sheet. {@link mergeSectorPlantFields} is that fold.
 *
 * A third shape, CARVE, splits one sector into two (privatization spin-outs):
 * {@link carveSectorPlantFields} slices the plant state by the same fraction
 * the revenue/worker legs use.
 *
 * FX CONTRACT — the one rule that governs this whole module:
 * `costPaidAnchor` and `constructionInProgressAnchor` are ALREADY ₳ (the field
 * names say so). Callers re-denominate `revenue` / `currentGrowthCost` when a
 * sector crosses corp currencies; they must NOT do the same to these. Passing
 * CIP through an FX conversion on a JPY→USD transfer would restate the same
 * money by ~87×. Nothing in this module touches an FX rate.
 */
import type { CorporateSector, SectorBuildOrder } from "@/lib/db/types/corporation";

/** The plant-state subset of a sector doc. Structural so projections fit. */
export interface SectorPlantFields {
  capitalStock?: number | null;
  /**
   * P5 paid basis of `capitalStock`, in ₳. Moves PRO-RATA with the capacity in
   * every transfer: a merge sums it (both plants keep the cash that bought
   * them), a carve slices it by the same fraction as the stock. Never FX
   * converted — same contract as `costPaidAnchor` / CIP above.
   */
  capacityBookAnchor?: number | null;
  buildQueue?: SectorBuildOrder[] | null;
  constructionInProgressAnchor?: number | null;
  mothballed?: boolean | null;
  plantsStartTurn?: number | null;
  /**
   * D13 capital-mode restore point. Carried by every transfer for the same
   * reason the plant state is: a merge that dropped it destroyed the absorbed
   * half's restore point, and a carve that omitted it handed the new corp a row
   * the rollback script can only file under "needs a human decision".
   */
  legacyRevenueShadow?: number | null;
}

/** The `$set` fragment a merge/carve produces. Keys match the sector doc. */
export interface SectorPlantFieldsUpdate {
  capitalStock: number;
  capacityBookAnchor: number;
  buildQueue: SectorBuildOrder[];
  constructionInProgressAnchor: number;
  mothballed: boolean;
  plantsStartTurn: number | null;
  legacyRevenueShadow: number | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const queue = (s: SectorPlantFields): SectorBuildOrder[] =>
  Array.isArray(s.buildQueue) ? s.buildQueue : [];

/** A restore point, or `null` if this row has none / a corrupt one. */
const shadow = (s: SectorPlantFields): number | null =>
  typeof s.legacyRevenueShadow === "number" &&
  Number.isFinite(s.legacyRevenueShadow) &&
  s.legacyRevenueShadow >= 0
    ? s.legacyRevenueShadow
    : null;

/**
 * Fold `incoming`'s plant state into `survivor`, for the merge path of a sector
 * transfer (the incoming doc is deleted immediately afterwards).
 *
 * Field by field:
 * - `capitalStock`  — summed. Two plants in the same market are two plants.
 * - `buildQueue`    — concatenated, re-sorted oldest-landing-first so the turn
 *                     processor's "land everything due" scan keeps its order
 *                     invariant. `costPaidAnchor` copied VERBATIM (see the FX
 *                     contract above); the cancellation refund and the CIP
 *                     total must keep quoting the ₳ actually charged.
 * - `constructionInProgressAnchor` — summed, in ₳. This is the denormalized
 *                     Σ of the merged queue, so it stays consistent by
 *                     construction.
 * - `mothballed`    — AND, not OR. A running plant that absorbs a mothballed
 *                     one is still running; the merged doc must not silently
 *                     idle capacity the buyer just paid for. The reverse
 *                     (mothballed survivor absorbing a running sector) wakes
 *                     the survivor up, which is the safe direction: it produces
 *                     and is visible, rather than quietly earning nothing.
 * - `plantsStartTurn` — the EARLIER of the two. This anchors the launch-safety
 *                     governor's fade-in; taking the later turn would restart
 *                     the ramp on the survivor and re-clamp revenue a corp had
 *                     already ramped past. Null only when neither side has been
 *                     stamped (i.e. neither has run a plants turn yet).
 *
 * Returns a complete `$set` fragment — callers spread it into their existing
 * merge update. Safe to call outside plants: with no plant fields on either
 * side it yields zeros/empties that are identical to what the pre-plants
 * documents already imply.
 */
export function mergeSectorPlantFields(
  survivor: SectorPlantFields,
  incoming: SectorPlantFields
): SectorPlantFieldsUpdate {
  const mergedQueue = [...queue(survivor), ...queue(incoming)].sort(
    (a, b) => a.onlineTurn - b.onlineTurn
  );
  const starts = [survivor.plantsStartTurn, incoming.plantsStartTurn].filter(
    (t): t is number => typeof t === "number" && Number.isFinite(t)
  );
  const shadows = [shadow(survivor), shadow(incoming)].filter((v): v is number => v !== null);
  return {
    capitalStock: num(survivor.capitalStock) + num(incoming.capitalStock),
    // Summed like the capacity it prices. Note a side with NO recorded basis
    // contributes 0 rather than its list value: the survivor of such a merge is
    // under-booked, never over-booked, which is the only safe direction for a
    // number that exits credit cash against.
    capacityBookAnchor: num(survivor.capacityBookAnchor) + num(incoming.capacityBookAnchor),
    buildQueue: mergedQueue,
    constructionInProgressAnchor:
      num(survivor.constructionInProgressAnchor) + num(incoming.constructionInProgressAnchor),
    mothballed: survivor.mothballed === true && incoming.mothballed === true,
    plantsStartTurn: starts.length > 0 ? Math.min(...starts) : null,
    // Summed, on the same reasoning as `capitalStock`: the merged row is both
    // sectors, so the nameplate a rollback should restore it to is both
    // nameplates. Null only when neither side had a restore point — one side
    // having one is better than neither, even though the sum is then short by
    // whatever the shadow-less half was worth.
    legacyRevenueShadow: shadows.length > 0 ? shadows.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * The IDENTITY fold: the plant-state `$set` that leaves `sector` exactly as it
 * is. For failure-path rollbacks, which need to undo a merge by rewriting the
 * survivor's own snapshot.
 *
 * `mergeSectorPlantFields(survivor, {})` looks like it does this and does not:
 * `mothballed` is an AND, so an empty `incoming` gives `undefined === true` ⇒
 * false, and a MOTHBALLED survivor came back from a failed purchase running and
 * producing. Every other field round-tripped. Rollbacks must call this instead.
 */
export function identitySectorPlantFields(sector: SectorPlantFields): SectorPlantFieldsUpdate {
  return {
    capitalStock: num(sector.capitalStock),
    capacityBookAnchor: num(sector.capacityBookAnchor),
    buildQueue: queue(sector),
    constructionInProgressAnchor: num(sector.constructionInProgressAnchor),
    mothballed: sector.mothballed === true,
    plantsStartTurn: typeof sector.plantsStartTurn === "number" ? sector.plantsStartTurn : null,
    legacyRevenueShadow: shadow(sector),
  };
}

/**
 * Slice `fraction` of a sector's plant state off for a carve (privatization
 * spin-out), leaving `1 − fraction` behind on the source row.
 *
 * Capacity and CIP scale linearly, exactly like the revenue/worker legs the
 * carve already scales. Build orders scale in BOTH legs — `unitsOrdered` and
 * `costPaidAnchor` — so the carved corp's CIP still equals Σ of its own queue
 * and the two halves still sum to the original: money is conserved across the
 * split, and neither side can cancel an order for a refund larger than the
 * share of the build it took.
 *
 * `plantsStartTurn` and `mothballed` are COPIED, not split: the ramp anchor and
 * the idle flag describe the plant's history and operating state, and both
 * halves inherit the same history.
 */
export function carveSectorPlantFields(
  sector: SectorPlantFields,
  fraction: number
): SectorPlantFieldsUpdate {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const sourceShadow = shadow(sector);
  return {
    capitalStock: num(sector.capitalStock) * f,
    // Same fraction as the stock, so the per-unit basis is identical on both
    // halves and the two still sum to the original: a carve cannot mint basis.
    capacityBookAnchor: num(sector.capacityBookAnchor) * f,
    buildQueue: queue(sector).map((o) => ({
      ...o,
      unitsOrdered: o.unitsOrdered * f,
      costPaidAnchor: o.costPaidAnchor * f,
    })),
    constructionInProgressAnchor: num(sector.constructionInProgressAnchor) * f,
    mothballed: sector.mothballed === true,
    plantsStartTurn: typeof sector.plantsStartTurn === "number" ? sector.plantsStartTurn : null,
    // Split like revenue: the restore point is a nameplate, and the two halves
    // must still sum to the original one.
    legacyRevenueShadow: sourceShadow === null ? null : sourceShadow * f,
  };
}

/** Narrowing helper: does this doc carry any plant state worth moving? */
export function hasPlantState(sector: SectorPlantFields): boolean {
  return (
    num(sector.capitalStock) > 0 ||
    num(sector.constructionInProgressAnchor) > 0 ||
    queue(sector).length > 0 ||
    sector.mothballed === true ||
    typeof sector.plantsStartTurn === "number"
  );
}

/** Convenience: read the plant subset off a full sector doc. */
export function readSectorPlantFields(sector: Partial<CorporateSector>): SectorPlantFields {
  return {
    capitalStock: sector.capitalStock,
    capacityBookAnchor: sector.capacityBookAnchor,
    buildQueue: sector.buildQueue,
    constructionInProgressAnchor: sector.constructionInProgressAnchor,
    mothballed: sector.mothballed,
    plantsStartTurn: sector.plantsStartTurn,
    legacyRevenueShadow: sector.legacyRevenueShadow,
  };
}
