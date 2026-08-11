import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import {
  getMilitaryFormations,
  getMilitaryFormationsCollection,
} from "@/lib/db/collections/militaryFormations";
import { reconcileUnitTheaters } from "./reconcileTheaters";

/**
 * Take ONE country out of ONE conflict: drop its general postings at this theater
 * and reconcile, which returns the affected units to reserve.
 *
 * Extracted from `resolveConflict`, which does this for every belligerent at once
 * when a war ends outright. A separate peace needs it for a single country, and a
 * second copy would drift — the exit is subtle enough to be worth sharing:
 *
 * Clearing `unit.theaterId` directly does NOT work. It is a reconciled cache of
 * `theaterOfUnit(assignedGeneralId, assignments)`, so the next reconcile would put
 * the units straight back at a dead theater. The POSTING is the thing that must go.
 */
export async function standDownCountry(
  db: Db,
  conflict: Pick<ConflictDoc, "_id">,
  countryId: CountryId
): Promise<void> {
  const { conflictAssignments } = await getMilitaryFormations(db, countryId);
  const kept = conflictAssignments.filter((a) => a.theaterId !== conflict._id);
  if (kept.length !== conflictAssignments.length) {
    await getMilitaryFormationsCollection(db).updateOne(
      { countryId },
      { $set: { conflictAssignments: kept } }
    );
  }
  // Reconciles even when nothing was posted here: a unit can still be pointing at
  // this theater through the cache described above.
  await reconcileUnitTheaters(db, countryId, kept);
}
