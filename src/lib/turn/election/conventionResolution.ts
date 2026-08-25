/**
 * Presidential nomination resolution (rework, Part A).
 *
 * Replaces the silent plurality pick for a delegate race with an explicit,
 * deterministic result:
 *
 *   * delegate_majority — a candidate already holds a majority of the family's
 *     pledged delegates; they are nominated on the first ballot.
 *   * convention — no first-ballot majority and the ruleset enables conventions:
 *     run multi-ballot elimination. Each ballot the field's lowest candidate is
 *     dropped and their delegates are released to the survivors, weighted by
 *     ideological/coalition AFFINITY (shared with the suspend-transfer model) plus
 *     a bonus toward any survivor the dropped candidate actively endorsed. Ballots
 *     repeat until a survivor holds a majority of the remaining delegates.
 *
 * Fully deterministic: every tiebreak is delegates, then national primary votes,
 * then candidate id. No RNG. When conventions are disabled the function returns
 * null for a no-majority race so the caller keeps today's plurality fallback
 * exactly (v1/v2 behavior).
 */

import { getDelegateMajority, type PrimaryCalendarFamily } from "@/lib/constants/primaryCalendar";
import { computeCandidateAffinity } from "@/lib/campaigns/suspendEndorseAffinity";
import type { PresidentialRuleset } from "@/lib/elections/presidentialRuleset";

/**
 * Extra redistribution weight a dropped candidate lends to a survivor they have
 * an active endorsement toward — added on top of the affinity weight, sized to
 * tip an otherwise close release without swamping ideological alignment.
 */
export const ENDORSEMENT_RELEASE_WEIGHT = 0.5;

export interface NominationBallot {
  /** 1-based ballot number. */
  ballot: number;
  /** Delegate count per still-standing candidate at the start of this ballot. */
  tallies: Record<string, number>;
  /** Candidate dropped at the end of this ballot (absent on the deciding ballot). */
  eliminatedCandidateId?: string;
}

export interface NominationResolutionResult {
  mode: "delegate_majority" | "convention";
  winnerCandidateId: string;
  majorityThreshold: number;
  firstBallotLeaderId: string;
  ballots?: NominationBallot[];
  resolvedAt: Date;
}

interface NominationCandidatePosition {
  candidateId: string;
  charEP: number;
  charSP: number;
  party: string;
}

export interface ResolveNominationParams {
  /** Candidate rows contesting this party's nomination. */
  partyCandidates: ReadonlyArray<{ candidateId: string }>;
  /** Pledged delegates per candidate id (from tally.primaryDelegates[partyId]). */
  partyDelegates: Record<string, number>;
  family: PrimaryCalendarFamily;
  preset?: string;
  /** Active in-party endorsements: endorser candidate id -> endorsed candidate id. */
  endorsements?: Map<string, string>;
  /** Candidate ideological/coalition positions for affinity redistribution. */
  enriched: ReadonlyArray<NominationCandidatePosition>;
  /** National primary votes per candidate id (sum over states) for tiebreaks. */
  nationalVotes?: Record<string, number>;
  partyGroupFavorabilityByKey?: Map<string, number>;
  ruleset: Pick<PresidentialRuleset, "conventionEnabled">;
  now?: Date;
}

/**
 * Resolve a single party's presidential nomination. Returns null only when there
 * is no delegate majority AND conventions are disabled, signalling the caller to
 * fall back to its existing plurality/score pick.
 */
export function resolveNominationForParty(
  params: ResolveNominationParams
): NominationResolutionResult | null {
  const {
    partyCandidates,
    partyDelegates,
    family,
    preset,
    endorsements,
    enriched,
    nationalVotes = {},
    partyGroupFavorabilityByKey,
    ruleset,
    now = new Date(),
  } = params;

  const candidateIds = partyCandidates.map((c) => c.candidateId);
  if (candidateIds.length === 0) return null;

  const positionById = new Map(enriched.map((e) => [e.candidateId, e]));
  const majorityThreshold = getDelegateMajority(family, preset);

  // Best-first order over a supplied delegate map: more delegates, then more
  // national votes, then candidate id ascending. Deterministic, no RNG.
  const cmpBest =
    (delegates: Record<string, number>) =>
    (a: string, b: string): number => {
      const da = delegates[a] ?? 0;
      const db = delegates[b] ?? 0;
      if (da !== db) return db - da;
      const va = nationalVotes[a] ?? 0;
      const vb = nationalVotes[b] ?? 0;
      if (va !== vb) return vb - va;
      return a < b ? -1 : a > b ? 1 : 0;
    };

  const firstBallotLeaderId = [...candidateIds].sort(cmpBest(partyDelegates))[0];
  const leaderDelegates = partyDelegates[firstBallotLeaderId] ?? 0;

  // First-ballot majority — nominated outright.
  if (leaderDelegates >= majorityThreshold) {
    return {
      mode: "delegate_majority",
      winnerCandidateId: firstBallotLeaderId,
      majorityThreshold,
      firstBallotLeaderId,
      resolvedAt: now,
    };
  }

  // No majority and conventions disabled: caller keeps its plurality fallback.
  if (!ruleset.conventionEnabled) return null;

  // Multi-ballot convention over a working copy of the delegate counts.
  const current: Record<string, number> = {};
  for (const id of candidateIds) current[id] = partyDelegates[id] ?? 0;

  let remaining = [...candidateIds];
  const ballots: NominationBallot[] = [];
  let ballotNumber = 1;
  let winnerCandidateId = firstBallotLeaderId;

  // Bounded by the field size (one elimination per ballot).
  while (true) {
    const tallies: Record<string, number> = {};
    for (const id of remaining) tallies[id] = current[id];

    const total = remaining.reduce((s, id) => s + current[id], 0);
    const majorityOfRemaining = Math.floor(total / 2) + 1;
    const sorted = [...remaining].sort(cmpBest(current));
    const leader = sorted[0];

    if (remaining.length === 1 || current[leader] >= majorityOfRemaining) {
      ballots.push({ ballot: ballotNumber, tallies });
      winnerCandidateId = leader;
      break;
    }

    const eliminated = sorted[sorted.length - 1];
    ballots.push({ ballot: ballotNumber, tallies, eliminatedCandidateId: eliminated });

    const survivors = remaining.filter((id) => id !== eliminated);
    releaseDelegates({
      total: current[eliminated],
      eliminated,
      survivors,
      current,
      positionById,
      endorsements,
      partyGroupFavorabilityByKey,
    });
    current[eliminated] = 0;
    remaining = survivors;
    ballotNumber++;
  }

  return {
    mode: "convention",
    winnerCandidateId,
    majorityThreshold,
    firstBallotLeaderId,
    ballots,
    resolvedAt: now,
  };
}

/**
 * Distribute a dropped candidate's delegates to survivors, weighted by affinity
 * plus any active-endorsement bonus, as conserved integers via largest-remainder.
 */
function releaseDelegates(params: {
  total: number;
  eliminated: string;
  survivors: string[];
  current: Record<string, number>;
  positionById: Map<string, NominationCandidatePosition>;
  endorsements?: Map<string, string>;
  partyGroupFavorabilityByKey?: Map<string, number>;
}): void {
  const {
    total,
    eliminated,
    survivors,
    current,
    positionById,
    endorsements,
    partyGroupFavorabilityByKey,
  } = params;
  if (total <= 0 || survivors.length === 0) return;

  const endorsedSurvivor = endorsements?.get(eliminated);
  const eliminatedPos = positionById.get(eliminated);

  const weights = new Map<string, number>();
  let weightSum = 0;
  for (const s of survivors) {
    const survivorPos = positionById.get(s);
    let w =
      eliminatedPos && survivorPos
        ? computeCandidateAffinity({
            a: eliminatedPos,
            b: survivorPos,
            partyGroupFavorabilityByKey,
          })
        : 0;
    if (endorsedSurvivor === s) w += ENDORSEMENT_RELEASE_WEIGHT;
    weights.set(s, w);
    weightSum += w;
  }

  // Deterministic survivor order for remainder assignment (candidate id asc).
  const ordered = [...survivors].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // No usable signal (all-zero affinity, no endorsement): split as evenly as
  // possible in the deterministic order.
  if (weightSum <= 0) {
    const base = Math.floor(total / survivors.length);
    let remainder = total - base * survivors.length;
    for (const s of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder--;
      current[s] = (current[s] ?? 0) + base + extra;
    }
    return;
  }

  const exact = ordered.map((s) => {
    const value = (total * (weights.get(s) ?? 0)) / weightSum;
    const base = Math.floor(value);
    return { id: s, base, frac: value - base };
  });
  const allocated = exact.reduce((sum, e) => sum + e.base, 0);
  const remainder = total - allocated;

  // Assign the leftover to the largest fractional parts, id-ascending on ties.
  const byFrac = [...exact].sort((a, b) => b.frac - a.frac || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < remainder; i++) byFrac[i].base += 1;

  for (const e of exact) current[e.id] = (current[e.id] ?? 0) + e.base;
}
