/**
 * UK party conferences — portable rules core (epic #856, ticket #862).
 *
 * Pure data in / plain data out. The shell (`conferenceCommands`, API
 * routes, the turn processor) loads documents, calls these helpers, and
 * writes the results back. No database, clock, randomness, environment, or
 * network here.
 *
 * Calendar: 48 turns = 1 game year (TURNS_PER_YEAR), so the annual
 * conference cadence is 48 turns. Each conference year gets one row per
 * party; the turn driver seeds it at the year's first turn with an opening
 * a few turns later and a voting window inside the same year, so a missed
 * conference expires when the year rolls over.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** One conference per party per game year. */
export const CONFERENCE_CADENCE_TURNS = TURNS_PER_YEAR;

/** Turns after the year's first turn before the conference opens. */
export const CONFERENCE_OPEN_LEAD_TURNS = 6;

/** Voting window once a conference opens (turns). Fits inside the year. */
export const CONFERENCE_VOTING_TURNS = 18;

/** Minimum votes cast to ratify a platform (capped by eligible voters). */
export const CONFERENCE_PLATFORM_QUORUM_FLOOR = 3;

/** Minimum committee votes cast to decide a rules motion (capped by seats). */
export const CONFERENCE_MOTION_QUORUM_FLOOR = 2;

/** Bounded audit trail per conference row. */
export const CONFERENCE_HISTORY_CAP = 50;

/**
 * Approval payoff: favorability points per salient voter group, written to
 * the authoritative `partyGroupFavorability` rows the vote-distribution
 * engine reads. Groups come from the RATIFIED platform's pledge
 * salienceByGroup keys, capped below, and expire after the payoff window.
 *
 * Vote-affecting, so application is gated by UK_CONFERENCE_PAYOFF until
 * calibrated in worldsim (see isConferencePayoffEnabled).
 */
export const CONFERENCE_APPROVAL_DELTA = 2;

/** How long the approval payoff rows stay active (turns). */
export const CONFERENCE_PAYOFF_DURATION_TURNS = 24;

/** Cap on favorability rows written per completed conference. */
export const CONFERENCE_MAX_PAYOFF_GROUPS = 12;

/**
 * Cohesion payoff: political-strength credit to the party reserve (the
 * activist base leaves energised). Below two turns of passive national
 * income against a 280 cap; the write clamps at the party's tier cap.
 */
export const CONFERENCE_COHESION_PS = 30;

/** 1-based game-calendar year index for a turn (turns 1-48 = year 1). */
export function conferenceYearForTurn(turn: number): number {
  return Math.floor((Math.max(1, turn) - 1) / CONFERENCE_CADENCE_TURNS) + 1;
}

/** First turn of a conference year. */
export function conferenceYearStartTurn(year: number): number {
  return (Math.max(1, year) - 1) * CONFERENCE_CADENCE_TURNS + 1;
}

/** Opening turn for a conference seeded in its year. */
export function conferenceOpensAtTurn(year: number): number {
  return conferenceYearStartTurn(year) + CONFERENCE_OPEN_LEAD_TURNS;
}

/** Voting-close turn for a conference opening on the given turn. */
export function conferenceVotingClosesTurn(openedAtTurn: number): number {
  return openedAtTurn + CONFERENCE_VOTING_TURNS;
}

/**
 * Quorum floor for a vote: at most QUORUM_FLOOR voters need to show up, and
 * never more than the eligible roll (a one-person committee can still act).
 */
export function quorumFor(eligibleCount: number, floor: number): number {
  return Math.max(0, Math.min(Math.max(0, eligibleCount), floor));
}

export interface RatificationInput {
  votesFor: number;
  votesAgainst: number;
  eligibleCount: number;
}

export interface RatificationResult {
  passed: boolean;
  reason: string;
}

/**
 * Platform ratification: strict majority of votes cast (ties reject) plus
 * the quorum floor. Pure so player, NPP-acclamation, and turn paths share
 * one bar.
 */
export function resolvePlatformRatification(input: RatificationInput): RatificationResult {
  const total = input.votesFor + input.votesAgainst;
  const quorum = quorumFor(input.eligibleCount, CONFERENCE_PLATFORM_QUORUM_FLOOR);
  if (total < quorum) {
    return { passed: false, reason: `quorum not met (${total}/${quorum} votes cast)` };
  }
  if (input.votesFor <= input.votesAgainst) {
    return {
      passed: false,
      reason: `no majority (${input.votesFor} ratify, ${input.votesAgainst} reject)`,
    };
  }
  return { passed: true, reason: "ratified" };
}

/**
 * Committee-motion decision: same bar as ratification with the smaller
 * committee quorum floor. Bounds/cooldown enforcement happens on apply in
 * the shell, not here: a motion can PASS its vote and still VOID when the
 * #861 cooldown fired since it was proposed.
 */
export function resolveConferenceMotion(input: RatificationInput): RatificationResult {
  const total = input.votesFor + input.votesAgainst;
  const quorum = quorumFor(input.eligibleCount, CONFERENCE_MOTION_QUORUM_FLOOR);
  if (total < quorum) {
    return { passed: false, reason: `quorum not met (${total}/${quorum} votes cast)` };
  }
  if (input.votesFor <= input.votesAgainst) {
    return {
      passed: false,
      reason: `no majority (${input.votesFor} for, ${input.votesAgainst} against)`,
    };
  }
  return { passed: true, reason: "passed" };
}

/**
 * Whether the vote-affecting approval payoff may be written. Gated until
 * the constants above are calibrated in worldsim; the cohesion PS credit
 * is sub-threshold and applies ungated.
 */
export function isConferencePayoffEnabled(envValue: string | undefined): boolean {
  return envValue === "1";
}

/**
 * Pick the payoff voter groups from the ratified platform: the union of
 * the pledges' salienceByGroup keys, sorted for determinism and capped so
 * one conference writes a bounded row set.
 */
export function payoffGroupsForPledges(
  pledgeIds: string[],
  salienceByPledgeId: Map<string, string[]>
): string[] {
  const groups = new Set<string>();
  for (const id of pledgeIds) {
    for (const group of salienceByPledgeId.get(id) ?? []) groups.add(group);
  }
  return [...groups].sort().slice(0, CONFERENCE_MAX_PAYOFF_GROUPS);
}
