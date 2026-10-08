/**
 * View model for the presidential map: per-state tier, leader, shares, the
 * poll-change badge and the direction of travel.
 *
 * Pure over the election payload. Tier, leader and margin come from the same
 * rules the battleground tile board used (`classifyMarginTier`,
 * `shadeColorForTier`), so the map and the rest of the screen cannot disagree
 * about who is winning a state.
 */

import type { ElectionDetail, VoteTurnSnapshot } from "../../components/ElectionDetailTypes";
import { classifyMarginTier, type MarginTier } from "@/lib/elections/generalViewModel";
import { readableInk, shadeColorForTier } from "@/lib/elections/marginTierShade";
import { BLEND } from "@/components/blend/tokens";
import { STATE_NAMES } from "./usStates";

const FALLBACK_COLOR = "#9CA3AF";

/** Shares closer than this are the same figure for display purposes. */
const SAME_SHARE_EPSILON_PP = 0.05;

/** Turns the trend looks back over, when that much history exists. */
export const TREND_WINDOW_TURNS = 3;

/** A trend smaller than this is called steady rather than a movement. */
export const TREND_MIN_SHIFT_PP = 0.1;

/** Points kept for the sparkline. */
const SERIES_POINTS = 12;

export interface PresMapShare {
  id: string;
  name: string;
  color: string;
  votes: number;
  /** Projected share of the state's vote, 0..100. */
  pct: number;
  /** Electoral votes this candidate takes from the state (split only in ME/NE). */
  ev: number;
  /** Percentage-point change in share against the baseline; null when unknown. */
  changePp: number | null;
}

export interface PresMapTrend {
  /** `toward` names a candidate; `steady` is no meaningful movement; `none` is too little history. */
  status: "none" | "steady" | "toward";
  candidateId: string | null;
  name: string | null;
  color: string | null;
  /** How far the top-two margin swung toward the named candidate, percentage points. */
  shiftPp: number;
  windowTurns: number;
  /** Top two candidates' shares by turn, oldest first, for the sparkline. */
  series: { turn: number; shares: Record<string, number> }[];
}

export interface PresMapChange {
  /** Candidate id to percentage-point change. Empty when there is no baseline. */
  changes: Record<string, number>;
  /** Turn the change is measured against, or null. */
  sinceTurn: number | null;
  /** How many turns back that baseline is, or null. */
  turnsAgo: number | null;
}

/**
 * Pattern drawn over a state instead of a flat fill: diagonal hatch lines in
 * `colors[0]` over `base`, or alternating diagonal stripes of `colors`.
 */
export interface PresMapOverlay {
  kind: "hatch" | "stripe";
  base: string;
  colors: string[];
}

/** Election-night readout for one state. Absent on the general-screen map. */
export interface PresMapBroadcast {
  statusLabel: string;
  /** 0-100. */
  reportingPct: number;
  /** Poll close, e.g. "8:00 PM ET". */
  closeLabel: string;
  /** Polls have closed. */
  closed: boolean;
  /** The state has numbers to show (past the too-early floor). */
  showNumbers: boolean;
  called: boolean;
  /** County results may be shown: the state is called or the race has resolved. */
  countiesOpen: boolean;
}

export interface PresMapState {
  id: string;
  name: string;
  ev: number;
  leaderId: string;
  leaderName: string;
  leaderColor: string;
  /** Leader share minus runner-up share, percentage points. */
  margin: number;
  tier: MarginTier;
  fill: string;
  ink: string;
  shares: PresMapShare[];
  totalVotes: number;
  trend: PresMapTrend;
  sinceTurn: number | null;
  turnsAgo: number | null;
  /** Pattern fill (leaning, too close, too early). `fill` stays the flat fallback and the label ground. */
  overlay?: PresMapOverlay;
  /** Replaces the "+margin / tier" line in tooltips, chips and aria labels. */
  caption?: string;
  broadcast?: PresMapBroadcast;
  /** A new token replays the call highlight on this state. */
  pulse?: string;
}

export interface PresMapCandidate {
  id: string;
  name: string;
  color: string;
}

export interface PresMapModel {
  states: Record<string, PresMapState>;
  /** Every ticket on the ballot, for lookups outside a single state. */
  candidates: Record<string, PresMapCandidate>;
  /** The tickets the legend ramps are drawn in: the top two by electoral votes. */
  legendCandidates: PresMapCandidate[];
}

/** Shares in percent from raw votes. */
export function sharesFromVotes(votes: Record<string, number>): Record<string, number> {
  const total = Object.values(votes).reduce((s, v) => s + (v > 0 ? v : 0), 0);
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(votes)) out[id] = total > 0 && v > 0 ? (v / total) * 100 : 0;
  return out;
}

/** Shares in percent from one stored snapshot, preferring the unrounded votes. */
export function sharesFromSnapshot(snap: VoteTurnSnapshot): Record<string, number> {
  const fromVotes = sharesFromVotes(snap.cumulativeVotes ?? {});
  const hasVotes = Object.values(fromVotes).some((v) => v > 0);
  return hasVotes ? fromVotes : { ...(snap.sharesPct ?? {}) };
}

function sortedByTurn(snaps: VoteTurnSnapshot[] | undefined): VoteTurnSnapshot[] {
  return [...(snaps ?? [])].sort((a, b) => a.turn - b.turn);
}

function maxShareGap(a: Record<string, number>, b: Record<string, number>): number {
  let gap = 0;
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    gap = Math.max(gap, Math.abs((a[id] ?? 0) - (b[id] ?? 0)));
  }
  return gap;
}

/**
 * Change in each candidate's projected share since the previous turn.
 *
 * `current` is the share the panel prints. When it is the latest stored
 * snapshot, the baseline is the snapshot before it; when the payload is newer
 * than the last snapshot, the baseline is that last snapshot. Either way the
 * badge is current minus a stored earlier turn, never current minus itself.
 */
export function computePollingChange(
  current: Record<string, number>,
  snapshots: VoteTurnSnapshot[] | undefined,
  currentTurn?: number | null
): PresMapChange {
  const snaps = sortedByTurn(snapshots);
  if (snaps.length === 0) return { changes: {}, sinceTurn: null, turnsAgo: null };
  const latest = snaps[snaps.length - 1];
  const latestMatches = maxShareGap(current, sharesFromSnapshot(latest)) < SAME_SHARE_EPSILON_PP;
  const baseline = latestMatches ? snaps[snaps.length - 2] : latest;
  if (!baseline) return { changes: {}, sinceTurn: null, turnsAgo: null };
  const base = sharesFromSnapshot(baseline);
  const changes: Record<string, number> = {};
  for (const id of Object.keys(current)) changes[id] = (current[id] ?? 0) - (base[id] ?? 0);
  const head = latestMatches ? latest.turn : (currentTurn ?? latest.turn);
  return {
    changes,
    sinceTurn: baseline.turn,
    turnsAgo: Math.max(1, head - baseline.turn),
  };
}

/**
 * Which way a state is moving: toward whichever of the current top two gained
 * on the other over the last few turns, or steady when the margin barely moved.
 */
export function computeTrend(
  snapshots: VoteTurnSnapshot[] | undefined,
  lookup: (id: string) => PresMapCandidate,
  topIds: string[],
  windowTurns: number = TREND_WINDOW_TURNS
): PresMapTrend {
  const snaps = sortedByTurn(snapshots);
  const empty: PresMapTrend = {
    status: "none",
    candidateId: null,
    name: null,
    color: null,
    shiftPp: 0,
    windowTurns: 0,
    series: [],
  };
  if (snaps.length < 2) return empty;
  const latest = snaps[snaps.length - 1];
  const series = snaps.slice(-SERIES_POINTS).map((s) => {
    const all = sharesFromSnapshot(s);
    const shares: Record<string, number> = {};
    for (const id of topIds) shares[id] = all[id] ?? 0;
    return { turn: s.turn, shares };
  });
  // Latest snapshot at least `windowTurns` back, else the oldest one we have.
  let ref = snaps[0];
  for (const s of snaps) {
    if (s.turn <= latest.turn - windowTurns) ref = s;
  }
  if (ref.turn >= latest.turn) return { ...empty, series };
  const now = sharesFromSnapshot(latest);
  const before = sharesFromSnapshot(ref);
  // Direction is read off the race that decides the state: the margin between
  // the current top two. A minor ticket gaining a point says nothing about
  // which way the state is heading.
  const [leadId, nextId] = topIds;
  let bestId: string | null = null;
  let best = 0;
  if (leadId && nextId) {
    const swing =
      (now[leadId] ?? 0) - (now[nextId] ?? 0) - ((before[leadId] ?? 0) - (before[nextId] ?? 0));
    bestId = swing >= 0 ? leadId : nextId;
    best = Math.abs(swing);
  } else if (leadId) {
    bestId = leadId;
    best = Math.max(0, (now[leadId] ?? 0) - (before[leadId] ?? 0));
  }
  const span = latest.turn - ref.turn;
  if (bestId === null || best < TREND_MIN_SHIFT_PP) {
    return { ...empty, status: "steady", windowTurns: span, series };
  }
  const cand = lookup(bestId);
  return {
    status: "toward",
    candidateId: bestId,
    name: cand.name,
    color: cand.color,
    shiftPp: best,
    windowTurns: span,
    series,
  };
}

export type PollBadgeTone = "up" | "down" | "flat";

/** Signed percent text for a point change, e.g. "+1.2%". Zero reads "0.0%". */
export function formatPollChange(changePp: number): { text: string; tone: PollBadgeTone } {
  const rounded = Math.round(changePp * 10) / 10;
  if (rounded === 0) return { text: "0.0%", tone: "flat" };
  const text = `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toFixed(1)}%`;
  return { text, tone: rounded > 0 ? "up" : "down" };
}

/** Tooltip saying which window a poll-change badge covers. */
export function pollChangeHint(turnsAgo: number | null, sinceTurn: number | null): string {
  if (turnsAgo === null || sinceTurn === null) return "No earlier turn to compare against.";
  const window = turnsAgo === 1 ? "since last turn" : `over the last ${turnsAgo} turns`;
  return `Change in projected vote share ${window} (turn ${sinceTurn}), in percentage points.`;
}

/** One-line reading of a trend, e.g. "Trending toward Name, margin swing 0.8 pts over the last 3 turns". */
export function describeTrend(trend: PresMapTrend): string {
  if (trend.status === "none") return "Not enough turns yet to show a direction.";
  const turns = `${trend.windowTurns} ${trend.windowTurns === 1 ? "turn" : "turns"}`;
  if (trend.status === "steady") return `Holding steady over the last ${turns}.`;
  return `Trending toward ${trend.name}, margin swing ${trend.shiftPp.toFixed(1)} pts over the last ${turns}.`;
}

export function buildPresMapModel(election: ElectionDetail): PresMapModel {
  const gv = election.generalVotes;
  const currentTurn = election.gameState?.currentTurn ?? null;

  const candidates = new Map<string, PresMapCandidate>();
  for (const c of election.allCandidates) {
    candidates.set(c.id, {
      id: c.id,
      name: c.characterName,
      color: c.campaignColor ?? c.partyColor ?? gv?.candidateColors?.[c.id] ?? FALLBACK_COLOR,
    });
  }
  const lookup = (id: string): PresMapCandidate =>
    candidates.get(id) ?? {
      id,
      name: gv?.candidateNames?.[id] ?? "Unknown",
      color: gv?.candidateColors?.[id] ?? FALLBACK_COLOR,
    };

  const states: Record<string, PresMapState> = {};
  for (const [stateId, data] of Object.entries(gv?.stateVoteData ?? {})) {
    const ranked = Object.entries(data.votesByCandidate)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((s, [, v]) => s + v, 0);
    // No margin to report with fewer than two candidates on the board.
    if (ranked.length < 2 || total <= 0) continue;

    const margin = ((ranked[0][1] - ranked[1][1]) / total) * 100;
    const tier = classifyMarginTier(margin);
    const leader = lookup(ranked[0][0]);
    const fill = shadeColorForTier(leader.color, tier, BLEND.page);

    const current = sharesFromVotes(data.votesByCandidate);
    const snapshots = gv?.stateVotesOverTime?.[stateId];
    const change = computePollingChange(current, snapshots, currentTurn);
    const topIds = ranked.slice(0, 2).map(([id]) => id);

    const stateEv = gv?.evByState?.[stateId];
    const ev = stateEv ?? Object.values(data.evByCandidate ?? {}).reduce((s, v) => s + v, 0);

    states[stateId] = {
      id: stateId,
      name: gv?.electoralMapData?.[stateId]?.label ?? STATE_NAMES[stateId] ?? stateId,
      ev,
      leaderId: leader.id,
      leaderName: leader.name,
      leaderColor: leader.color,
      margin,
      tier,
      fill,
      ink: readableInk(fill),
      shares: ranked.map(([id, votes]) => {
        const c = lookup(id);
        return {
          id,
          name: c.name,
          color: c.color,
          votes,
          pct: current[id] ?? 0,
          ev: data.evByCandidate?.[id] ?? 0,
          changePp: id in change.changes ? change.changes[id] : null,
        };
      }),
      totalVotes: total,
      trend: computeTrend(snapshots, lookup, topIds),
      sinceTurn: change.sinceTurn,
      turnsAgo: change.turnsAgo,
    };
  }

  // Ramps are drawn for the two leading tickets: by electoral votes, else by ballots.
  const byEv = Object.entries(gv?.electoralVotesByCandidate ?? {}).filter(([, ev]) => ev > 0);
  const legendSource = byEv.length >= 2 ? byEv : Object.entries(gv?.totalVotes ?? {});
  const legendCandidates = legendSource
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([id]) => lookup(id));

  return { states, candidates: Object.fromEntries(candidates), legendCandidates };
}
