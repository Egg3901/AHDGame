import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import type { Side } from "@/lib/military/occupation";

/**
 * Enrol a country as a belligerent on one side of a conflict.
 *
 * Lifted out of `battleResolution` once a second caller appeared: a war declaration
 * enrols the declarer at enactment, and battle resolution enrols whoever actually
 * fights. A second copy would have drifted.
 *
 * Idempotent, and it mutates the in-memory roster as well as the document so the
 * rest of the current tick sees a consistent conflict.
 */
export async function joinSide(
  db: Db,
  conflict: ConflictDoc,
  countryId: CountryId,
  side: Side,
  currentTurn: number
): Promise<void> {
  const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
  if (roster.includes(countryId)) return;
  roster.push(countryId);

  // Stamp WHEN this country entered and WHERE the front stood at the time. Both
  // halves are load-bearing for war approval: the exhaustion clock must run from
  // a country's own entry rather than the war's start, and war effort is scored
  // from the front as it stood on arrival so a late joiner does not inherit the
  // record its side built before it got there. `treatyEntries` cannot serve —
  // it is written only for treaty-pulled allies, so a country that declares into
  // an existing war has no entry there at all.
  //
  // Written as two updates, not one. The roster is a list of country codes, so
  // `$addToSet` dedupes it on its own. An entry is an object, and `$addToSet`
  // compares objects whole — two callers enrolling the same country in one turn
  // from separately loaded copies of this document would each clear the
  // in-memory check above and write a second stamp that differs only by turn or
  // control. Filtering on the country instead makes the database, rather than
  // the caller's copy, the thing that enforces one stamp per country.
  const entry = { countryId, turn: currentTurn, control: conflict.control };
  if (!conflict.joinTurns?.some((existing) => existing.countryId === countryId)) {
    conflict.joinTurns = [...(conflict.joinTurns ?? []), entry];
  }

  const conflicts = getConflictsCollection(db);
  await conflicts.updateOne(
    { _id: conflict._id },
    { $addToSet: { [`side${side}.countries`]: countryId } }
  );
  await conflicts.updateOne(
    { _id: conflict._id, "joinTurns.countryId": { $ne: countryId } },
    { $push: { joinTurns: entry } }
  );
}
