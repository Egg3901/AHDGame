/**
 * Pure US presidential contingent-election logic (12th Amendment).
 *
 * When no candidate reaches an Electoral College majority, the House elects
 * the President from the top three EV recipients. This is **not** a raw
 * 435-member roll call: each **state delegation** casts one vote (26 states
 * needed). Representatives only decide how their state's single delegation
 * vote is cast; tied delegations abstain. DC is excluded. The Senate elects
 * the Vice President from the top two running mates (one vote per senator).
 */

import { createHash } from "crypto";
import { ObjectId } from "mongodb";
import { HOUSE_SEATS } from "@/lib/constants/states";

/**
 * Modern-roster fallbacks: a majority of 50 House delegations and of 100
 * senators. The live ballot derives its thresholds from the rosters actually
 * voting (`contingentMajorityOf`), which reproduces these numbers exactly on
 * the modern roster and yields the era-correct 25-of-48 / 49-of-96 on 1950s
 * worlds. Kept exported as the no-roster fallback and for display defaults.
 */
export const HOUSE_CONTINGENT_THRESHOLD = 26;
export const SENATE_CONTINGENT_THRESHOLD = 51;

/** Majority of a contingent-ballot roster: more than half of its members. */
export function contingentMajorityOf(rosterSize: number, fallback: number): number {
  if (!Number.isFinite(rosterSize) || rosterSize <= 0) return fallback;
  return Math.floor(rosterSize / 2) + 1;
}
/** DC has EVs but no voting House delegation in a contingent election. */
export const CONTINGENT_EXCLUDED_HOUSE_STATE = "DC";

/** 50 states with House delegations; DC excluded from contingent House ballot. */
export const CONTINGENT_HOUSE_STATE_IDS = Object.keys(HOUSE_SEATS).sort();

/** Party-line default; kept modest so ideology distance (~0–20) can swing close races. */
const PARTY_MATCH_BONUS = 35;

export interface ContingentCandidateProfile {
  id: string;
  party: string;
  economic: number;
  social: number;
}

export interface ContingentVoterProfile {
  id: string;
  party: string;
  economic: number;
  social: number;
  /** Seat weight for aggregated NPP bloc officials (default 1). */
  weight?: number;
}

export interface ContingentHouseDelegation {
  stateId: string;
  voters: ContingentVoterProfile[];
}

export interface ContingentElectionResult {
  resolutionMode: "contingent" | "contingent_deadlock";
  eligiblePresidentCandidateIds: string[];
  eligibleVicePresidentCandidateIds: string[];
  houseDelegationVotes: Record<string, string | null>;
  houseVoteTotals: Record<string, number>;
  senateVotes: Record<string, string | null>;
  senateVoteTotals: Record<string, number>;
  presidentWinnerId: string;
  /** Empty when no running mates were eligible for a Senate contingent vote. */
  vicePresidentWinnerId: string | null;
  houseThreshold: number;
  senateThreshold: number;
  deadlockBreakerUsed: boolean;
  deadlockBreakerReason?: string;
  topElectoralVoteTotal: number;
}

export interface ResolveContingentElectionInput {
  electionId: ObjectId;
  electoralVotesByCandidate: Record<string, number>;
  presidentCandidates: ContingentCandidateProfile[];
  vicePresidentCandidates: ContingentCandidateProfile[];
  houseDelegations: ContingentHouseDelegation[];
  senators: ContingentVoterProfile[];
  /** EV per ballot-eligible id (president candidate ids + VP person ids). */
  evByEligibleId?: Record<string, number>;
}

/** Top N presidential candidates by electoral vote (ties broken by id). */
export function getTopContingentPresidentCandidates(
  electoralVotesByCandidate: Record<string, number>,
  limit = 3
): string[] {
  return Object.entries(electoralVotesByCandidate)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

/** Running mates for the top N presidential tickets by EV. */
export function getTopContingentVicePresidentCandidateIds(
  electoralVotesByCandidate: Record<string, number>,
  runningMateByPresidentId: Record<string, string | undefined>,
  limit = 2
): string[] {
  const vpIds: string[] = [];
  for (const presidentId of getTopContingentPresidentCandidates(electoralVotesByCandidate, limit)) {
    const runningMateId = runningMateByPresidentId[presidentId];
    if (runningMateId && !vpIds.includes(runningMateId)) {
      vpIds.push(runningMateId);
    }
  }
  return vpIds;
}

export function scoreContingentPreference(
  voter: ContingentVoterProfile,
  candidate: ContingentCandidateProfile
): number {
  let score = 0;
  if (voter.party && candidate.party && voter.party === candidate.party) {
    score += PARTY_MATCH_BONUS;
  }
  const ideologyDistance =
    Math.abs(voter.economic - candidate.economic) + Math.abs(voter.social - candidate.social);
  return score - ideologyDistance;
}

/** Pick the voter's preferred candidate; voter-level ties use a deterministic hash. */
export function pickPreferredCandidate(
  voter: ContingentVoterProfile,
  eligibleCandidates: ContingentCandidateProfile[],
  tieSeed: string
): string | null {
  if (eligibleCandidates.length === 0) return null;

  let bestScore = -Infinity;
  let bestIds: string[] = [];
  for (const candidate of eligibleCandidates) {
    const score = scoreContingentPreference(voter, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestIds = [candidate.id];
    } else if (score === bestScore) {
      bestIds.push(candidate.id);
    }
  }

  if (bestIds.length === 1) return bestIds[0];

  const sorted = bestIds.slice().sort();
  const idx =
    createHash("sha256")
      .update(`${tieSeed}:${sorted.join(":")}`)
      .digest()[0] % sorted.length;
  return sorted[idx];
}

/**
 * One state delegation vote. Tied delegations abstain (return null).
 */
export function calculateHouseDelegationVote(
  delegation: ContingentHouseDelegation,
  eligibleCandidates: ContingentCandidateProfile[],
  tieSeed: string
): string | null {
  if (delegation.stateId === CONTINGENT_EXCLUDED_HOUSE_STATE) return null;
  if (eligibleCandidates.length === 0 || delegation.voters.length === 0) return null;

  const weightedTotals: Record<string, number> = {};
  for (const voter of delegation.voters) {
    const pick = pickPreferredCandidate(
      voter,
      eligibleCandidates,
      `${tieSeed}:${delegation.stateId}:${voter.id}`
    );
    if (!pick) continue;
    const weight = voter.weight ?? 1;
    weightedTotals[pick] = (weightedTotals[pick] ?? 0) + weight;
  }

  if (Object.keys(weightedTotals).length === 0) return null;

  const maxVotes = Math.max(...Object.values(weightedTotals));
  const leaders = Object.entries(weightedTotals)
    .filter(([, votes]) => votes === maxVotes)
    .map(([id]) => id);
  return leaders.length === 1 ? leaders[0] : null;
}

export function calculateHouseDelegationVotes(
  delegations: ContingentHouseDelegation[],
  eligibleCandidates: ContingentCandidateProfile[],
  tieSeed: string
): { delegationVotes: Record<string, string | null>; totals: Record<string, number> } {
  const delegationVotes: Record<string, string | null> = {};
  const totals: Record<string, number> = {};

  for (const delegation of delegations) {
    const vote = calculateHouseDelegationVote(delegation, eligibleCandidates, tieSeed);
    delegationVotes[delegation.stateId] = vote;
    if (vote) totals[vote] = (totals[vote] ?? 0) + 1;
  }

  return { delegationVotes, totals };
}

export function calculateSenateVpVotes(
  senators: ContingentVoterProfile[],
  eligibleVpCandidates: ContingentCandidateProfile[],
  tieSeed: string
): { votes: Record<string, string | null>; totals: Record<string, number> } {
  const votes: Record<string, string | null> = {};
  const totals: Record<string, number> = {};

  for (const senator of senators) {
    const pick = pickPreferredCandidate(
      senator,
      eligibleVpCandidates,
      `${tieSeed}:senate:${senator.id}`
    );
    votes[senator.id] = pick;
    if (pick) totals[pick] = (totals[pick] ?? 0) + 1;
  }

  return { votes, totals };
}

function resolveContingentEvFallback(
  electionId: ObjectId,
  evByEligibleId: Record<string, number>,
  eligibleIds: string[],
  context: "house" | "senate"
): { winnerId: string; deadlockBreakerReason: string } {
  if (eligibleIds.length === 0) {
    throw new Error(`Contingent ${context} election produced no votes and no eligible candidates`);
  }

  const ranked = eligibleIds
    .map((id) => [id, evByEligibleId[id] ?? 0] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const topEv = ranked[0][1];
  const leaders = ranked.filter(([, ev]) => ev === topEv).map(([id]) => id);
  const sorted = leaders.slice().sort();
  const idx =
    createHash("sha256")
      .update(`${electionId}:ev-fallback:${context}:${sorted.join(":")}`)
      .digest()[0] % sorted.length;

  return {
    winnerId: sorted[idx],
    deadlockBreakerReason: `No ${context} votes cast; EV-order fallback among ${sorted.join(", ")} at ${topEv} EV`,
  };
}

function resolveWinnerFromTotals(
  electionId: ObjectId,
  totals: Record<string, number>,
  threshold: number,
  context: "house" | "senate",
  eligibleIds: string[],
  evByEligibleId: Record<string, number>
): { winnerId: string; deadlockBreakerUsed: boolean; deadlockBreakerReason?: string } {
  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) {
    const fallback = resolveContingentEvFallback(electionId, evByEligibleId, eligibleIds, context);
    return {
      winnerId: fallback.winnerId,
      deadlockBreakerUsed: true,
      deadlockBreakerReason: fallback.deadlockBreakerReason,
    };
  }

  const [topId, topVotes] = ranked[0];
  if (topVotes >= threshold) {
    return { winnerId: topId, deadlockBreakerUsed: false };
  }

  const leaders = ranked.filter(([, votes]) => votes === topVotes).map(([id]) => id);
  const sorted = leaders.slice().sort();
  const idx =
    createHash("sha256")
      .update(`${electionId}:deadlock:${context}:${sorted.join(":")}`)
      .digest()[0] % sorted.length;

  return {
    winnerId: sorted[idx],
    deadlockBreakerUsed: true,
    deadlockBreakerReason: `No ${context} candidate reached ${threshold}; tiebroken among ${sorted.join(", ")} at ${topVotes} vote(s)`,
  };
}

function assertPresidentCandidatesEligible(
  presidentCandidates: ContingentCandidateProfile[],
  electoralVotesByCandidate: Record<string, number>
): void {
  const expectedTop3 = getTopContingentPresidentCandidates(electoralVotesByCandidate, 3);
  const actualIds = presidentCandidates.map((c) => c.id);
  const extras = actualIds.filter((id) => !expectedTop3.includes(id));
  if (extras.length > 0) {
    throw new Error(
      `Contingent ballot includes ineligible presidential candidates: ${extras.join(", ")}`
    );
  }
}

/** Run a full contingent election from pre-loaded chamber and candidate data. */
export function resolveContingentElection(
  input: ResolveContingentElectionInput
): ContingentElectionResult {
  const {
    electionId,
    electoralVotesByCandidate,
    presidentCandidates,
    vicePresidentCandidates,
    houseDelegations,
    senators,
  } = input;

  assertPresidentCandidatesEligible(presidentCandidates, electoralVotesByCandidate);

  const eligiblePresidentCandidateIds = presidentCandidates.map((c) => c.id);
  const eligibleVicePresidentCandidateIds = vicePresidentCandidates.map((c) => c.id);

  if (eligiblePresidentCandidateIds.length === 0) {
    throw new Error("Contingent election requires at least one eligible presidential candidate");
  }

  const evByEligibleId: Record<string, number> = input.evByEligibleId ?? {};
  for (const id of eligiblePresidentCandidateIds) {
    if (evByEligibleId[id] == null) {
      evByEligibleId[id] = electoralVotesByCandidate[id] ?? 0;
    }
  }
  for (const vp of vicePresidentCandidates) {
    if (evByEligibleId[vp.id] == null) evByEligibleId[vp.id] = 0;
  }

  const tieSeed = electionId.toString();
  // Era-aware majorities: a majority of the delegations and senators actually
  // on the ballot, not of the modern roster. 50 delegations -> 26 and 100
  // senators -> 51 (identical to the old constants); 1950s worlds -> 25 of 48
  // and 49 of 96.
  const houseThreshold = contingentMajorityOf(houseDelegations.length, HOUSE_CONTINGENT_THRESHOLD);
  const senateThreshold = contingentMajorityOf(senators.length, SENATE_CONTINGENT_THRESHOLD);
  const { delegationVotes, totals: houseVoteTotals } = calculateHouseDelegationVotes(
    houseDelegations,
    presidentCandidates,
    tieSeed
  );

  let senateVotes: Record<string, string | null> = {};
  let senateVoteTotals: Record<string, number> = {};
  let vicePresidentWinnerId: string | null = null;
  let senateDeadlockUsed = false;
  let senateDeadlockReason: string | undefined;

  if (eligibleVicePresidentCandidateIds.length === 1) {
    vicePresidentWinnerId = eligibleVicePresidentCandidateIds[0];
  } else if (eligibleVicePresidentCandidateIds.length >= 2) {
    const senateBallot = calculateSenateVpVotes(senators, vicePresidentCandidates, tieSeed);
    senateVotes = senateBallot.votes;
    senateVoteTotals = senateBallot.totals;
    const senateOutcome = resolveWinnerFromTotals(
      electionId,
      senateVoteTotals,
      senateThreshold,
      "senate",
      eligibleVicePresidentCandidateIds,
      evByEligibleId
    );
    vicePresidentWinnerId = senateOutcome.winnerId;
    senateDeadlockUsed = senateOutcome.deadlockBreakerUsed;
    senateDeadlockReason = senateOutcome.deadlockBreakerReason;
  }

  const houseOutcome = resolveWinnerFromTotals(
    electionId,
    houseVoteTotals,
    houseThreshold,
    "house",
    eligiblePresidentCandidateIds,
    evByEligibleId
  );

  const deadlockBreakerUsed = houseOutcome.deadlockBreakerUsed || senateDeadlockUsed;
  const deadlockReasons = [houseOutcome.deadlockBreakerReason, senateDeadlockReason]
    .filter(Boolean)
    .join("; ");

  const rankedEv = Object.entries(electoralVotesByCandidate).sort((a, b) => b[1] - a[1]);

  return {
    resolutionMode: deadlockBreakerUsed ? "contingent_deadlock" : "contingent",
    eligiblePresidentCandidateIds,
    eligibleVicePresidentCandidateIds,
    houseDelegationVotes: delegationVotes,
    houseVoteTotals,
    senateVotes,
    senateVoteTotals,
    presidentWinnerId: houseOutcome.winnerId,
    vicePresidentWinnerId,
    houseThreshold,
    senateThreshold,
    deadlockBreakerUsed,
    deadlockBreakerReason: deadlockReasons || undefined,
    topElectoralVoteTotal: rankedEv[0]?.[1] ?? 0,
  };
}
