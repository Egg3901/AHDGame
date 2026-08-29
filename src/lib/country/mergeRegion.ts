/**
 * Fuse one region into another INSIDE the same country, then retire the source.
 *
 * NOT `transferRegion`. That moves a region ACROSS a border and assumes both
 * countries survive; this assumes the source region does not survive at all. The
 * two are different operations that happen to touch some of the same
 * collections, and expressing this as a transfer would leave a region that owns
 * nothing but is still enumerated.
 *
 * ⚠️ RUNS AFTER THE COUNTRY MERGE, NOT BEFORE. Both regions must already belong
 * to the same country. East Berlin is East German and Berlin is West German, so
 * fusing them before `mergeCountry` would be a cross-border fuse, which this
 * function does not do and its callers must not ask of it.
 *
 * Written for East Berlin joining Berlin on reunification -- Germany's seed has
 * no `DE-bundestag-BEO`, because a unified Berlin is one city -- but nothing
 * here names Berlin.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
import type { Db, ObjectId } from "mongodb";
import type { State } from "@/lib/db/types";
import { REGION_SCOPED_COLLECTIONS } from "@/lib/referendum/transfer/regionScopedCollections";
import { apportionOfficialsToChamber, type ChamberOfficial } from "./apportionChamber";

export interface MergeRegionArgs {
  fromRegionId: string;
  toRegionId: string;
  currentTurn: number;
}

export interface MergeRegionResult {
  ok: boolean;
  error?: string;
  retired: boolean;
  documentsMoved: number;
}

/**
 * Fields that ADD when two regions become one.
 *
 * Everything else on the states doc is a rate, a label or a derived figure.
 * Rates are deliberately NOT averaged here: a population-weighted mean of two
 * regions' unemployment is not the merged region's unemployment, and
 * `computeNationalMetrics` recomputes the derived figures from the merged
 * population anyway.
 */
const ADDITIVE_STATE_FIELDS = ["population", "houseDistricts", "stateSenateSeats"] as const;

export async function mergeRegion(db: Db, args: MergeRegionArgs): Promise<MergeRegionResult> {
  const { fromRegionId, toRegionId, currentTurn } = args;
  const now = new Date();
  const empty = { retired: false, documentsMoved: 0 };

  if (fromRegionId === toRegionId) {
    return { ok: false, error: "A region cannot absorb itself.", ...empty };
  }

  const source = (await db.collection<State>("states").findOne({ _id: fromRegionId })) as
    (State & { dissolvedTurn?: number | null }) | null;
  if (!source) {
    return { ok: false, error: `Region ${fromRegionId} not found.`, ...empty };
  }
  // Idempotent: a merge that already ran is a no-op, not an error, matching the
  // contract `mergeCountry` holds per region.
  if (source.dissolvedTurn != null) return { ok: true, retired: true, documentsMoved: 0 };

  const target = await db.collection<State>("states").findOne({ _id: toRegionId });
  if (!target) {
    return { ok: false, error: `Region ${toRegionId} not found.`, ...empty };
  }
  // Both halves must already be under one flag. A cross-border fuse would leave
  // officials seated in a region their country does not own, and is a caller
  // ordering mistake rather than a state this function should try to reconcile.
  if (source.countryId !== target.countryId) {
    return {
      ok: false,
      error: `Regions ${fromRegionId} and ${toRegionId} are in different countries.`,
      ...empty,
    };
  }

  const inc: Record<string, number> = {};
  for (const field of ADDITIVE_STATE_FIELDS) {
    const value = (source as unknown as Record<string, unknown>)[field];
    if (typeof value === "number" && value !== 0) inc[field] = value;
  }
  if (Object.keys(inc).length > 0) {
    await db
      .collection<State>("states")
      .updateOne({ _id: toRegionId }, { $inc: inc, $set: { updatedAt: now } });
  }

  // Re-point every region-keyed document at the surviving region. The key
  // VARIANTS come from the shared table, so a collection registered there for the
  // cross-border transfer is covered here too.
  let documentsMoved = 0;
  for (const scope of REGION_SCOPED_COLLECTIONS) {
    const field =
      scope.key === "stateIdField"
        ? "stateId"
        : scope.key === "stateField"
          ? "state"
          : scope.key === "homeStateField"
            ? "homeState"
            : null;
    // `idIsState` and `compositeCountryState` documents are keyed BY the region,
    // so there is exactly one per region and fusing them would mean merging their
    // CONTENTS rather than re-pointing a field. Those figures are recomputed from
    // the merged region by `computeNationalMetrics`, so the source's are left to
    // be retired with it rather than silently added to the target's.
    if (!field) continue;
    const res = await db
      .collection(scope.collection)
      .updateMany({ [field]: fromRegionId }, { $set: { [field]: toRegionId, updatedAt: now } });
    documentsMoved += res?.modifiedCount ?? 0;
  }

  // Officeholders are NOT in the table above, deliberately: moving them needs the
  // seat arithmetic below, not a field rename. Both delegations are re-pointed at
  // the surviving region and then re-apportioned TOGETHER onto its chamber -- the
  // fused region has one chamber, so two delegations arriving with their own seat
  // counts would otherwise sum past its size.
  const officials = (await db
    .collection("electedOfficials")
    .find({ countryId: source.countryId, state: { $in: [fromRegionId, toRegionId] } })
    .toArray()) as unknown as Array<ChamberOfficial & { officeType: string }>;

  const byOffice = new Map<string, Array<ChamberOfficial & { officeType: string }>>();
  for (const o of officials) {
    const group = byOffice.get(o.officeType) ?? [];
    group.push(o);
    byOffice.set(o.officeType, group);
  }
  for (const [officeType, group] of byOffice) {
    documentsMoved += await apportionOfficialsToChamber(db, {
      countryId: String(source.countryId),
      regionId: toRegionId,
      officeType,
      officials: group,
      extraSet: { state: toRegionId },
      now,
    });
  }

  // Retire, do not delete -- the document stays for history and the wiki, exactly
  // as `mergeCountry` retires a country shell.
  await db
    .collection<State>("states")
    .updateOne({ _id: fromRegionId }, { $set: { dissolvedTurn: currentTurn, updatedAt: now } });

  return { ok: true, retired: true, documentsMoved };
}
