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
  side: Side
): Promise<void> {
  const roster = side === "A" ? conflict.sideA.countries : conflict.sideB.countries;
  if (roster.includes(countryId)) return;
  roster.push(countryId);
  await getConflictsCollection(db).updateOne(
    { _id: conflict._id },
    { $addToSet: { [`side${side}.countries`]: countryId } }
  );
}
