import type { Db, ObjectId } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";

/**
 * While an election is `completed`, general resolution may not have run yet — candidates
 * stay `active` until `resolveGeneralElections` withdraws them. Entry checks must treat
 * `completed` like `active`/`upcoming` for conflict detection; otherwise players can
 * double-enter during the completion window (e.g. president + house).
 */
const BLOCKING_ELECTION_STATUSES = new Set<Election["status"]>(["upcoming", "active", "completed"]);

export function electionStatusBlocksFurtherEntry(status: Election["status"]): boolean {
  return BLOCKING_ELECTION_STATUSES.has(status);
}

/**
 * Returns an active player candidacy in a non-terminal election, optionally excluding one
 * election (e.g. the race the player is trying to enter).
 */
export async function findBlockingActiveCandidacy(
  db: Db,
  characterId: ObjectId,
  excludeElectionId?: ObjectId
): Promise<{ candidate: ElectionCandidate; election: Election } | null> {
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId, status: "active" })
    .toArray();

  const relevant = excludeElectionId
    ? candidates.filter((c) => !c.electionId.equals(excludeElectionId))
    : candidates;

  if (relevant.length === 0) return null;

  // Single batched query instead of N individual findOne calls.
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: relevant.map((c) => c.electionId) } })
    .toArray();
  const electionById = new Map(elections.map((e) => [e._id.toHexString(), e]));

  for (const cand of relevant) {
    const election = electionById.get(cand.electionId.toHexString());
    if (election && electionStatusBlocksFurtherEntry(election.status)) {
      return { candidate: cand, election };
    }
  }
  return null;
}
