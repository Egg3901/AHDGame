/**
 * Pure standings for the open House vote after a contingent deadlock.
 *
 * Each sitting House member backs the candidacy they voted for; a member who
 * has not voted falls back to the engine's own scoring, so the board starts at
 * the simulated ballot and moves as players vote. One vote per state
 * delegation (plurality of seat weight, ties abstain, DC excluded) and the
 * majority is the same `contingentMajorityOf` of the 50-state roster the
 * engine uses.
 */
import {
  CONTINGENT_EXCLUDED_HOUSE_STATE,
  HOUSE_CONTINGENT_THRESHOLD,
  contingentMajorityOf,
} from "./contingentConstants";
import type { ContingentCandidateProfile, ContingentHouseDelegation } from "./contingentElection";
import { pickPreferredCandidate } from "./contingentElection";

export interface HouseVoteStandings {
  /** State to the candidacy its delegation backs; null when tied or empty. */
  delegationVotes: Record<string, string | null>;
  /** Candidacy to the number of delegations backing it (every eligible id present). */
  delegationTotals: Record<string, number>;
  /** Majority of the delegation roster. */
  threshold: number;
  /** Delegations that cast a vote. */
  delegationsVoting: number;
  /** Candidacy holding a delegation majority, or null. */
  majorityWinnerId: string | null;
  /** Delegation leader for display (ties broken by id); null with no votes. */
  leaderId: string | null;
  /** Seat-weighted House members backing each candidacy, delegations of DC excluded. */
  memberTotals: Record<string, number>;
  /** Members who voted explicitly (and counted), as opposed to default scoring. */
  explicitVoters: number;
}

export function computeHouseVoteStandings(input: {
  delegations: ContingentHouseDelegation[];
  candidates: ContingentCandidateProfile[];
  /** Voter id to the candidacy they chose. Votes for ineligible ids are ignored. */
  votes: Record<string, string>;
  /** Same seed the engine used for the ballot (the election id). */
  tieSeed: string;
}): HouseVoteStandings {
  const { delegations, candidates, votes, tieSeed } = input;
  const eligible = new Set(candidates.map((c) => c.id));
  const delegationVotes: Record<string, string | null> = {};
  const delegationTotals: Record<string, number> = Object.fromEntries(
    candidates.map((c) => [c.id, 0])
  );
  const memberTotals: Record<string, number> = { ...delegationTotals };
  let explicitVoters = 0;

  for (const delegation of delegations) {
    if (delegation.stateId === CONTINGENT_EXCLUDED_HOUSE_STATE) {
      delegationVotes[delegation.stateId] = null;
      continue;
    }
    const weighted: Record<string, number> = {};
    for (const voter of delegation.voters) {
      const explicit = votes[voter.id];
      let pick: string | null;
      if (explicit && eligible.has(explicit)) {
        pick = explicit;
        explicitVoters += 1;
      } else {
        pick = pickPreferredCandidate(
          voter,
          candidates,
          `${tieSeed}:${delegation.stateId}:${voter.id}`
        );
      }
      if (!pick) continue;
      const weight = voter.weight ?? 1;
      weighted[pick] = (weighted[pick] ?? 0) + weight;
      memberTotals[pick] = (memberTotals[pick] ?? 0) + weight;
    }
    const entries = Object.entries(weighted);
    const top = entries.length > 0 ? Math.max(...entries.map(([, w]) => w)) : 0;
    const leaders = entries.filter(([, w]) => w === top).map(([id]) => id);
    const choice = leaders.length === 1 ? leaders[0] : null;
    delegationVotes[delegation.stateId] = choice;
    if (choice) delegationTotals[choice] = (delegationTotals[choice] ?? 0) + 1;
  }

  const threshold = contingentMajorityOf(delegations.length, HOUSE_CONTINGENT_THRESHOLD);
  const ranked = Object.entries(delegationTotals).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
  const [topId, topCount] = ranked[0] ?? [null, 0];
  return {
    delegationVotes,
    delegationTotals,
    threshold,
    delegationsVoting: Object.values(delegationVotes).filter(Boolean).length,
    majorityWinnerId: topId && topCount >= threshold ? topId : null,
    leaderId: topId && topCount > 0 ? topId : null,
    memberTotals,
    explicitVoters,
  };
}
