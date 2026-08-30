import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";

const COLLECTION = "conflicts";

export function getConflictsCollection(db: Db) {
  return db.collection<ConflictDoc>(COLLECTION);
}

/** All conflicts not yet resolved. */
export async function listActiveConflicts(db: Db): Promise<ConflictDoc[]> {
  return getConflictsCollection(db)
    .find({ status: { $ne: "resolved" } })
    .toArray();
}

/**
 * Resolved wars, the one that ended most recently first, capped at `limit`.
 *
 * The historical list on the conflicts hub. Ordered by `endTurn` with the public
 * number as a tiebreak so two wars ended on the same tick list deterministically;
 * a legacy document with no `endTurn` sorts last, which is where a war nobody can
 * date belongs.
 */
export async function listResolvedConflicts(db: Db, limit: number): Promise<ConflictDoc[]> {
  return getConflictsCollection(db)
    .find({ status: "resolved" })
    .sort({ endTurn: -1, conflictId: -1 })
    .limit(limit)
    .toArray();
}

export async function getConflict(db: Db, id: string): Promise<ConflictDoc | null> {
  return getConflictsCollection(db).findOne({ _id: id });
}

/** True when `id` names a live conflict (used for unit-location validity). */
export async function conflictExists(db: Db, id: string): Promise<boolean> {
  return (await getConflictsCollection(db).countDocuments({ _id: id }, { limit: 1 })) > 0;
}

/** Active conflicts a country is involved in — as host or a belligerent on either side. */
export async function listConflictsForCountry(db: Db, countryId: string): Promise<ConflictDoc[]> {
  const c = countryId as CountryId;
  return getConflictsCollection(db)
    .find({
      status: { $ne: "resolved" },
      $or: [{ hostCountry: c }, { "sideA.countries": c }, { "sideB.countries": c }],
    })
    .toArray();
}

/**
 * A conflict by its public number, whatever its status — a resolved war keeps its
 * page at /world/conflicts/<conflictId>, so this deliberately does not filter the
 * way `listActiveConflicts` does.
 */
export async function getConflictByNumber(db: Db, conflictId: number): Promise<ConflictDoc | null> {
  return getConflictsCollection(db).findOne({ conflictId });
}
