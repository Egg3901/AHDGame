/**
 * Pure ballot for the open House vote after a contingent deadlock.
 *
 * Each sitting House member backs one candidacy. A player member's explicit
 * vote always counts; a member who has not voted, and every NPP, follows the
 * party whip, then the coalition whip, then the engine's coalition-aware
 * preference scoring. One vote per state delegation (plurality of seat weight,
 * ties abstain, DC excluded) and the majority is the same `contingentMajorityOf`
 * of the 50-state roster the engine uses.
 */
import {
  CONTINGENT_EXCLUDED_HOUSE_STATE,
  HOUSE_CONTINGENT_THRESHOLD,
  contingentMajorityOf,
} from "./contingentConstants";
import type {
  ContingentCandidateProfile,
  ContingentHouseDelegation,
  ContingentVoterProfile,
} from "./contingentElection";
import { pickPreferredCandidate } from "./contingentElection";

/** Whip value meaning the group's members vote freely. */
export const FREE_VOTE = "free";

export type HouseWhipMap = Record<string, { candidateId: string }>;

export function partyWhipKey(partySequentialId: string | number): string {
  return `party:${partySequentialId}`;
}

export function coalitionWhipKey(coalitionSequentialId: string | number): string {
  return `coalition:${coalitionSequentialId}`;
}

export interface HouseDelegationRow {
  stateId: string;
  /** Candidacy the delegation backs; null when tied or empty. */
  backing: string | null;
  /** More than one candidacy shares the top weight, so the delegation casts no vote. */
  tied: boolean;
  /** Seat-weighted members behind each candidacy. */
  weights: Record<string, number>;
}

export interface HouseWhipDefiance {
  voterId: string;
  stateId: string;
  /** Candidacy the member voted for. */
  candidateId: string;
  /** Candidacy the whip asked for. */
  whipCandidateId: string;
  whipKey: string;
}

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
  /** Members who voted explicitly (and counted), as opposed to following a whip or scoring. */
  explicitVoters: number;
  /** One row per voting delegation, for the state grid. */
  delegations: HouseDelegationRow[];
  /** Player members whose explicit vote went against the whip that applied to them. */
  defiances: HouseWhipDefiance[];
}

interface AppliedWhip {
  key: string;
  /** Candidacy asked for; null for a free vote. */
  target: string | null;
}

/**
 * The whip that applies to a member: their party's, else their coalition's.
 * A party whip for a candidacy no longer on the ballot is ignored (the
 * coalition whip, then preference, take over); a party "free" whip is a
 * decision by the party and is not overridden by the coalition.
 */
function whipFor(
  voter: ContingentVoterProfile,
  whips: HouseWhipMap,
  partyCoalition: Record<string, string>,
  eligible: Set<string>
): AppliedWhip | null {
  const keys = [partyWhipKey(voter.party)];
  const coalitionId = partyCoalition[voter.party];
  if (coalitionId !== undefined) keys.push(coalitionWhipKey(coalitionId));
  for (const key of keys) {
    const whip = whips[key];
    if (!whip) continue;
    if (whip.candidateId === FREE_VOTE) return { key, target: null };
    if (eligible.has(whip.candidateId)) return { key, target: whip.candidateId };
  }
  return null;
}

function isNppVoter(voter: ContingentVoterProfile): boolean {
  return voter.id.startsWith("npp_");
}

export function computeHouseVoteStandings(input: {
  delegations: ContingentHouseDelegation[];
  /** Candidacies still on the ballot. */
  candidates: ContingentCandidateProfile[];
  /** Voter id to the candidacy they chose. Votes for ineligible ids are ignored. */
  votes: Record<string, string>;
  whips?: HouseWhipMap;
  /** Party sequential id to its coalition's sequential id. */
  partyCoalition?: Record<string, string>;
  /** Same seed the engine used for the ballot (the election id). */
  tieSeed: string;
}): HouseVoteStandings {
  const { delegations, candidates, votes, tieSeed } = input;
  const whips = input.whips ?? {};
  const partyCoalition = input.partyCoalition ?? {};
  const eligible = new Set(candidates.map((c) => c.id));
  const delegationVotes: Record<string, string | null> = {};
  const delegationTotals: Record<string, number> = Object.fromEntries(
    candidates.map((c) => [c.id, 0])
  );
  const memberTotals: Record<string, number> = { ...delegationTotals };
  const rows: HouseDelegationRow[] = [];
  const defiances: HouseWhipDefiance[] = [];
  let explicitVoters = 0;

  for (const delegation of delegations) {
    if (delegation.stateId === CONTINGENT_EXCLUDED_HOUSE_STATE) {
      delegationVotes[delegation.stateId] = null;
      continue;
    }
    const weighted: Record<string, number> = {};
    for (const voter of delegation.voters) {
      const explicit = isNppVoter(voter) ? undefined : votes[voter.id];
      const whip = whipFor(voter, whips, partyCoalition, eligible);
      let pick: string | null;
      if (explicit && eligible.has(explicit)) {
        pick = explicit;
        explicitVoters += 1;
        if (whip?.target && whip.target !== explicit) {
          defiances.push({
            voterId: voter.id,
            stateId: delegation.stateId,
            candidateId: explicit,
            whipCandidateId: whip.target,
            whipKey: whip.key,
          });
        }
      } else if (whip?.target) {
        pick = whip.target;
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
    rows.push({
      stateId: delegation.stateId,
      backing: choice,
      tied: leaders.length > 1,
      weights: weighted,
    });
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
    delegations: rows,
    defiances,
  };
}
