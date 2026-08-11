import type { Db } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";

export interface LastElectionPartySummary {
  cycle: number;
  totalVotes: number;
  /** Party id -> percent of all votes in that general (candidates of same party summed) */
  partyPct: Record<string, number>;
}

/**
 * Loads the prior cycle's finalized general vote totals for the same seat and returns
 * vote share by party. Used to contrast poll "potential voter" models with real results.
 */
export async function getLastElectionPartyShares(
  db: Db,
  currentElection: Election
): Promise<LastElectionPartySummary | null> {
  if (currentElection.cycle <= 1) return null;

  const query: Record<string, unknown> = currentElection.seatId
    ? { seatId: currentElection.seatId }
    : { state: currentElection.state, electionType: currentElection.electionType };
  if (!currentElection.seatId && currentElection.senateClass != null) {
    query.senateClass = currentElection.senateClass;
  }

  const prev = await db.collection<Election>("elections").findOne({
    ...query,
    cycle: currentElection.cycle - 1,
    status: { $in: ["completed", "resolved"] },
  });
  if (!prev) return null;

  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId: prev._id });
  if (!tally?.totalVotes || Object.keys(tally.totalVotes).length === 0) return null;

  const prevCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ electionId: prev._id })
    .toArray();
  const idToParty = new Map(prevCandidates.map((c) => [c._id.toString(), c.party]));

  const votesByParty: Record<string, number> = {};
  let total = 0;
  for (const [candidateId, raw] of Object.entries(tally.totalVotes)) {
    const votes = Math.max(0, Number(raw) || 0);
    if (votes <= 0) continue;
    total += votes;
    const party = idToParty.get(candidateId) ?? "unknown";
    votesByParty[party] = (votesByParty[party] ?? 0) + votes;
  }
  if (total <= 0) return null;

  const partyPct: Record<string, number> = {};
  for (const [party, v] of Object.entries(votesByParty)) {
    partyPct[party] = (v / total) * 100;
  }

  return { cycle: prev.cycle, totalVotes: total, partyPct };
}
