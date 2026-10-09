/**
 * Race replay: a concluded presidential race as it stood at any week of its
 * general campaign.
 *
 * Built from the race payload alone. `generalVotes.stateVotesOverTime` holds
 * each state's cumulative votes per turn, and `evByTurn` the electoral votes
 * per turn, so a frame is the race payload with its per-state results swapped
 * for that turn's snapshot. Every downstream model (the map, the 270 strip)
 * then reads the frame exactly as it reads a live race.
 *
 * Pure; one turn is one in-game week.
 */

import type { ElectionDetail, VoteTurnSnapshot } from "../../components/ElectionDetailTypes";

type GeneralVotes = NonNullable<ElectionDetail["generalVotes"]>;

/** Every turn with at least one state snapshot, oldest first. */
export function replayTurns(election: ElectionDetail): number[] {
  const turns = new Set<number>();
  for (const snaps of Object.values(election.generalVotes?.stateVotesOverTime ?? {})) {
    for (const s of snaps) turns.add(s.turn);
  }
  return [...turns].sort((a, b) => a - b);
}

/** The state's last snapshot at or before `turn` (states start reporting on different turns). */
function snapshotAt(snaps: readonly VoteTurnSnapshot[] | undefined, turn: number) {
  let best: VoteTurnSnapshot | undefined;
  for (const s of snaps ?? []) {
    if (s.turn <= turn && (!best || s.turn > best.turn)) best = s;
  }
  return best;
}

export interface ReplayTotals {
  /** Electoral votes led at this turn, per candidate. */
  ev: Record<string, number>;
  /** National cumulative popular vote at this turn, per candidate. */
  votes: Record<string, number>;
}

export interface ReplayFrame {
  turn: number;
  /** 1-based week of the general campaign. */
  week: number;
  weeks: number;
  /** The race payload as it stood at `turn`. */
  election: ElectionDetail;
  totals: ReplayTotals;
}

/**
 * The race at `turn`: per-state votes from that turn's snapshot, each state's
 * electoral votes to whoever led it, national totals summed from the states,
 * and the snapshot history cut at `turn` so trend readouts end there too.
 */
export function replayFrame(election: ElectionDetail, turn: number): ReplayFrame {
  const gv = election.generalVotes;
  const turns = replayTurns(election);
  const week = Math.max(1, turns.findIndex((t) => t >= turn) + 1 || turns.length);
  if (!gv) {
    return { turn, week, weeks: turns.length, election, totals: { ev: {}, votes: {} } };
  }

  const stateVoteData: NonNullable<GeneralVotes["stateVoteData"]> = {};
  const stateVotesOverTime: NonNullable<GeneralVotes["stateVotesOverTime"]> = {};
  const ev: Record<string, number> = {};
  const votes: Record<string, number> = {};

  for (const [stateId, snaps] of Object.entries(gv.stateVotesOverTime ?? {})) {
    stateVotesOverTime[stateId] = snaps.filter((s) => s.turn <= turn);
    const snap = snapshotAt(snaps, turn);
    const byCandidate = { ...(snap?.cumulativeVotes ?? {}) };
    const ranked = Object.entries(byCandidate)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const stateEv =
      gv.evByState?.[stateId] ??
      Object.values(gv.stateVoteData?.[stateId]?.evByCandidate ?? {}).reduce((s, v) => s + v, 0);
    const evByCandidate: Record<string, number> = {};
    if (ranked.length > 0 && stateEv > 0) {
      evByCandidate[ranked[0][0]] = stateEv;
      ev[ranked[0][0]] = (ev[ranked[0][0]] ?? 0) + stateEv;
    }
    for (const [cid, v] of Object.entries(byCandidate)) votes[cid] = (votes[cid] ?? 0) + v;
    stateVoteData[stateId] = { votesByCandidate: byCandidate, evByCandidate };
  }

  const frameGv: GeneralVotes = {
    ...gv,
    stateVoteData,
    stateVotesOverTime,
    totalVotes: votes,
    electoralVotesByCandidate: ev,
    evByTurn: (gv.evByTurn ?? []).filter((p) => p.turn <= turn),
  };
  return {
    turn,
    week,
    weeks: turns.length,
    election: { ...election, generalVotes: frameGv },
    totals: { ev, votes },
  };
}
