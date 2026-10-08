/**
 * View model for the presidential election-night broadcast.
 *
 * Pure over the results payload. The broadcast reads only what the payload
 * exposes (`election.night`, per-unit `nightStatus` and revealed numbers,
 * candidate totals built from revealed votes), never the election detail
 * tally, so nothing here can leak a number the night has not yet shown.
 */

import {
  FIRST_CLOSE_ET_HOUR,
  LAST_CLOSE_ET_HOUR,
  pollCloseEtHour,
} from "@/lib/elections/liveResults/usPollClosing";
import {
  NIGHT_FIRST_CLOSE_FRACTION,
  NIGHT_LAST_CLOSE_FRACTION,
} from "@/lib/elections/liveResults/presidentialNight";
import type {
  ElectionResultsResponse,
  PresidentialNightEvent,
  PresidentialNightStatus,
  ResultsCandidate,
  ResultsElectionMeta,
  ResultsUnit,
} from "@/lib/elections/liveResults/types";

export const FALLBACK_COLOR = "#9CA3AF";

/** Length of the replayed night when an admin previews it (see the results page ticker). */
export const SIM_WINDOW_REAL_MS = 50_000;

/** A race inside this counted margin (percentage points) is listed as a key race while uncalled. */
export const KEY_RACE_MARGIN_PP = 5;
export const KEY_RACES_MAX = 8;

const ENDED = new Set(["resolved", "completed"]);

export type NightPaint = "grey" | "fog" | "lean" | "stripe" | "called";

export interface NightStatusStyle {
  paint: NightPaint;
  label: string;
  /** The state may show a leader, shares and votes. */
  showNumbers: boolean;
}

/** How each broadcast status is painted and worded. */
export function nightStatusStyle(status: PresidentialNightStatus): NightStatusStyle {
  switch (status) {
    case "polls_open":
      return { paint: "grey", label: "Polls open", showNumbers: false };
    case "counting":
      return { paint: "fog", label: "Polls closed", showNumbers: false };
    case "too_early":
      return { paint: "fog", label: "Too early to call", showNumbers: false };
    case "leaning":
      return { paint: "lean", label: "Not yet called", showNumbers: true };
    case "too_close":
      return { paint: "stripe", label: "Too close to call", showNumbers: true };
    case "called":
      return { paint: "called", label: "Projected", showNumbers: true };
  }
}

/** Status for a unit, including units from a resolved (non-night) payload. */
export function unitNightStatus(unit: ResultsUnit): PresidentialNightStatus {
  if (unit.nightStatus) return unit.nightStatus;
  if (unit.called) return "called";
  return unit.totalVotes > 0 ? "leaning" : "counting";
}

// ---- clock ----

/**
 * Window fraction (0..1) to an Eastern clock hour (19 = 7:00 PM, 25 = 1:00 AM).
 * The first poll closing sits at 7:00 PM and the last at 1:00 AM, so a state
 * closing on screen always agrees with the clock. Outside that span the line
 * is extended, which reads as the evening before and the small hours after.
 */
export function nightClockHour(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  const t =
    (f - NIGHT_FIRST_CLOSE_FRACTION) / (NIGHT_LAST_CLOSE_FRACTION - NIGHT_FIRST_CLOSE_FRACTION);
  return FIRST_CLOSE_ET_HOUR + t * (LAST_CLOSE_ET_HOUR - FIRST_CLOSE_ET_HOUR);
}

/** "7:05 PM ET" from a decimal Eastern hour; hours past 24 wrap to the next day. */
export function formatEtClock(hour: number): string {
  const total = Math.floor(hour * 60 + 1e-6);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ET`;
}

/** Scheduled close of a state's polls, e.g. "8:30 PM ET". */
export function pollCloseLabel(unitId: string): string {
  return formatEtClock(pollCloseEtHour(unitId));
}

/** A viewer never interpolates further than this past the payload, so a skewed clock cannot run away. */
export const MAX_INTERPOLATE_MS = 20_000;

/**
 * Progress through the final hour (0..1). `progress` is the server's value at
 * `payloadAtMs`; a live viewer interpolates forward on the wall clock between
 * polls, a replay does not (it is driven frame by frame).
 */
export function nightProgressAt(
  election: Pick<ResultsElectionMeta, "finalHour">,
  payloadAtMs: number,
  nowMs: number,
  windowRealMs: number,
  interpolate: boolean
): number {
  const base = Math.min(1, Math.max(0, election.finalHour?.progress ?? 0));
  if (!interpolate || windowRealMs <= 0 || !Number.isFinite(payloadAtMs)) return base;
  const elapsed = Math.min(MAX_INTERPOLATE_MS, Math.max(0, nowMs - payloadAtMs));
  return Math.min(1, base + elapsed / windowRealMs);
}

/** Window fraction of an ISO instant inside the night window. */
export function fractionOf(iso: string, windowStart: string, windowEnd: string): number {
  const start = Date.parse(windowStart);
  const span = Date.parse(windowEnd) - start;
  if (!(span > 0)) return 0;
  return (Date.parse(iso) - start) / span;
}

/** Real milliseconds until `at`, given the current progress. Never negative. */
export function msUntil(
  at: string,
  night: { windowStart: string; windowEnd: string },
  progress: number,
  windowRealMs: number
): number {
  return Math.max(
    0,
    (fractionOf(at, night.windowStart, night.windowEnd) - progress) * windowRealMs
  );
}

/** "4:07" or "1:02:09" from milliseconds. */
export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// ---- view model ----

export interface NightCandidateView {
  id: string;
  name: string;
  color: string;
  /** Electoral votes from called states. */
  ev: number;
  votes: number;
  sharePct: number;
}

export interface NightFeedItem {
  key: string;
  kind: "polls_close" | "call";
  /** Eastern clock label for when it happened. */
  clock: string;
  text: string;
  color?: string;
}

export interface NightKeyRace {
  id: string;
  name: string;
  ev: number;
  reportingPct: number;
  status: "too_close" | "leaning";
  /** Counted lead in points, shown only for states with numbers. */
  marginPct: number;
  leaderName: string;
  leaderColor: string;
}

export interface NightNextClose {
  at: string;
  label: string;
  stateIds: string[];
  stateNames: string[];
}

export interface NightView {
  /** The night is over: every state called and 100% reporting. */
  settled: boolean;
  totalEv: number;
  evNeeded: number;
  candidates: NightCandidateView[];
  statesCalled: number;
  totalStates: number;
  statesPollsClosed: number;
  /** EV weighted reporting across states, 0..100. */
  reportingPct: number;
  /** Candidate with a majority of called electoral votes, once there is one. */
  winnerId: string | null;
  /** Settled with nobody at the majority. */
  noMajority: boolean;
  nextClose: NightNextClose | null;
  keyRaces: NightKeyRace[];
}

export function candidateColor(c: Pick<ResultsCandidate, "partyColor"> | undefined): string {
  return c?.partyColor || FALLBACK_COLOR;
}

/** Whether the payload is an in-window election night for a US president race. */
export function hasNight(data: ElectionResultsResponse | null | undefined): boolean {
  return (
    data != null &&
    data.election.electionType === "president" &&
    data.election.countryId === "US" &&
    data.election.night != null
  );
}

/**
 * Whether a presidential detail page should start watching for the election
 * night: a US general-election race inside its last turn interval or later.
 * The results payload decides whether the night is actually on.
 */
export function isNightWindow(election: {
  countryId: string;
  electionType: string;
  isUpcoming: boolean;
  inPrimary: boolean;
  isEnded: boolean;
  endTurn: number | null;
  gameState: { currentTurn?: number | null } | null;
}): boolean {
  if (election.countryId !== "US" || election.electionType !== "president") return false;
  if (election.isUpcoming || election.inPrimary || election.isEnded) return false;
  const turn = election.gameState?.currentTurn;
  if (election.endTurn == null || turn == null) return false;
  return election.endTurn - turn <= 1;
}

export function isResolvedStatus(status: string): boolean {
  return ENDED.has(status);
}

function unitName(units: ResultsUnit[], id: string): string {
  return units.find((u) => u.id === id)?.name ?? id;
}

export function buildNightView(data: ElectionResultsResponse): NightView {
  const { election, candidates, units } = data;
  const night = election.night ?? null;
  const settled = night == null;
  const totalEv = night?.totalEv ?? election.totalEv ?? units.reduce((s, u) => s + u.weight, 0);
  const evNeeded = night?.evNeeded ?? election.evNeeded ?? Math.floor(totalEv / 2) + 1;

  const views: NightCandidateView[] = candidates
    .map((c) => ({
      id: c.id,
      name: c.name,
      color: candidateColor(c),
      ev: night ? (night.calledEv[c.id] ?? 0) : (c.electoralVotes ?? 0),
      votes: c.totalVotes,
      sharePct: c.voteSharePct,
    }))
    .sort((a, b) => b.ev - a.ev || b.votes - a.votes || a.name.localeCompare(b.name));

  const weightSum = units.reduce((s, u) => s + u.weight, 0);
  const reportingPct =
    settled && units.length > 0
      ? 100
      : weightSum > 0
        ? units.reduce((s, u) => s + u.reportingPct * u.weight, 0) / weightSum
        : 0;

  const top = views[0];
  const winnerId =
    top && top.ev >= evNeeded && evNeeded > 0 ? top.id : (data.summary.projectedWinner ?? null);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const keyRaces: NightKeyRace[] = units
    .filter((u) => {
      const status = unitNightStatus(u);
      if (u.called || status === "called") return false;
      if (status === "too_close") return true;
      return status === "leaning" && u.leaderMarginPct < KEY_RACE_MARGIN_PP;
    })
    .map((u) => {
      const status = unitNightStatus(u) === "too_close" ? "too_close" : "leaning";
      const leader = u.leaderId ? byId.get(u.leaderId) : undefined;
      return {
        id: u.id,
        name: u.name,
        ev: u.weight,
        reportingPct: u.reportingPct,
        status: status as "too_close" | "leaning",
        marginPct: u.leaderMarginPct,
        leaderName: leader?.name ?? "",
        leaderColor: candidateColor(leader),
      };
    })
    .sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "too_close" ? -1 : 1) ||
        b.ev - a.ev ||
        a.marginPct - b.marginPct
    )
    .slice(0, KEY_RACES_MAX);

  const nextClose: NightNextClose | null = night?.nextClose
    ? {
        at: night.nextClose.at,
        label: pollCloseLabel(night.nextClose.stateIds[0] ?? ""),
        stateIds: night.nextClose.stateIds,
        stateNames: night.nextClose.stateIds.map((id) => unitName(units, id)),
      }
    : null;

  return {
    settled,
    totalEv,
    evNeeded,
    candidates: views,
    statesCalled: night?.statesCalled ?? units.filter((u) => u.called).length,
    totalStates: night?.totalStates ?? units.length,
    statesPollsClosed: night?.statesPollsClosed ?? units.length,
    reportingPct: Math.round(reportingPct * 10) / 10,
    winnerId,
    noMajority: settled && winnerId == null && units.length > 0,
    nextClose,
    keyRaces,
  };
}

// ---- feed ----

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Feed rows, newest first. Poll closings that share a scheduled hour fold into
 * one row ("Polls closed in A, B and C"); each call is its own row.
 */
export function buildNightFeed(data: ElectionResultsResponse): NightFeedItem[] {
  const night = data.election.night;
  if (!night) return [];
  const { units, candidates } = data;
  const cand = new Map(candidates.map((c) => [c.id, c]));
  const clockOf = (iso: string) =>
    formatEtClock(nightClockHour(fractionOf(iso, night.windowStart, night.windowEnd)));

  const items: NightFeedItem[] = [];
  const closeGroups = new Map<number, { at: string; ids: string[] }>();
  for (const e of night.feed) {
    if (e.kind === "polls_close") {
      const hour = pollCloseEtHour(e.stateId);
      const g = closeGroups.get(hour);
      if (g) g.ids.push(e.stateId);
      else closeGroups.set(hour, { at: e.at, ids: [e.stateId] });
    } else {
      const c = e.candidateId ? cand.get(e.candidateId) : undefined;
      const st = units.find((u) => u.id === e.stateId);
      items.push({
        key: `call:${e.stateId}`,
        kind: "call",
        clock: clockOf(e.at),
        text: `Projected: ${c?.name ?? "Unknown"} wins ${st?.name ?? e.stateId}${st ? ` (${st.weight} EV)` : ""}`,
        color: candidateColor(c),
      });
    }
  }
  for (const [hour, g] of closeGroups) {
    items.push({
      key: `close:${hour}`,
      kind: "polls_close",
      clock: formatEtClock(hour),
      text: `Polls closed in ${joinNames(g.ids.map((id) => unitName(units, id)))}`,
    });
  }
  // Sort by true event time (the poll-close row uses its first state's instant).
  const atOf = new Map<string, number>();
  for (const e of night.feed) {
    const key = e.kind === "call" ? `call:${e.stateId}` : `close:${pollCloseEtHour(e.stateId)}`;
    if (!atOf.has(key)) atOf.set(key, Date.parse(e.at));
  }
  return items.sort((a, b) => (atOf.get(b.key) ?? 0) - (atOf.get(a.key) ?? 0));
}

// ---- call alerts ----

export interface CallAlert {
  key: string;
  stateId: string;
  stateName: string;
  candidateId: string;
  candidateName: string;
  color: string;
  ev: number;
}

export const ALERT_MS = 5_000;
/** Calls waiting behind the one on screen; older ones are dropped, not replayed late. */
export const ALERT_QUEUE_MAX = 4;

export interface AlertState {
  /** False until the first feed has been absorbed. */
  initialised: boolean;
  seen: string[];
  active: CallAlert | null;
  queue: CallAlert[];
}

export const EMPTY_ALERTS: AlertState = { initialised: false, seen: [], active: null, queue: [] };

/** One alert per call event in the feed, in feed order. */
export function callAlertsFrom(
  data: ElectionResultsResponse,
  feed: PresidentialNightEvent[] | undefined
): CallAlert[] {
  if (!feed) return [];
  const cand = new Map(data.candidates.map((c) => [c.id, c]));
  const out: CallAlert[] = [];
  for (const e of feed) {
    if (e.kind !== "call" || !e.candidateId) continue;
    const st = data.units.find((u) => u.id === e.stateId);
    const c = cand.get(e.candidateId);
    out.push({
      key: `call:${e.stateId}`,
      stateId: e.stateId,
      stateName: st?.name ?? e.stateId,
      candidateId: e.candidateId,
      candidateName: c?.name ?? "Unknown",
      color: candidateColor(c),
      ev: st?.weight ?? 0,
    });
  }
  return out;
}

/**
 * Fold a poll's calls into the alert state. Each call alerts once. The first
 * feed a viewer receives (page load, or joining mid-night) only marks the calls
 * already made as seen, so a late joiner is not handed a burst of stale alerts.
 */
export function ingestCalls(prev: AlertState, calls: CallAlert[]): AlertState {
  if (!prev.initialised) {
    return { initialised: true, seen: calls.map((c) => c.key), active: null, queue: [] };
  }
  const seen = new Set(prev.seen);
  const fresh = calls.filter((c) => !seen.has(c.key));
  if (fresh.length === 0) return prev;
  const nextSeen = [...prev.seen, ...fresh.map((c) => c.key)];
  const waiting = [...prev.queue, ...fresh].slice(-ALERT_QUEUE_MAX);
  if (prev.active) return { ...prev, seen: nextSeen, queue: waiting };
  const [active, ...queue] = waiting;
  return { initialised: true, seen: nextSeen, active: active ?? null, queue };
}

/** The alert on screen has run its course: show the next one, if any. */
export function expireAlert(prev: AlertState): AlertState {
  const [active, ...queue] = prev.queue;
  return { ...prev, active: active ?? null, queue };
}
