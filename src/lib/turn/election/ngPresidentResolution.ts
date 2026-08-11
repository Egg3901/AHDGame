/**
 * Nigeria presidential election resolution — the NG arm of the per-country
 * presidential pipeline (the US electoral-college path stays in
 * `presidentResolution.ts`). `generalResolution` dispatches NG president
 * elections here.
 *
 * Resolution rule (see `nigeriaPresidentialElectionEngine`): the candidate with
 * the most national votes wins outright iff their party also cleared 25% in at
 * least four of the six geopolitical zones; otherwise the top two parties'
 * nominees contest a run-off.
 *
 * The `decide*` core is pure (no DB) and fully unit-tested; the DB wrapper maps
 * its decision onto the shared `seatPresidentialExecutive` seating or a run-off
 * spawn.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally, Campaign } from "@/lib/db/types";
import { seatPresidentialExecutive } from "@/lib/turn/election/presidentExecutiveSeating";
import {
  resolveNigeriaPresidentialResult,
  NG_ZONES,
} from "@/lib/nigeriaPresidentialElectionEngine";

/** Minimal candidate shape the decision needs (id + party key). */
export interface NGPresidentCandidate {
  id: string;
  party: string;
}

export type NGPresidentDecision =
  | { outcome: "won"; winnerCandidateId: string; winnerPartyId: string }
  | { outcome: "runoff"; runoffCandidateIds: string[]; runoffPartyIds: string[] }
  | { outcome: "indeterminate" };

/**
 * Pure resolution: from per-zone, per-candidate vote tallies and the candidate
 * roster, decide the NG presidential outcome. Party keys are opaque — we group
 * candidates by `party`, run the spread rule, then map the winning/top-two
 * parties back to their leading candidate.
 */
export function decideNGPresidentOutcome(
  candidates: NGPresidentCandidate[],
  totalVotesByUnit: Record<string, Record<string, number>>
): NGPresidentDecision {
  const partyOf = new Map(candidates.map((c) => [c.id, c.party]));

  // Per-zone, per-party tallies (group candidate votes by their party).
  const zonePartyTallies: Record<string, Record<string, number>> = {};
  for (const zone of NG_ZONES) {
    const byCandidate = totalVotesByUnit[zone] ?? {};
    const byParty: Record<string, number> = {};
    for (const [candidateId, votes] of Object.entries(byCandidate)) {
      const party = partyOf.get(candidateId);
      if (!party) continue;
      byParty[party] = (byParty[party] ?? 0) + votes;
    }
    zonePartyTallies[zone] = byParty;
  }

  const result = resolveNigeriaPresidentialResult(zonePartyTallies);

  // National votes per candidate (to pick each party's leading nominee).
  const candidateVotes: Record<string, number> = {};
  for (const zone of NG_ZONES) {
    for (const [candidateId, votes] of Object.entries(totalVotesByUnit[zone] ?? {})) {
      candidateVotes[candidateId] = (candidateVotes[candidateId] ?? 0) + votes;
    }
  }
  const leadingCandidateOfParty = (party: string): string | undefined => {
    let best: string | undefined;
    let bestVotes = -1;
    for (const c of candidates) {
      if (c.party === party && (candidateVotes[c.id] ?? 0) > bestVotes) {
        best = c.id;
        bestVotes = candidateVotes[c.id] ?? 0;
      }
    }
    return best;
  };

  if (result.outcome === "won" && result.winnerPartyId) {
    const winnerCandidateId = leadingCandidateOfParty(result.winnerPartyId);
    if (winnerCandidateId) {
      return { outcome: "won", winnerCandidateId, winnerPartyId: result.winnerPartyId };
    }
  }

  const runoffPartyIds = result.runoffPartyIds;
  if (runoffPartyIds) {
    const runoffCandidateIds = runoffPartyIds
      .map((p) => leadingCandidateOfParty(p))
      .filter((id): id is string => id != null);
    // Distinct candidates required for a meaningful run-off.
    if (new Set(runoffCandidateIds).size >= 2) {
      return {
        outcome: "runoff",
        runoffCandidateIds,
        runoffPartyIds: [...runoffPartyIds],
      };
    }
  }

  return { outcome: "indeterminate" };
}

/**
 * Resolve a completed NG presidential election. Reads the per-zone tally,
 * applies the spread rule, and seats the winner via the shared
 * `seatPresidentialExecutive`. A run-off is resolved in v1 by seating the
 * leading finalist (a two-way contest always clears the spread, so it resolves
 * to the national front-runner); a modelled second-round campaign is a future
 * refinement. Returns true when the election was resolved.
 */
export async function resolveNGPresidentElection(
  db: Db,
  election: Election,
  tally: ElectionVoteTally,
  now: Date
): Promise<boolean> {
  const candidateParties = tally.candidateParties ?? {};
  const candidateIds = Object.keys(candidateParties);
  if (candidateIds.length === 0) return false;

  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: candidateIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const candidateMap = new Map(candidates.map((c) => [c._id.toString(), c]));

  const decision = decideNGPresidentOutcome(
    candidates.map((c) => ({ id: c._id.toString(), party: c.party })),
    tally.totalVotesByUnit ?? {}
  );
  if (decision.outcome === "indeterminate") {
    console.warn(
      `[Turn] NG president election ${election._id}: indeterminate (no zone votes yet) — retry next turn`
    );
    return false;
  }

  // Pick the candidate to seat: outright winner, or the leading run-off finalist
  // by national vote (v1 — second-round campaign not modelled).
  let winnerCandidateId: string;
  if (decision.outcome === "won") {
    winnerCandidateId = decision.winnerCandidateId;
  } else {
    const totals = tally.totalVotes ?? {};
    winnerCandidateId = decision.runoffCandidateIds.reduce((best, id) =>
      (totals[id] ?? 0) > (totals[best] ?? 0) ? id : best
    );
    console.log(
      `[Turn] NG president election ${election._id}: no zone-spread winner — run-off resolved to leading finalist ${winnerCandidateId}`
    );
  }

  const winnerCandidate = candidateMap.get(winnerCandidateId);
  if (!winnerCandidate) {
    console.error(
      `[Turn] NG president election ${election._id}: winner ${winnerCandidateId} has no ElectionCandidate — retry next turn`
    );
    return false;
  }

  try {
    await seatPresidentialExecutive(db, {
      election,
      winnerCandidate,
      vpCharId: winnerCandidate.runningMateId,
      vpNppId: undefined,
      now,
    });
  } catch (err) {
    console.error(
      `[Turn] NG president election ${election._id}: executive seating failed — will retry next turn`,
      err
    );
    await db
      .collection<ElectionVoteTally>("electionVoteTallies")
      .updateOne(
        { electionId: election._id },
        { $set: { executiveSeatingPending: true, updatedAt: now } }
      );
    return false;
  }

  await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
    { electionId: election._id, finalized: { $ne: true } },
    {
      $set: {
        finalized: true,
        executiveSeatingPending: false,
        resolutionMode: "majority",
        updatedAt: now,
      },
    }
  );

  // Post-finalize cleanup: withdraw remaining candidates and clear campaigns.
  await db
    .collection("electionCandidates")
    .updateMany(
      { electionId: election._id, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  await db.collection<Campaign>("campaigns").deleteMany({ electionId: election._id });

  console.log(
    `[Turn] NG president election ${election._id} resolved — candidate ${winnerCandidateId} seated`
  );
  return true;
}
