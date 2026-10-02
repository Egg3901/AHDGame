/**
 * A merged party lives on only as a pointer (`mergedIntoPartyId`) to the party
 * that absorbed it. Anything still carrying the absorbed party's id, such as a
 * candidacy filed before the merge, has to be read as the survivor. Otherwise
 * winning that race writes the dead party back onto the winner, which is how
 * fourteen sitting legislators left the US Constitutional Union Party for the
 * party it had absorbed (ticket 1376).
 */
import type { Db, ObjectId } from "mongodb";
import type { PoliticalParty } from "@/lib/db/types";

export type SurvivingPartyResolver = (
  partyId: string | null | undefined
) => string | null | undefined;

const identity: SurvivingPartyResolver = (partyId) => partyId;

/** Longest merge chain followed before giving up (guards a corrupt cycle). */
const MAX_MERGE_DEPTH = 16;

/**
 * Build a resolver from party sequentialId to the sequentialId of the party it
 * ultimately merged into, following chains (A into B, B into C resolves A to C).
 * Unmerged ids, "independent" and unknown values pass through unchanged. Costs
 * one query when the country has no merged parties.
 */
export async function loadSurvivingPartyResolver(
  db: Db,
  countryId: string
): Promise<SurvivingPartyResolver> {
  const merged = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, mergedIntoPartyId: { $exists: true, $ne: null } } as never, {
      projection: { _id: 1, sequentialId: 1, mergedIntoPartyId: 1 },
    })
    .toArray();
  if (merged.length === 0) return identity;

  const targets = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ _id: { $in: merged.map((p) => p.mergedIntoPartyId as ObjectId) } } as never, {
      projection: { _id: 1, sequentialId: 1 },
    })
    .toArray();
  const seqById = new Map<string, string>();
  for (const p of [...merged, ...targets]) seqById.set(String(p._id), String(p.sequentialId));

  const next = new Map<string, string>();
  for (const p of merged) {
    const target = seqById.get(String(p.mergedIntoPartyId));
    if (target) next.set(String(p.sequentialId), target);
  }

  return (partyId) => {
    if (partyId == null) return partyId;
    let current = partyId;
    for (let depth = 0; depth < MAX_MERGE_DEPTH; depth++) {
      const target = next.get(current);
      if (target === undefined || target === current) return current;
      current = target;
    }
    return current;
  };
}
