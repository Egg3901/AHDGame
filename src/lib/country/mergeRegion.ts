/**
 * Fuse one region into another INSIDE the same country, then remove the source.
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
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { REGION_SCOPED_COLLECTIONS } from "@/lib/referendum/transfer/regionScopedCollections";
import { rescaleRegionDelegations } from "./apportionChamber";

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

  const source = await db.collection<State>("states").findOne({ _id: fromRegionId });
  const target = await db.collection<State>("states").findOne({ _id: toRegionId });

  // IDEMPOTENT, and the ABSENT SOURCE is how that is detected. This ends by
  // deleting the source document, so a re-run after a partial failure finds
  // nothing left to merge -- which is success, not an error. A missing source
  // beside a live target means the work is already done; both missing means the
  // caller named regions that do not exist.
  if (!source) {
    return target
      ? { ok: true, retired: true, documentsMoved: 0 }
      : { ok: false, error: `Region ${fromRegionId} not found.`, ...empty };
  }
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
    // CONTENTS rather than re-pointing a field. The target already has its own,
    // and `computeNationalMetrics` recomputes the derived figures from the merged
    // population, so the source's are DELETED rather than merged.
    //
    // Deleting matters now that the region document itself goes: these carry a
    // `countryId`, and the phases that drive regions by that field would go on
    // scoring metrics for a Land that is no longer on the map.
    if (!field) {
      const id =
        scope.key === "compositeCountryState"
          ? `${String(source.countryId)}_${fromRegionId}`
          : fromRegionId;
      const gone = await db
        .collection<Record<string, unknown>>(scope.collection)
        .deleteOne({ _id: id } as Record<string, unknown>);
      documentsMoved += gone?.deletedCount ?? 0;
      continue;
    }
    const res = await db
      .collection(scope.collection)
      .updateMany({ [field]: fromRegionId }, { $set: { [field]: toRegionId, updatedAt: now } });
    documentsMoved += res?.modifiedCount ?? 0;
  }

  // NPPs are NOT in the table above -- `evacuateRegionPolitics` owns them on the
  // transfer path -- so they need re-homing explicitly. Left alone they keep
  // pointing at a region that has just been retired.
  const nppMoved = await db
    .collection("npps")
    .updateMany({ homeState: fromRegionId }, { $set: { homeState: toRegionId, updatedAt: now } });
  documentsMoved += nppMoved?.modifiedCount ?? 0;

  // A corporation headquartered in the absorbed region moves with it, the same
  // way one follows a region across a border.
  const corpsMoved = await db
    .collection("corporations")
    .updateMany(
      { headquartersState: fromRegionId },
      { $set: { headquartersState: toRegionId, updatedAt: now } }
    );
  documentsMoved += corpsMoved?.modifiedCount ?? 0;

  // Officeholders are NOT in the table above, deliberately: moving them needs the
  // seat arithmetic below, not a field rename. Both delegations are re-pointed at
  // the surviving region and then re-apportioned TOGETHER onto its chamber -- the
  // fused region has one chamber, so two delegations arriving with their own seat
  // counts would otherwise sum past its size.
  await db
    .collection("electedOfficials")
    .updateMany(
      { countryId: source.countryId, state: fromRegionId },
      { $set: { state: toRegionId, updatedAt: now } }
    );
  documentsMoved += await rescaleRegionDelegations(db, {
    regionId: toRegionId,
    countryId: String(source.countryId),
    now,
  });

  // DELETE THE REGION, do not merely flag it.
  //
  // ⚠️ This is the opposite of what `mergeCountry` does to a country shell, and
  // the difference is not stylistic. A retired COUNTRY works because
  // `dissolvedTurn` is filtered at both enumeration chokepoints —
  // `registeredBase` and `getRegisteredCountryIds` — so one flag removes it
  // everywhere at once. A region has no such mechanism: nothing in the codebase
  // filters `states` on `dissolvedTurn`, and the field is not even on the `State`
  // type. A "retired" region is therefore just a live region with a flag nobody
  // reads, and it would keep being counted: `getLiveLowerChamberSeats` sums
  // `houseDistricts` across `{countryId}`, so East Berlin's seats would be
  // counted once inside Berlin and again on their own, and `ensureDEElections`
  // would go on spawning races for a Land that no longer exists.
  //
  // Everything the region owned has been re-pointed at the survivor above, so
  // there is nothing left for the document to hold.
  await db.collection<State>("states").deleteOne({ _id: fromRegionId });

  // The map changed, so the country's history should say so — the region is gone
  // from `states` and this entry is the only record that it ever existed.
  await recordCountryEvent(db, {
    countryId: source.countryId as CountryId,
    turn: currentTurn,
    eventType: "region_transferred",
    title: `${fromRegionId} was merged into ${toRegionId}.`,
    details: { fromRegionId, toRegionId, regionMerge: true },
  }).catch((err) => console.error(`${fromRegionId} merge history failed:`, err));

  return { ok: true, retired: true, documentsMoved };
}
