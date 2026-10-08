/**
 * Election-night broadcast model for US presidential races.
 *
 * Pure function of (election id, tally, schedule, now): every viewer, and a
 * late joiner, sees the same board. During the final-hour window states close
 * their polls in real-world order, returns climb behind a fog of seeded noise
 * that shrinks as reporting rises, and a state is only CALLED once the
 * remaining final turn provably cannot flip it.
 *
 * Display-only: none of this feeds resolution. The tally here is the real
 * cumulative tally as of the penultimate turn; the final turn is not counted
 * inside the window, and once the race resolves the route serves the real
 * final result exactly (every state called, 100% reporting).
 */

import {
  ELECTION_DAY_TURNS,
  resolveTurnWindow,
  turnVoteWeight,
} from "@/lib/electionEngine/voteCalculations";
import { hashFraction } from "./computeResults";
import {
  FIRST_CLOSE_ET_HOUR,
  LAST_CLOSE_ET_HOUR,
  pollCloseEtHour,
} from "@/lib/countries/us/data/usPollClosing";
import type {
  PresidentialNight,
  PresidentialNightEvent,
  PresidentialNightStatus,
  ResultsUnit,
  ResultsUnitCandidate,
} from "./types";

/** Window fraction of the first poll closing (short lead-in with polls open). */
export const NIGHT_FIRST_CLOSE_FRACTION = 0.06;
/** Window fraction of the last poll closing (room left so late states can count). */
export const NIGHT_LAST_CLOSE_FRACTION = 0.7;
/** Max +/- jitter on a close time, in window fraction. Smaller than half the closest batch gap. */
export const NIGHT_CLOSE_JITTER = 0.008;
/** Window fraction a state needs after closing to reach its reporting cap. */
export const NIGHT_RAMP_FRACTION = 0.24;
/** Per-state reporting cap range (percent). Never 100 inside the window. */
export const NIGHT_REPORTING_CAP_MIN = 90;
export const NIGHT_REPORTING_CAP_MAX = 97;

/** Below this reporting % nothing is shown but "counting". */
export const NIGHT_COUNTING_FLOOR = 1;
/** Below this reporting % no leader is shown (too early). */
export const NIGHT_LEADER_FLOOR = 8;
/** A state this close (counted margin, fraction of counted vote) is "too close" once well reported. */
export const NIGHT_TOO_CLOSE_BAND = 0.03;
export const NIGHT_TOO_CLOSE_REPORTING = 50;
/** Reporting needed before a call: loosest for blowouts, tightest at the call threshold. */
export const NIGHT_CALL_REPORTING_MIN = 25;
export const NIGHT_CALL_REPORTING_MAX = 75;
/** Largest seeded noise on a displayed candidate share (fraction) at 0% reporting. */
export const NIGHT_NOISE_MAX = 0.08;
/**
 * Cushion on the worst-case final-turn swing. The engine's per-state turn pool
 * is share-invariant but registered-voter and turnout ceilings can reshape a
 * single turn's size, so the call test demands a little more than the bare
 * ratio.
 */
export const NIGHT_CALL_SAFETY = 1.05;

const REPORTING_CURVE_EXPONENT = 2.2;

/**
 * Worst-case size of the uncounted final turn relative to the vote already
 * counted at the penultimate turn, derived from the real vote weighting.
 * `totalTurns` is the general-election window the engine uses (inclusive of
 * the final turn). Example: a 12+ turn window gives
 * (0.3 / 4) / (1 - 0.3 / 4) ~= 0.081 of the counted vote.
 */
/** Maine and Nebraska congressional-district units ("ME_CD1"). */
function isDistrictUnit(unitId: string): boolean {
  return /_CD\d$/.test(unitId);
}

export function finalTurnVoteRatio(totalTurns: number): number {
  const turns = Math.max(1, Math.floor(totalTurns));
  const last = turnVoteWeight(turns, turns - 1, 1);
  let counted = 0;
  for (let i = 0; i < turns - 1; i++) counted += turnVoteWeight(turns, i, 1);
  // A single-turn window has nothing counted yet: no call can be safe.
  if (counted <= 0) return Number.POSITIVE_INFINITY;
  return last / counted;
}

/** Resolve the engine's general-election window for a presidential race and price its last turn. */
export function finalTurnVoteRatioForElection(election: {
  startTurn?: number | null;
  primaryEndTurn?: number | null;
  endTurn?: number | null;
}): number {
  const start = election.primaryEndTurn ?? election.startTurn;
  if (typeof start !== "number" || typeof election.endTurn !== "number") {
    // Legacy doc with no turn bounds: assume the shortest window the engine
    // allows, which makes the last turn as large as it can be.
    return finalTurnVoteRatio(ELECTION_DAY_TURNS);
  }
  const { totalTurns } = resolveTurnWindow({
    startTurn: start,
    endTurn: election.endTurn,
    currentTurn: election.endTurn,
    now: new Date(0),
    inclusiveEnd: true,
  });
  return finalTurnVoteRatio(totalTurns);
}

export interface NightUnitInput {
  unitId: string;
  name: string;
  /** EV weight. */
  weight: number;
  /** candidateId -> cumulative real votes as of the penultimate turn. */
  votes: Record<string, number>;
}

export interface PresidentialNightInput {
  electionId: string;
  units: NightUnitInput[];
  totalEv: number;
  evNeeded: number;
  /** Final-hour window start and length (ms epoch / ms). */
  windowStartMs: number;
  windowMs: number;
  nowMs: number;
  /** Worst-case final-turn vote as a fraction of the counted vote. */
  finalTurnRatio: number;
}

export interface UnitSchedule {
  unitId: string;
  closeMs: number;
  rampMs: number;
  /** Reporting cap, percent. */
  cap: number;
}

/** Fraction of the cap reached after `x` (0..1) of the ramp. Concave: fast early returns. */
function reportingCurve(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), REPORTING_CURVE_EXPONENT);
}

function reportingCurveInverse(p: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 1 / REPORTING_CURVE_EXPONENT);
}

/** Close time, ramp and cap for one unit. Order follows the real closing order. */
export function unitSchedule(
  electionId: string,
  unitId: string,
  windowStartMs: number,
  windowMs: number
): UnitSchedule {
  const hour = pollCloseEtHour(unitId);
  const span = LAST_CLOSE_ET_HOUR - FIRST_CLOSE_ET_HOUR || 1;
  const base =
    NIGHT_FIRST_CLOSE_FRACTION +
    ((hour - FIRST_CLOSE_ET_HOUR) / span) *
      (NIGHT_LAST_CLOSE_FRACTION - NIGHT_FIRST_CLOSE_FRACTION);
  const jitter = (hashFraction(`${electionId}:${unitId}:close`) * 2 - 1) * NIGHT_CLOSE_JITTER;
  const speed = 0.85 + hashFraction(`${electionId}:${unitId}:ramp`) * 0.3;
  const cap =
    NIGHT_REPORTING_CAP_MIN +
    hashFraction(`${electionId}:${unitId}:cap`) *
      (NIGHT_REPORTING_CAP_MAX - NIGHT_REPORTING_CAP_MIN);
  return {
    unitId,
    closeMs: Math.round(windowStartMs + (base + jitter) * windowMs),
    rampMs: NIGHT_RAMP_FRACTION * speed * windowMs,
    cap,
  };
}

/** Raw (unrounded) reporting % at `nowMs`. 0 before the close, capped below 100 after. */
export function reportingAt(schedule: UnitSchedule, nowMs: number): number {
  if (nowMs < schedule.closeMs) return 0;
  return schedule.cap * reportingCurve((nowMs - schedule.closeMs) / schedule.rampMs);
}

interface Standing {
  leaderId: string;
  runnerUpId: string | null;
  total: number;
  /** (leader - runnerUp) / total, 0..1. */
  margin: number;
}

function standing(votes: Record<string, number>): Standing | null {
  const entries = Object.entries(votes)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;
  const [leaderId, leaderVotes] = entries[0];
  const runnerUp = entries[1];
  return {
    leaderId,
    runnerUpId: runnerUp ? runnerUp[0] : null,
    total,
    margin: (leaderVotes - (runnerUp ? runnerUp[1] : 0)) / total,
  };
}

/**
 * Whether the counted lead survives the worst-case final turn (every
 * remaining vote to the runner-up), and the reporting % at which the call is
 * made. Null when the state can never be called inside the window.
 */
export function callPlan(
  s: Standing | null,
  finalTurnRatio: number
): { reportingFloor: number } | null {
  if (!s) return null;
  const needed = finalTurnRatio * NIGHT_CALL_SAFETY;
  if (!Number.isFinite(needed) || s.margin <= needed) return null;
  // Bigger cushions call sooner; a state barely clearing the bar waits longest.
  const cushion = s.margin / needed;
  const floor = NIGHT_CALL_REPORTING_MAX - 10 * (cushion - 1);
  return {
    reportingFloor: Math.min(NIGHT_CALL_REPORTING_MAX, Math.max(NIGHT_CALL_REPORTING_MIN, floor)),
  };
}

function callAtMs(schedule: UnitSchedule, reportingFloor: number): number {
  const x = reportingCurveInverse(reportingFloor / schedule.cap);
  return schedule.closeMs + x * schedule.rampMs;
}

/** Smooth seeded noise in [-1, 1] that drifts slowly as `position` climbs. */
function smoothNoise(key: string, position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const a = hashFraction(`${key}:${i}`) * 2 - 1;
  const b = hashFraction(`${key}:${i + 1}`) * 2 - 1;
  return a + (b - a) * t;
}

/**
 * Displayed vote shares: the real shares plus seeded noise that shrinks to
 * exactly zero at the reporting cap. A called state's noise is bounded so its
 * displayed leader can never contradict the call.
 */
function displayedShares(
  electionId: string,
  unitId: string,
  votes: Record<string, number>,
  total: number,
  q: number,
  called: boolean,
  margin: number
): Record<string, number> {
  const shares: Record<string, number> = {};
  let amp = NIGHT_NOISE_MAX * Math.pow(1 - Math.min(1, q), 2);
  if (called) amp = Math.min(amp, margin / 4);
  let sum = 0;
  for (const [cid, v] of Object.entries(votes)) {
    if (v <= 0) continue;
    const noise = smoothNoise(`${electionId}:${unitId}:${cid}`, q * 20) * amp;
    const share = Math.max(0.001, v / total + noise);
    shares[cid] = share;
    sum += share;
  }
  for (const cid of Object.keys(shares)) shares[cid] /= sum;
  return shares;
}

export interface PresidentialNightResult {
  units: ResultsUnit[];
  night: PresidentialNight;
}

/** Compute the whole board and the national broadcast summary at `nowMs`. */
export function computePresidentialNight(input: PresidentialNightInput): PresidentialNightResult {
  const { electionId, windowStartMs, windowMs, nowMs, finalTurnRatio } = input;

  interface Row {
    unit: NightUnitInput;
    schedule: UnitSchedule;
    standing: Standing | null;
    plan: { reportingFloor: number } | null;
    callMs: number | null;
  }
  const rows: Row[] = input.units.map((unit) => {
    const schedule = unitSchedule(electionId, unit.unitId, windowStartMs, windowMs);
    const st = standing(unit.votes);
    const plan = callPlan(st, finalTurnRatio);
    return {
      unit,
      schedule,
      standing: st,
      plan,
      callMs: plan ? callAtMs(schedule, plan.reportingFloor) : null,
    };
  });

  const calledEv: Record<string, number> = {};
  const units: ResultsUnit[] = rows.map((row) => {
    const { unit, schedule, standing: st } = row;
    const rawReporting = reportingAt(schedule, nowMs);
    const q = rawReporting / schedule.cap;
    const called = row.callMs != null && st != null && nowMs >= row.callMs;

    let status: PresidentialNightStatus;
    if (nowMs < schedule.closeMs) status = "polls_open";
    else if (rawReporting < NIGHT_COUNTING_FLOOR || !st) status = "counting";
    else if (rawReporting < NIGHT_LEADER_FLOOR) status = "too_early";
    else if (called) status = "called";
    else if (st.margin < NIGHT_TOO_CLOSE_BAND && rawReporting >= NIGHT_TOO_CLOSE_REPORTING)
      status = "too_close";
    else status = "leaning";

    const showNumbers =
      st != null && status !== "polls_open" && status !== "counting" && status !== "too_early";
    let candidates: ResultsUnitCandidate[] = [];
    let totalVotes = 0;
    let leaderId: string | undefined;
    let leaderMargin = 0;
    let leaderMarginPct = 0;
    if (showNumbers && st) {
      const shares = displayedShares(
        electionId,
        unit.unitId,
        unit.votes,
        st.total,
        q,
        called,
        st.margin
      );
      // Reveal the real tally progressively: all of it at the reporting cap.
      totalVotes = Math.round(st.total * Math.min(1, q));
      candidates = Object.entries(shares)
        .map(([candidateId, share]) => ({
          candidateId,
          votes: Math.round(share * totalVotes),
          voteShare: share * 100,
        }))
        .sort((a, b) => b.voteShare - a.voteShare || a.candidateId.localeCompare(b.candidateId));
      leaderId = candidates[0]?.candidateId;
      const second = candidates[1];
      leaderMargin = (candidates[0]?.votes ?? 0) - (second?.votes ?? 0);
      leaderMarginPct = (candidates[0]?.voteShare ?? 0) - (second?.voteShare ?? 0);
    }

    if (called && st) calledEv[st.leaderId] = (calledEv[st.leaderId] ?? 0) + unit.weight;

    return {
      id: unit.unitId,
      name: unit.name,
      weight: unit.weight,
      totalVotes,
      reportingPct: Math.round(rawReporting * 10) / 10,
      called,
      calledFor: called && st ? st.leaderId : undefined,
      leaderId,
      tied: false,
      leaderMargin,
      leaderMarginPct,
      candidates,
      pollsCloseAt: new Date(schedule.closeMs).toISOString(),
      nightStatus: status,
    };
  });

  // Feed: derived from the schedule, so a late joiner sees identical history.
  const events: { atMs: number; event: PresidentialNightEvent }[] = [];
  for (const row of rows) {
    if (row.schedule.closeMs <= nowMs) {
      events.push({
        atMs: row.schedule.closeMs,
        event: {
          at: new Date(row.schedule.closeMs).toISOString(),
          stateId: row.unit.unitId,
          kind: "polls_close",
        },
      });
    }
    if (row.callMs != null && row.standing && row.callMs <= nowMs) {
      events.push({
        atMs: row.callMs,
        event: {
          at: new Date(row.callMs).toISOString(),
          stateId: row.unit.unitId,
          candidateId: row.standing.leaderId,
          kind: "call",
        },
      });
    }
  }
  const kindOrder = { polls_close: 0, call: 1 } as const;
  events.sort(
    (a, b) =>
      a.atMs - b.atMs ||
      kindOrder[a.event.kind] - kindOrder[b.event.kind] ||
      a.event.stateId.localeCompare(b.event.stateId)
  );

  // Next closing batch: the next not-yet-closed clock time and its states.
  const upcoming = rows
    .filter((r) => r.schedule.closeMs > nowMs)
    .sort((a, b) => a.schedule.closeMs - b.schedule.closeMs);
  let nextClose: PresidentialNight["nextClose"] = null;
  if (upcoming.length > 0) {
    const hour = pollCloseEtHour(upcoming[0].unit.unitId);
    const batch = upcoming.filter((r) => pollCloseEtHour(r.unit.unitId) === hour);
    nextClose = {
      at: new Date(batch[0].schedule.closeMs).toISOString(),
      stateIds: batch.map((r) => r.unit.unitId),
    };
  }

  return {
    units,
    night: {
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: new Date(windowStartMs + windowMs).toISOString(),
      totalEv: input.totalEv,
      evNeeded: input.evNeeded,
      calledEv,
      // Counted like a news desk: 50 states and DC. Maine and Nebraska
      // district units still carry their EVs above but are not extra states.
      statesCalled: units.filter((u) => u.called && !isDistrictUnit(u.id)).length,
      totalStates: units.filter((u) => !isDistrictUnit(u.id)).length,
      statesPollsClosed: rows.filter(
        (r) => r.schedule.closeMs <= nowMs && !isDistrictUnit(r.unit.unitId)
      ).length,
      nextClose,
      feed: events.map((e) => e.event),
    },
  };
}
