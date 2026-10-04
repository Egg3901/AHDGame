/**
 * Plant-state transfer rules for sector ownership changes (P3b).
 *
 * Under the plants tier a sector doc carries real, paid-for capital state:
 * `capitalStock` (built capacity), `buildQueue` (capacity paid for but not yet
 * online), `mothballed`, and `plantsStartTurn` (the governor ramp anchor).
 * `constructionInProgressAnchor` is derived from `buildQueue` by sectorTurn.
 *
 * Every path that moves a sector between corps falls into one of two shapes:
 *
 *   - REASSIGN — the doc itself is re-pointed at a new `corporationId`. The
 *     plant state rides along for free; nothing here is needed.
 *   - MERGE — the incoming doc is folded into a sector the receiver already
 *     operates in that (state, sectorType) and then DELETED. Without an
 *     explicit fold, every field above is destroyed: the buyer pays a
 *     book/NPV price that included in-flight construction and receives
 *     nothing, and the paid orders disappear from the world's balance
 *     sheet. {@link mergeSectorPlantFields} is that fold.
 *
 * A third shape, CARVE, splits one sector into two (privatization spin-outs):
 * {@link carveSectorPlantFields} allocates capacity by the whole facility
 * counts assigned to each owner. The divisible revenue and worker legs retain
 * their requested transaction fraction.
 *
 * FX CONTRACT: `costPaidAnchor` is already ₳. Callers re-denominate `revenue`
 * and `currentGrowthCost` when a sector crosses corp currencies; they must not
 * re-denominate paid build orders. Nothing in this module touches an FX rate.
 */
import { mergedActiveCapacityPercent } from "@/lib/corporations/investment/rules";
import type { CorporateSector, SectorBuildOrder } from "@/lib/db/types/corporation";
import type { CorporationType } from "@/lib/constants/corporations";
import type { MediaDiscriminator } from "@/lib/constants/corporations";
import { seedPlantLedger, splitWholePlantCount } from "@/lib/corporations/plantLedger";

/** The plant-state subset of a sector doc. Structural so projections fit. */
export interface SectorPlantFields {
  sectorType?: CorporationType | null;
  industryModel?: string | null;
  mediaDiscriminator?: MediaDiscriminator | null;
  capitalStock?: number | null;
  operatingCapacityUnits?: number | null;
  operatingCapacityTurn?: number | null;
  plantCount?: number | null;
  plantUnitRemainder?: number | null;
  /**
   * P5 paid basis of `capitalStock`, in ₳. Moves PRO-RATA with the capacity in
   * every transfer: a merge sums it (both plants keep the cash that bought
   * them), a carve slices it by the same fraction as the stock. Never FX
   * converted — same contract as `costPaidAnchor` / CIP above.
   */
  capacityBookAnchor?: number | null;
  buildQueue?: SectorBuildOrder[] | null;
  mothballed?: boolean | null;
  activeCapacityPercent?: number | null;
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
  operatingCapacityUnits?: number;
  operatingCapacityTurn?: number | null;
  plantCount: number;
  plantUnitRemainder: number;
  capacityBookAnchor: number;
  buildQueue: SectorBuildOrder[];
  mothballed: boolean;
  activeCapacityPercent?: number;
  plantsStartTurn: number | null;
  legacyRevenueShadow: number | null;
}

const num = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const queue = (s: SectorPlantFields): SectorBuildOrder[] =>
  Array.isArray(s.buildQueue) ? s.buildQueue : [];

const count = (s: SectorPlantFields): number => {
  if (s.sectorType)
    return seedPlantLedger(s.sectorType, s.capitalStock, s.industryModel, s.mediaDiscriminator)
      .plantCount;
  if (Number.isInteger(s.plantCount) && (s.plantCount ?? 0) >= 0) {
    return s.plantCount as number;
  }
  return 0;
};

const remainder = (s: SectorPlantFields): number => {
  if (s.sectorType)
    return seedPlantLedger(s.sectorType, s.capitalStock, s.industryModel, s.mediaDiscriminator)
      .plantUnitRemainder;
  return typeof s.plantUnitRemainder === "number" &&
    Number.isFinite(s.plantUnitRemainder) &&
    s.plantUnitRemainder > 0
    ? s.plantUnitRemainder
    : 0;
};

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
 *                     contract above); the cancellation refund and queue-
 *                     derived CIP keep quoting the ₳ actually charged.
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
  if ((survivor.industryModel ?? null) !== (incoming.industryModel ?? null)) {
    throw new Error("Cannot merge plant ledgers across different industry models");
  }
  if ((survivor.mediaDiscriminator ?? null) !== (incoming.mediaDiscriminator ?? null)) {
    throw new Error("Cannot merge plant ledgers across different media models");
  }
  const activePercent = mergedActiveCapacityPercent([survivor, incoming]);
  const mergedQueue = [...queue(survivor), ...queue(incoming)].sort(
    (a, b) => a.onlineTurn - b.onlineTurn
  );
  const starts = [survivor.plantsStartTurn, incoming.plantsStartTurn].filter(
    (t): t is number => typeof t === "number" && Number.isFinite(t)
  );
  const shadows = [shadow(survivor), shadow(incoming)].filter((v): v is number => v !== null);
  const sectorType = survivor.sectorType ?? incoming.sectorType ?? null;
  const capitalStock = num(survivor.capitalStock) + num(incoming.capitalStock);
  const mergedLedger = sectorType
    ? seedPlantLedger(
        sectorType,
        capitalStock,
        survivor.industryModel ?? incoming.industryModel,
        survivor.mediaDiscriminator ?? incoming.mediaDiscriminator
      )
    : null;
  return {
    capitalStock,
    ...(survivor.operatingCapacityUnits != null || incoming.operatingCapacityUnits != null
      ? {
          operatingCapacityUnits:
            num(survivor.operatingCapacityUnits ?? survivor.capitalStock) +
            num(incoming.operatingCapacityUnits ?? incoming.capitalStock),
          operatingCapacityTurn:
            survivor.operatingCapacityTurn ?? incoming.operatingCapacityTurn ?? null,
        }
      : {}),
    plantCount: mergedLedger?.plantCount ?? count(survivor) + count(incoming),
    plantUnitRemainder:
      mergedLedger?.plantUnitRemainder ?? remainder(survivor) + remainder(incoming),
    // Summed like the capacity it prices. Note a side with NO recorded basis
    // contributes 0 rather than its list value: the survivor of such a merge is
    // under-booked, never over-booked, which is the only safe direction for a
    // number that exits credit cash against.
    capacityBookAnchor: num(survivor.capacityBookAnchor) + num(incoming.capacityBookAnchor),
    buildQueue: mergedQueue,
    mothballed: survivor.mothballed === true && incoming.mothballed === true,
    ...(activePercent == null ? {} : { activeCapacityPercent: activePercent }),
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
  const ledger = sector.sectorType
    ? seedPlantLedger(
        sector.sectorType,
        sector.capitalStock,
        sector.industryModel,
        sector.mediaDiscriminator
      )
    : null;
  return {
    capitalStock: num(sector.capitalStock),
    operatingCapacityUnits: num(sector.operatingCapacityUnits ?? sector.capitalStock),
    operatingCapacityTurn: sector.operatingCapacityTurn ?? null,
    plantCount: ledger?.plantCount ?? count(sector),
    plantUnitRemainder: ledger?.plantUnitRemainder ?? remainder(sector),
    capacityBookAnchor: num(sector.capacityBookAnchor),
    buildQueue: queue(sector),
    mothballed: sector.mothballed === true,
    // Explicit default restores a legacy survivor after a failed partial merge.
    activeCapacityPercent: sector.activeCapacityPercent ?? 100,
    plantsStartTurn: typeof sector.plantsStartTurn === "number" ? sector.plantsStartTurn : null,
    legacyRevenueShadow: shadow(sector),
  };
}

/**
 * Slice `fraction` of a sector's plant state off for a carve (privatization
 * spin-out), leaving `1 − fraction` behind on the source row.
 *
 * Capacity and its paid basis follow the fraction of canonical whole
 * facilities assigned to this leg. Build orders remain divisible and follow
 * the requested transaction fraction in BOTH legs,
 * `unitsOrdered` and `costPaidAnchor`, so each half's CIP is derived from its
 * own queue and the two halves still conserve the order's paid cost.
 *
 * `plantsStartTurn` and `mothballed` are COPIED, not split: the ramp anchor and
 * the idle flag describe the plant's history and operating state, and both
 * halves inherit the same history.
 */
export function carveSectorPlantFields(
  sector: SectorPlantFields,
  fraction: number,
  plantCountOverride?: number
): SectorPlantFieldsUpdate {
  if (sector.sectorType && plantCountOverride == null) {
    throw new Error("A plant carve requires its conserved whole-facility count split");
  }
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  const sourceShadow = shadow(sector);
  const carvedPlantCount =
    plantCountOverride == null
      ? splitWholePlantCount(count(sector), f).carved
      : Math.max(0, Math.min(count(sector), Math.floor(plantCountOverride)));
  const openingPlantCount = count(sector);
  const stockFraction = sector.sectorType
    ? openingPlantCount > 0
      ? carvedPlantCount / openingPlantCount
      : 0
    : f;
  const capitalStock = num(sector.capitalStock) * stockFraction;
  const ledger = sector.sectorType
    ? seedPlantLedger(
        sector.sectorType,
        capitalStock,
        sector.industryModel,
        sector.mediaDiscriminator
      )
    : null;
  return {
    capitalStock,
    ...(sector.operatingCapacityUnits != null
      ? {
          operatingCapacityUnits: num(sector.operatingCapacityUnits) * stockFraction,
          operatingCapacityTurn: sector.operatingCapacityTurn ?? null,
        }
      : {}),
    plantCount: ledger?.plantCount ?? carvedPlantCount,
    plantUnitRemainder: ledger?.plantUnitRemainder ?? remainder(sector) * stockFraction,
    // Same fraction as the stock, so the per-unit basis is identical on both
    // halves and the two still sum to the original: a carve cannot mint basis.
    capacityBookAnchor: num(sector.capacityBookAnchor) * stockFraction,
    buildQueue: queue(sector).map((o) => ({
      ...o,
      unitsOrdered: o.unitsOrdered * f,
      costPaidAnchor: o.costPaidAnchor * f,
    })),
    mothballed: sector.mothballed === true,
    ...(sector.activeCapacityPercent == null
      ? {}
      : { activeCapacityPercent: sector.activeCapacityPercent }),
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
    count(sector) > 0 ||
    queue(sector).length > 0 ||
    sector.mothballed === true ||
    sector.activeCapacityPercent != null ||
    typeof sector.plantsStartTurn === "number"
  );
}

/** Convenience: read the plant subset off a full sector doc. */
export function readSectorPlantFields(sector: Partial<CorporateSector>): SectorPlantFields {
  return {
    sectorType: sector.sectorType,
    industryModel: sector.industryModel,
    capitalStock: sector.capitalStock,
    operatingCapacityUnits: sector.operatingCapacityUnits,
    operatingCapacityTurn: sector.operatingCapacityTurn,
    plantCount: sector.plantCount,
    plantUnitRemainder: sector.plantUnitRemainder,
    capacityBookAnchor: sector.capacityBookAnchor,
    buildQueue: sector.buildQueue,
    mothballed: sector.mothballed,
    activeCapacityPercent: sector.activeCapacityPercent,
    plantsStartTurn: sector.plantsStartTurn,
    legacyRevenueShadow: sector.legacyRevenueShadow,
  };
}
