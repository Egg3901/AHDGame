/**
 * Primary ballot accrual — the pure math behind real primary vote counts.
 *
 * Model (the registration-pool model): each party's primary electorate is the
 * region's resolved turnout pool scaled by that party's registration share of
 * the electorate. Independents and the unregistered are excluded by
 * construction, because party registration shares plus those two buckets sum
 * to 100. Each turn releases a slice of that pool (same `turnVoteWeight`
 * curve the general uses), split within the party by that turn's score-derived
 * shares — so the cumulative count is the time-integral of the standings the
 * players watched, and a late surge moves the result less than a sustained
 * lead, exactly as accumulating ballots should.
 *
 * Ballots accrue over the CLOSING stretch of the primary phase only (see
 * {@link primaryBallotWindow}): the "primary" phase of a seat is the whole
 * inter-election gap (a US Senate seat sits in it for 240 turns, a UK region
 * for 200+), and nobody casts a primary ballot five years out. Accruing from
 * day one would also hand whoever filed first an unassailable pile before a
 * rival could enter.
 *
 * Everything here is pure so the arithmetic is unit-testable without a
 * database; `recordPrimarySnapshots` supplies the loaded data and persists the
 * result, and `resolvePrimariesIfNeeded` reads the cumulative counts back to
 * pick the nominee.
 */

import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";
import { MS_PER_TURN } from "@/lib/constants/turnTime";

/**
 * The turn window over which a race accrues primary ballots: the closing
 * stretch of the primary phase, as long as the race's own general window
 * (24-72 turns by race type) and never longer than the primary itself. Score
 * standings are still recorded every turn of the primary; ballots only start
 * counting once the window opens, so a primary count runs for as long as
 * the general count does and a late entrant faces a fair field.
 *
 * Turn-first; falls back to the Date fields for un-backfilled docs. Returns
 * null when the race has no usable primary bounds at all.
 */
export function primaryBallotWindow(
  election: {
    startTurn?: number | null;
    primaryEndTurn?: number | null;
    endTurn?: number | null;
    startTime?: Date | string | null;
    primaryEndTime?: Date | string | null;
    endTime?: Date | string | null;
  },
  currentTurn: number,
  now: Date
): {
  startTurn?: number;
  endTurn?: number;
  startTime?: Date;
  endTime?: Date;
  /** True once the window has opened for this turn. */
  open: boolean;
} | null {
  const { startTurn, primaryEndTurn, endTurn } = election;
  if (typeof startTurn === "number" && typeof primaryEndTurn === "number") {
    const primaryLength = Math.max(1, primaryEndTurn - startTurn);
    const generalLength =
      typeof endTurn === "number" ? Math.max(1, endTurn - primaryEndTurn) : primaryLength;
    const windowStart = primaryEndTurn - Math.min(primaryLength, generalLength);
    return { startTurn: windowStart, endTurn: primaryEndTurn, open: currentTurn >= windowStart };
  }
  if (!election.startTime || !election.primaryEndTime) return null;
  const startMs = new Date(election.startTime).getTime();
  const primaryEndMs = new Date(election.primaryEndTime).getTime();
  const primaryLengthMs = Math.max(MS_PER_TURN, primaryEndMs - startMs);
  const generalLengthMs = election.endTime
    ? Math.max(MS_PER_TURN, new Date(election.endTime).getTime() - primaryEndMs)
    : primaryLengthMs;
  const windowStart = new Date(primaryEndMs - Math.min(primaryLengthMs, generalLengthMs));
  return {
    startTime: windowStart,
    endTime: new Date(primaryEndMs),
    open: now.getTime() >= windowStart.getTime(),
  };
}

export interface PrimaryBallotEntry {
  candidateId: string;
  /** This turn's within-party share, 0-100 (the softmax standing). */
  sharePct: number;
}

/**
 * Party primary pools for one race-turn: the region's turnout pool scaled by
 * each party's registration share (0-100). A party with no registration figure
 * gets NO pool — no modeled primary electorate means no ballots to invent —
 * and its primary keeps resolving on score.
 */
export function partyPrimaryPools(
  totalTurnoutPool: number,
  partyIds: readonly string[],
  registrationByParty: ReadonlyMap<string, number>
): Map<string, number> {
  const pools = new Map<string, number>();
  if (!(totalTurnoutPool > 0)) return pools;
  for (const partyId of partyIds) {
    const registration = registrationByParty.get(partyId);
    if (typeof registration !== "number" || !(registration > 0)) continue;
    pools.set(partyId, totalTurnoutPool * (Math.min(100, registration) / 100));
  }
  return pools;
}

/**
 * One turn of ballot accrual for one race. Returns the new cumulative map —
 * every candidate keeps prior ballots, and this turn's party slice is split by
 * this turn's shares. Increments are rounded to whole ballots (people, not
 * fractions), so conservation holds only to rounding.
 */
export function accruePrimaryBallotTurn(args: {
  cumulative: Readonly<Record<string, number>>;
  entriesByParty: ReadonlyMap<string, readonly PrimaryBallotEntry[]>;
  poolsByParty: ReadonlyMap<string, number>;
  totalTurns: number;
  turnIndex: number;
}): Record<string, number> {
  const { cumulative, entriesByParty, poolsByParty, totalTurns, turnIndex } = args;
  const next: Record<string, number> = { ...cumulative };

  for (const [partyId, entries] of entriesByParty) {
    const pool = poolsByParty.get(partyId);
    if (!pool || entries.length === 0) continue;
    const turnBallots = turnVoteWeight(totalTurns, turnIndex, pool);
    if (!(turnBallots > 0)) continue;
    const shareSum = entries.reduce((s, e) => s + Math.max(0, e.sharePct), 0);
    for (const entry of entries) {
      // A degenerate all-zero share field splits the slice evenly — the same
      // fallback the softmax itself uses.
      const fraction = shareSum > 0 ? Math.max(0, entry.sharePct) / shareSum : 1 / entries.length;
      const inc = Math.round(turnBallots * fraction);
      if (inc > 0) next[entry.candidateId] = (next[entry.candidateId] ?? 0) + inc;
    }
  }
  return next;
}

/**
 * Proportional within-party shares from cumulative ballots, 0-100 at 1 decimal.
 * NOT the softmax: softmax decompresses clustered *scores*; applying it to
 * ballot counts in the thousands would collapse every field to 100/0. Returns
 * null when the party has no ballots, so callers fall back to score shares.
 */
export function ballotSharesWithinParty(
  candidateIds: readonly string[],
  primaryVotes: Readonly<Record<string, number>> | undefined
): Map<string, number> | null {
  if (!primaryVotes) return null;
  const total = candidateIds.reduce((s, id) => s + (primaryVotes[id] ?? 0), 0);
  if (!(total > 0)) return null;
  const shares = new Map<string, number>();
  for (const id of candidateIds) {
    shares.set(id, Math.round(((primaryVotes[id] ?? 0) / total) * 1000) / 10);
  }
  return shares;
}

/**
 * Ballot-based ranking input for primary resolution: candidateId → cumulative
 * ballots, or null when the party recorded none (legacy race, missing
 * registration data, or a world that never accrued) — the caller then keeps
 * the legacy score ranking.
 */
export function scoreByPrimaryVotes(
  candidateIds: readonly string[],
  primaryVotes: Readonly<Record<string, number>> | undefined
): Record<string, number> | null {
  if (!primaryVotes) return null;
  let total = 0;
  const out: Record<string, number> = {};
  for (const id of candidateIds) {
    const v = primaryVotes[id] ?? 0;
    out[id] = v;
    total += v;
  }
  return total > 0 ? out : null;
}
