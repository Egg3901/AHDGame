/**
 * Move every political party from one country to another, renumbering them and
 * rewriting every reference.
 *
 * WHY THIS EXISTS AT ALL. `regionScopedCollections` deliberately refuses to move
 * `politicalParties`, because its case is Northern Ireland leaving the UK, where
 * the source survives and its national parties must not be disturbed. A
 * DISSOLVING source inverts that: there is no country left to protect, and its
 * parties are the losing side's whole political identity.
 *
 * WHY RENUMBERING IS NOT OPTIONAL. `characters.party` and `electedOfficials.party`
 * hold a stringified PER-COUNTRY `sequentialId`, not a party id. DD's "1" is the
 * SED; DE's "1" is the SPD. Moving the docs without renumbering, or renumbering
 * without rewriting the references, silently reinterprets every member of every
 * party against the target's list. `politicalParties` also carries a unique index
 * on `{countryId, sequentialId}`, so a colliding id would throw on write anyway --
 * the index is a backstop for the data corruption, not the reason for it.
 *
 * Spec: docs/superpowers/specs/2026-08-29-reunification-merge-design.md
 */
import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";
import { reserveSequentialIds, realignPartyCountersToExisting } from "@/lib/db/sequentialId";
import {
  PARTY_REF_COLLECTIONS,
  PARTY_OBJECTID_COLLECTIONS,
  NON_PARTY_SENTINELS,
  buildPartyIdMap,
} from "./partyMigrationCollections";

export interface MergePartiesArgs {
  fromCountryId: CountryId;
  toCountryId: CountryId;
  currentTurn: number;
}

export interface MergePartiesResult {
  ok: boolean;
  error?: string;
  /** old sequentialId (as string) to new sequentialId (as string). */
  partyIdMap: Record<string, string>;
  partiesMoved: number;
  documentsRemapped: number;
}

/** A party doc plus the stamp this migration writes onto it. */
type PartyDoc = Pick<PoliticalParty, "_id" | "sequentialId"> & {
  mergedFrom?: { countryId: string; sequentialId: number; turn?: number };
};

export async function mergePartiesIntoCountry(
  db: Db,
  args: MergePartiesArgs
): Promise<MergePartiesResult> {
  const { fromCountryId, toCountryId, currentTurn } = args;
  const empty: MergePartiesResult = {
    ok: true,
    partyIdMap: {},
    partiesMoved: 0,
    documentsRemapped: 0,
  };

  if (fromCountryId === toCountryId) {
    return { ...empty, ok: false, error: "A country cannot absorb its own parties." };
  }

  const parties = (await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId: fromCountryId })
    .toArray()) as unknown as PartyDoc[];

  // ALREADY MIGRATED. A re-run after a partial failure finds nothing left in the
  // source, and must still hand its caller the map -- `adoptChallengerSettlement`
  // translates the absorbed country's ruling party through it, and an empty map
  // there installs the WRONG party rather than failing loudly. Rebuilt from the
  // `mergedFrom` stamp, which is the whole reason the stamp is written.
  if (parties.length === 0) {
    const alreadyMoved = (await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: toCountryId, "mergedFrom.countryId": fromCountryId })
      .toArray()) as unknown as PartyDoc[];
    if (alreadyMoved.length === 0) return empty;
    return {
      ok: true,
      partyIdMap: buildPartyIdMap(
        alreadyMoved.map((p) => ({
          oldSequentialId: p.mergedFrom?.sequentialId ?? p.sequentialId,
          newSequentialId: p.sequentialId,
        }))
      ),
      partiesMoved: 0,
      documentsRemapped: 0,
    };
  }

  const newIds = await reserveSequentialIds(db, "party", parties.length, toCountryId);
  const moved = parties.map((p, i) => ({
    doc: p,
    oldSequentialId: p.sequentialId,
    newSequentialId: newIds[i],
  }));
  const partyIdMap = buildPartyIdMap(moved);
  const now = new Date();

  // The party documents first. `mergedFrom` is the idempotency stamp: a re-run
  // reads it back off the target country and rebuilds the same map without
  // reserving a second block of ids.
  for (const m of moved) {
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: m.doc._id },
      {
        $set: {
          countryId: toCountryId,
          sequentialId: m.newSequentialId,
          mergedFrom: {
            countryId: fromCountryId,
            sequentialId: m.oldSequentialId,
            turn: currentTurn,
          },
          updatedAt: now,
        },
      }
    );
  }

  let documentsRemapped = 0;

  // One updateMany per (collection, field, old id). Never a per-document loop:
  // `orgRegLedger` and `partyPoliticalStrengthLedger` hold thousands of rows for a
  // single country, and this runs inside a turn phase with a time budget.
  //
  // Filtered on the SOURCE country so a target-country row that happens to share
  // the old numeric value is never touched. That filter is the whole safety
  // property of this function.
  for (const ref of PARTY_REF_COLLECTIONS) {
    for (const [oldId, newId] of Object.entries(partyIdMap)) {
      if (NON_PARTY_SENTINELS.has(oldId)) continue;
      const res = await db
        .collection(ref.collection)
        .updateMany(
          { countryId: fromCountryId, [ref.field]: oldId },
          { $set: { [ref.field]: newId, updatedAt: now } }
        );
      documentsRemapped += res?.modifiedCount ?? 0;
    }
  }

  // The one collection keyed by ObjectId rather than sequentialId. Its rows only
  // need re-scoping, because the party's `_id` does not change when it moves.
  for (const ref of PARTY_OBJECTID_COLLECTIONS) {
    const res = await db.collection(ref.collection).updateMany(
      {
        countryId: fromCountryId,
        [ref.field]: { $in: parties.map((p) => p._id as ObjectId) },
      },
      { $set: { countryId: toCountryId, updatedAt: now } }
    );
    documentsRemapped += res?.modifiedCount ?? 0;
  }

  // The target's counter must end at max(sequentialId) or the next party founded
  // there reuses an id behind the unique index.
  await realignPartyCountersToExisting(db);

  return {
    ok: true,
    partyIdMap,
    partiesMoved: moved.length,
    documentsRemapped,
  };
}
