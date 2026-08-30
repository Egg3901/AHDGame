/**
 * Pure arithmetic for converting in-flight races to the registered-voter
 * ballot model (changelog 1.4.25). No DB, no dates from the wall clock — the
 * migration entry loads the documents and persists the results; everything
 * here is unit-testable against hand-rolled fixtures.
 *
 * Two conversions:
 *
 * 1. GENERAL in progress: the engine now releases the pool over an inclusive
 *    window (`endTurn - start + 1` slices instead of `endTurn - start` plus a
 *    repeated final slice) and gates every slice to registered voters, with the
 *    presidency pooling on the voting-eligible population. Turns already banked
 *    under the old sizing are rescaled turn by turn so the count reads as if
 *    the new engine had run from the first general turn. Every turn's factor is
 *    uniform across candidates, so per-turn shares are untouched; only the
 *    magnitude of each slice changes.
 *
 * 2. PRIMARY in progress with its ballot window already open: the engine only
 *    starts banking ballots from the deploy turn, so the elapsed window turns
 *    are replayed from the stored per-turn standings snapshots — the same
 *    "ballots are the time-integral of the standings" rule the engine applies
 *    live, over exactly the same `accruePrimaryBallotTurn`.
 */

import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";
import { accruePrimaryBallotTurn, type PrimaryBallotEntry } from "@/lib/turn/primaryBallots";
import type { VoteTurnSnapshot } from "@/lib/db/types/voteTally";

/** Tally field stamped on every converted document; the migration skips a tally that carries it. */
export const BALLOT_MODEL_VERSION = 1;

/**
 * Ratio of the new inclusive-window slice to the slice the old engine released
 * for the same general turn. The old engine sized the window at
 * `generalLength` slices and clamped the turn that reached `endTurn` onto the
 * final index; the new one sizes it at `generalLength + 1`. Both floor at 4.
 */
export function generalSliceFactor(generalLength: number, turnIndex: number): number {
  const oldTotal = Math.max(4, generalLength);
  const newTotal = Math.max(4, generalLength + 1);
  const oldWeight = turnVoteWeight(oldTotal, Math.max(0, Math.min(turnIndex, oldTotal - 1)), 1);
  const newWeight = turnVoteWeight(newTotal, Math.max(0, Math.min(turnIndex, newTotal - 1)), 1);
  return oldWeight > 0 ? newWeight / oldWeight : 1;
}

function sharesOf(cumulative: Record<string, number>): Record<string, number> {
  const total = Object.values(cumulative).reduce((s, v) => s + v, 0);
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(cumulative)) {
    out[id] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
  }
  return out;
}

/**
 * Rebuild a snapshot series by rescaling each record's INCREMENTS (its
 * cumulative minus the previous record's) by `factorForTurn`, then re-summing.
 * A candidate absent from a record (withdrawn) stays absent from the rebuilt
 * one, exactly as the engine drops withdrawn candidates from `totalVotes`.
 *
 * Records are taken in STORED (chronological) order. A repeated turn — a
 * stalled turn whose lock was cleared and re-run banked one slice per attempt
 * (live turn 460 ran three times) — keeps its first record; every later
 * attempt's increment is dropped from the rebuilt series, not merely its
 * record, so the extra slice leaves the running total too.
 *
 * `ceiling`, when given, is the registered electorate: a record whose rebuilt
 * total would pass it has its increments scaled down to fit, mirroring the
 * engine's cumulative ceiling.
 */
export function rescaleSnapshotIncrements(
  snapshots: readonly VoteTurnSnapshot[],
  factorForTurn: (turn: number, index: number) => number,
  ceiling?: number
): { snapshots: VoteTurnSnapshot[]; totals: Record<string, number>; dropped: number } {
  const out: VoteTurnSnapshot[] = [];
  const seenTurns = new Set<number>();
  let dropped = 0;
  let prevSource: Record<string, number> = {};
  let prevRebuilt: Record<string, number> = {};

  snapshots.forEach((snapshot) => {
    if (seenTurns.has(snapshot.turn)) {
      // A re-run's slice: its increment is real in the source series (later
      // cumulatives include it), so advance the source baseline past it and
      // add nothing to the rebuilt count.
      dropped++;
      prevSource = snapshot.cumulativeVotes;
      return;
    }
    seenTurns.add(snapshot.turn);
    const factor = factorForTurn(snapshot.turn, out.length);
    const rebuilt: Record<string, number> = {};
    let added = 0;
    for (const [id, cum] of Object.entries(snapshot.cumulativeVotes)) {
      const inc = cum - (prevSource[id] ?? 0);
      const scaled = Math.round(inc * factor);
      rebuilt[id] = (prevRebuilt[id] ?? 0) + scaled;
      added += scaled;
    }
    if (ceiling !== undefined && ceiling > 0 && added > 0) {
      const already = Object.keys(rebuilt).reduce((s, id) => s + (prevRebuilt[id] ?? 0), 0);
      const room = Math.max(0, ceiling - already);
      if (added > room) {
        const squeeze = room / added;
        for (const id of Object.keys(rebuilt)) {
          const inc = rebuilt[id] - (prevRebuilt[id] ?? 0);
          rebuilt[id] = (prevRebuilt[id] ?? 0) + Math.round(inc * squeeze);
        }
      }
    }
    out.push({
      ...snapshot,
      cumulativeVotes: rebuilt,
      sharesPct: sharesOf(rebuilt),
    });
    prevSource = snapshot.cumulativeVotes;
    prevRebuilt = rebuilt;
  });

  return { snapshots: out, totals: { ...prevRebuilt }, dropped };
}

/**
 * Carry `totalVotes` across a rescale. Keys the last snapshot still lists take
 * its rebuilt figure; keys only the tally holds (a legacy row, a candidate who
 * withdrew after the last snapshot) scale by the same overall ratio so the
 * document stays internally consistent.
 */
export function carryTotals(
  totalVotes: Record<string, number>,
  lastSource: Record<string, number> | undefined,
  lastRebuilt: Record<string, number>
): Record<string, number> {
  const sourceSum = Object.values(lastSource ?? {}).reduce((s, v) => s + v, 0);
  const rebuiltSum = Object.values(lastRebuilt).reduce((s, v) => s + v, 0);
  const ratio = sourceSum > 0 ? rebuiltSum / sourceSum : 1;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(totalVotes)) {
    out[id] = id in lastRebuilt ? lastRebuilt[id] : Math.round(v * ratio);
  }
  return out;
}

export interface WindowSnapshot<T> {
  snapshot: T;
  turn: number;
}

/**
 * Pick the stored standings that correspond to the elapsed turns of a primary
 * ballot window. Legacy `primarySnapshots` carry no turn number, only
 * `recordedAt`, and a stalled turn re-run can leave two records inside one
 * hour — so records are bucketed by hour (last one per bucket wins) and the
 * newest `count` buckets are taken as the window's turns, oldest first.
 */
export function selectWindowSnapshots<T extends { recordedAt: Date }>(
  untagged: readonly T[],
  count: number,
  firstTurn: number
): WindowSnapshot<T>[] {
  if (count <= 0) return [];
  const byHour = new Map<number, T>();
  for (const s of [...untagged].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())) {
    byHour.set(Math.floor(s.recordedAt.getTime() / 3_600_000), s);
  }
  const ordered = [...byHour.values()];
  const taken = ordered.slice(Math.max(0, ordered.length - count));
  // When fewer records exist than window turns elapsed, the ones we have are
  // the most recent turns: number them so the newest lands on the last turn.
  const offset = count - taken.length;
  return taken.map((snapshot, i) => ({ snapshot, turn: firstTurn + offset + i }));
}

/**
 * Replay the elapsed window turns over the engine's own accrual, oldest first.
 * `turnIndex` is the position within the whole ballot window so the surge
 * curve lands on the same turns the engine would have used.
 */
export function replayPrimaryBallots(args: {
  cumulative: Readonly<Record<string, number>>;
  turns: readonly {
    turnIndex: number;
    entriesByParty: ReadonlyMap<string, readonly PrimaryBallotEntry[]>;
  }[];
  poolsByParty: ReadonlyMap<string, number>;
  totalTurns: number;
}): Record<string, number> {
  let cumulative: Record<string, number> = { ...args.cumulative };
  for (const turn of args.turns) {
    cumulative = accruePrimaryBallotTurn({
      cumulative,
      entriesByParty: turn.entriesByParty,
      poolsByParty: args.poolsByParty,
      totalTurns: args.totalTurns,
      turnIndex: turn.turnIndex,
    });
  }
  return cumulative;
}
