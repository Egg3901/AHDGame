import type { Filter, ObjectId } from "mongodb";
import type { ElectionCandidate } from "@/lib/db/types";

/**
 * NPP candidacies use `characterId === npp._id` (see `turn/npp/electionEntry.ts`).
 * Player rows use their character document `_id`. This filter therefore matches
 * NPP rows even when legacy documents omit `isNPP` or `nppId`.
 */
export function activeNppElectionCandidacyFilter(
  electionId: ObjectId,
  nppObjectId: ObjectId
): Filter<ElectionCandidate> {
  return {
    electionId,
    status: "active",
    characterId: nppObjectId,
  };
}
