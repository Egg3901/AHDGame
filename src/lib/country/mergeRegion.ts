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
import { REGION_PARTY_COLLECTIONS } from "@/lib/referendum/transfer/evacuateRegionPolitics";
import { rescaleRegionDelegations } from "./apportionChamber";

/** A unique index that constrains `field`, as the fuse needs to see it. */
interface UniqueIndexOverField {
  /** The indexed key names, in order. */
  keys: string[];
  /**
   * The index's `partialFilterExpression`, or null when it constrains every row.
   * A PARTIAL index only constrains rows matching this, so two rows sharing a key
   * are only in conflict when BOTH match it.
   */
  partial: Record<string, unknown> | null;
}

/**
 * The UNIQUE indexes on `collection` that include `field`.
 *
 * Fails OPEN — a collection that does not exist yet, or a driver that will not
 * report indexes, answers "none" and takes the ordinary re-point path. That is
 * what this did before the check existed, so an introspection problem cannot make
 * a merge worse than it already was.
 */
async function uniqueIndexesOver(
  db: Db,
  collection: string,
  field: string
): Promise<UniqueIndexOverField[]> {
  try {
    const indexes = await db.collection(collection).indexes();
    return indexes
      .filter((index) => index.unique === true && (index.key as Record<string, unknown>)?.[field])
      .map((index) => ({
        keys: Object.keys(index.key as Record<string, unknown>),
        partial: (index.partialFilterExpression as Record<string, unknown> | undefined) ?? null,
      }));
  } catch {
    return [];
  }
}

/**
 * Re-point one region-keyed collection onto the surviving region, for a FUSE.
 *
 * A transfer can always re-point: the region keeps its identity under a new
 * owner. A FUSE cannot, because two regions become one and any UNIQUE index over
 * the region field then has two rows competing for a single key. That is not
 * hypothetical — `stateResourceCapacity` is unique on `stateId` alone and
 * `unownedSectors` on `{stateId, sectorType}`, and both threw mid-merge on a live
 * reunification, after half a country had already moved.
 *
 * Only rows a unique index ACTUALLY constrains are considered: a partial index
 * binds the rows matching its filter and no others.
 *
 * WHERE THE TWO ROWS COLLIDE, THE SURVIVOR'S STANDS and the absorbed region's is
 * dropped — the same answer the `idIsState` branch above already gives, for the
 * same reason: fusing them would mean merging their CONTENTS, and the survivor
 * already has its own. Rows that do NOT collide still cross, so a sector East
 * Berlin had and Berlin lacked is carried rather than thrown away.
 */
async function fuseRegionKeyedCollection(
  db: Db,
  collection: string,
  field: string,
  fromRegionId: string,
  toRegionId: string,
  now: Date
): Promise<number> {
  const coll = db.collection<Record<string, unknown>>(collection);
  for (const { keys, partial } of await uniqueIndexesOver(db, collection, field)) {
    const others = keys.filter((key) => key !== field);
    // A PARTIAL index constrains only the rows matching its filter, so only those
    // can collide. Asking the server to evaluate the filter — rather than
    // interpreting it here — is the only way to get the same answer the index
    // gives for expressions like `{ status: "active", partyId: { $exists: true } }`.
    //
    // Without this the check deletes rows that were never in conflict:
    // `statePartyCandidates` is unique on `{stateId, partyId, characterId}` only
    // while `status` is "active", so a withdrawn candidacy sitting on the target
    // key would take a LIVE one from the absorbed region with it.
    // FILTER FIRST, REGION SECOND. A partial expression routinely constrains the
    // region field itself (`statePartyCandidates` filters on
    // `stateId: {$exists: true}`), and spreading it last would overwrite the one
    // key that scopes this scan to the region being absorbed -- turning it into a
    // sweep of every region in the world, whose rows would then be measured for
    // collision against the survivor and deleted.
    const sourceRows = await coll.find({ ...(partial ?? {}), [field]: fromRegionId }).toArray();
    for (const row of sourceRows) {
      // What this row would become once re-pointed. An explicit null matches a
      // missing field too, so a row that omits one of the key parts is compared
      // the same way the index compares it.
      const wouldBecome: Record<string, unknown> = { [field]: toRegionId };
      for (const key of others) wouldBecome[key] = row[key] ?? null;
      // Filter first, key values second: an explicit equality on a key must not
      // be overwritten by the filter's own condition on that same field.
      if (await coll.findOne({ ...(partial ?? {}), ...wouldBecome })) {
        await coll.deleteOne({ _id: row._id } as Record<string, unknown>);
      }
    }
  }
  const res = await coll.updateMany(
    { [field]: fromRegionId },
    { $set: { [field]: toRegionId, updatedAt: now } }
  );
  return res?.modifiedCount ?? 0;
}

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
    // Collision-aware, because this is a FUSE: any unique index over the region
    // field has two rows competing for one key once the two regions become one.
    // Read off the live indexes rather than a hand-kept list — the failure mode is
    // a duplicate-key throw in the middle of a merge that has already moved half a
    // country, and a list is exactly the thing that goes stale.
    documentsMoved += await fuseRegionKeyedCollection(
      db,
      scope.collection,
      field,
      fromRegionId,
      toRegionId,
      now
    );
  }

  // The region PARTY collections are also not in the table above — the transfer
  // path owns them through `evacuateRegionPolitics` — so a fuse must re-home
  // them itself, or the absorbed half's party organisations (their treasuries
  // included, freshly currency-converted by the border crossing) end up keyed
  // to a region this function is about to delete, invisible to every page that
  // enumerates orgs by the country's live regions.
  //
  // `statePartyOrg` is collision-aware: on a reunification fuse the two halves'
  // parties are disjoint (they came from different countries), but a general
  // fuse can find the SAME party organised in both halves, and two rows for one
  // (party, region) pair would break the one-org-per-party read. Treasuries add;
  // the survivor's settings stand. Everything else in the list is ledger/history
  // shaped and re-points wholesale.
  interface RegionPartyOrg {
    _id: unknown;
    partyId?: string;
    stateId?: string;
    treasury?: number;
    updatedAt?: Date;
  }
  const partyOrgs = db.collection<RegionPartyOrg>("statePartyOrg");
  const sourceOrgs = await partyOrgs.find({ stateId: fromRegionId }).toArray();
  // One read of the target's orgs up front, not a collision probe per source org.
  const targetOrgsByParty = new Map(
    sourceOrgs.length > 0
      ? (await partyOrgs.find({ stateId: toRegionId }).toArray()).map((org) => [org.partyId, org])
      : []
  );
  for (const org of sourceOrgs) {
    const existing = targetOrgsByParty.get(org.partyId);
    if (existing) {
      const treasury = typeof org.treasury === "number" ? org.treasury : 0;
      await partyOrgs.updateOne(
        { _id: existing._id },
        { $inc: { treasury }, $set: { updatedAt: now } }
      );
      await partyOrgs.deleteOne({ _id: org._id });
    } else {
      await partyOrgs.updateOne(
        { _id: org._id },
        { $set: { stateId: toRegionId, updatedAt: now } }
      );
    }
    documentsMoved++;
  }
  for (const coll of REGION_PARTY_COLLECTIONS) {
    if (coll === "statePartyOrg") continue;
    const res = await db
      .collection(coll)
      .updateMany({ stateId: fromRegionId }, { $set: { stateId: toRegionId, updatedAt: now } });
    documentsMoved += res?.modifiedCount ?? 0;
  }

  // NPPs are NOT in the table above -- `evacuateRegionPolitics` owns them on the
  // transfer path -- so they need re-homing explicitly. Left alone they would be
  // homed in a region this function is about to delete.
  const nppMoved = await db
    .collection("npps")
    .updateMany({ homeState: fromRegionId }, { $set: { homeState: toRegionId, updatedAt: now } });
  documentsMoved += nppMoved?.modifiedCount ?? 0;

  // `currentOffice.state` is a NESTED denormalisation, not a region key, so the
  // scoped table above does not reach it: that table re-points `homeState`,
  // `stateId` and `state`, and this field is none of them. An office holder
  // seated in the absorbed half would be left naming a region that is about to
  // be deleted -- read by election resolution, `deriveHighestOffice` and the
  // relocation paths, all of which would be resolving against a region no longer
  // on the map.
  //
  // BOTH collections, because most of these seats are NPP-held rather than
  // player-held. Nested-field `$set`, so a holder's office TYPE and everything
  // else on the sub-document is untouched.
  for (const coll of ["characters", "npps"] as const) {
    const res = await db
      .collection(coll)
      .updateMany(
        { "currentOffice.state": fromRegionId },
        { $set: { "currentOffice.state": toRegionId, updatedAt: now } }
      );
    documentsMoved += res?.modifiedCount ?? 0;
  }

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

  // FORCE THE SURVIVOR'S TAX BASE TO BE RE-DERIVED.
  //
  // `stateBudgets.taxBases` is STORED, and `computeStateRevenue` only falls back
  // to deriving it from the region's GDP and macro metrics when the field is
  // absent. The target has its own, so without this it would keep taxing the
  // half of the city it started with while holding the population, the sectors
  // and the seats of both. Unsetting it hands the next revenue pass the merged
  // region, which is the figure it should have been reading all along.
  await db
    .collection<Record<string, unknown>>("stateBudgets")
    .updateOne({ _id: toRegionId } as Record<string, unknown>, {
      $unset: { taxBases: "" },
      $set: { updatedAt: now },
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
