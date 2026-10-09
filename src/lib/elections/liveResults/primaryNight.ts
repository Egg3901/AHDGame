/**
 * Primary night: the live reveal of a presidential primary wave.
 *
 * A wave's states vote all at once when the turn runs it, and their final
 * numbers are in the tally from that moment. Primary night turns that into an
 * evening: for PRIMARY_NIGHT_HOURS after the wave, each state closes its polls
 * on its own (in real poll-closing order, spread across the first part of the
 * night), returns climb behind seeded noise that shrinks as reporting rises,
 * and a state is called once enough is in for its margin. After the night the
 * real result stands as it always did.
 *
 * Pure function of (race, party, state, final votes, wave time, now), so every
 * viewer and a late joiner see the same board. Display only: nothing here
 * feeds resolution, delegates or momentum. Callers MUST serve a state's real
 * numbers only once `isPrimaryStateSettled` is true; until then they serve
 * what this module reveals.
 */

import { hashFraction } from "./computeResults";
import {
  FIRST_CLOSE_ET_HOUR,
  LAST_CLOSE_ET_HOUR,
  pollCloseEtHour,
} from "@/lib/countries/us/data/usPollClosing";

/** How long a wave's night lasts, in real hours. */
export const PRIMARY_NIGHT_HOURS = 8;
export const PRIMARY_NIGHT_MS = PRIMARY_NIGHT_HOURS * 60 * 60 * 1000;
/** First and last poll closing, as fractions of the night. */
export const PRIMARY_NIGHT_FIRST_CLOSE = 0.04;
export const PRIMARY_NIGHT_LAST_CLOSE = 0.6;
/**
 * Each state closes on its own, not in hourly batches: states sharing a real
 * closing hour are spread across this share of the gap to the next hour.
 */
export const PRIMARY_NIGHT_SAME_HOUR_SPREAD = 0.8;
/** Fraction of the night a state takes from closing to full reporting. */
export const PRIMARY_NIGHT_RAMP = 0.38;
/** Reporting never reads 100% inside the night; the final count lands when it ends. */
export const PRIMARY_NIGHT_REPORTING_CAP = 0.99;
/** Below this reporting % a state shows nothing but "counting". */
export const PRIMARY_NIGHT_COUNTING_FLOOR = 1;
/** Below this reporting % no leader is shown. */
export const PRIMARY_NIGHT_LEADER_FLOOR = 8;
/** Largest seeded noise on a displayed share (fraction) at 0% reporting. */
export const PRIMARY_NIGHT_NOISE_MAX = 0.08;

const REPORTING_CURVE_EXPONENT = 2.2;

export type PrimaryNightStatus =
  "polls_open" | "counting" | "too_early" | "leaning" | "called" | "final";

export interface PrimaryNightState {
  status: PrimaryNightStatus;
  /** 0..100. 100 once the night is over. */
  reportingPct: number;
  called: boolean;
  /** Candidate the state was called for, once called. */
  calledFor: string | null;
  /** When this state's polls close (ISO). */
  closesAt: string;
  /** Votes revealed so far, candidateId → votes. Empty until a leader can be shown. */
  votes: Record<string, number>;
}

/** Fraction of full reporting after `x` (0..1) of the ramp. Concave: fast early returns. */
function reportingCurve(x: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), REPORTING_CURVE_EXPONENT);
}

function reportingCurveInverse(p: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 1 / REPORTING_CURVE_EXPONENT);
}

/** When a state's polls close inside the night, as a fraction of the night. */
export function primaryNightCloseFraction(
  electionId: string,
  stateId: string,
  waveStates: readonly string[]
): number {
  const span = LAST_CLOSE_ET_HOUR - FIRST_CLOSE_ET_HOUR || 1;
  const perHour = (PRIMARY_NIGHT_LAST_CLOSE - PRIMARY_NIGHT_FIRST_CLOSE) / span;
  const hour = pollCloseEtHour(stateId);
  // States closing in the same real hour each get their own slot within it, in
  // a seeded order, so a big wave reads as a run of separate closings.
  const sameHour = waveStates
    .filter((s) => pollCloseEtHour(s) === hour)
    .sort(
      (a, b) =>
        hashFraction(`${electionId}:${a}:pn-order`) - hashFraction(`${electionId}:${b}:pn-order`) ||
        a.localeCompare(b)
    );
  const slot = Math.max(0, sameHour.indexOf(stateId));
  const offset =
    sameHour.length > 1 ? (slot / sameHour.length) * PRIMARY_NIGHT_SAME_HOUR_SPREAD : 0;
  // A single-hour wave (one state, or every state in one time zone) still opens
  // with a short lead-in rather than closing the instant the night starts.
  return PRIMARY_NIGHT_FIRST_CLOSE + (hour - FIRST_CLOSE_ET_HOUR + offset * 0.5) * perHour;
}

/**
 * Reporting % at which a state is called, by its final margin in points:
 * a blowout is called early, a close race waits for most of the count.
 */
export function primaryCallFloor(marginPp: number): number {
  return Math.min(95, Math.max(12, 95 - 4 * marginPp));
}

/** Smooth seeded noise in [-1, 1] that drifts slowly as `position` climbs. */
function smoothNoise(key: string, position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const a = hashFraction(`${key}:${i}`) * 2 - 1;
  const b = hashFraction(`${key}:${i + 1}`) * 2 - 1;
  return a + (b - a) * t;
}

export interface PrimaryNightInput {
  electionId: string;
  partyId: string;
  stateId: string;
  /** Every state in the wave, for ordering same-hour closings. */
  waveStates: readonly string[];
  /** The state's final primary votes, candidateId → votes. */
  finalVotes: Readonly<Record<string, number>>;
  /** When the wave ran (ms epoch): the start of its night. */
  waveAtMs: number;
  nowMs: number;
}

/** The state as primary night shows it at `nowMs`. */
export function primaryNightState(input: PrimaryNightInput): PrimaryNightState {
  const { electionId, partyId, stateId, finalVotes, waveAtMs, nowMs } = input;
  const closeMs =
    waveAtMs + primaryNightCloseFraction(electionId, stateId, input.waveStates) * PRIMARY_NIGHT_MS;
  const closesAt = new Date(closeMs).toISOString();
  const ranked = Object.entries(finalVotes)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const leader = ranked[0]?.[0] ?? null;

  if (nowMs >= waveAtMs + PRIMARY_NIGHT_MS) {
    return {
      status: "final",
      reportingPct: 100,
      called: leader != null,
      calledFor: leader,
      closesAt,
      votes: { ...finalVotes },
    };
  }

  const key = `${electionId}:${partyId}:${stateId}`;
  const rampMs =
    PRIMARY_NIGHT_RAMP * (0.85 + hashFraction(`${key}:pn-ramp`) * 0.3) * PRIMARY_NIGHT_MS;
  const q =
    nowMs < closeMs ? 0 : PRIMARY_NIGHT_REPORTING_CAP * reportingCurve((nowMs - closeMs) / rampMs);
  const reportingPct = Math.round(q * 1000) / 10;

  const marginPp =
    total > 0 && ranked.length > 1 ? ((ranked[0][1] - ranked[1][1]) / total) * 100 : 100;
  const callFloor = primaryCallFloor(marginPp);
  const called = leader != null && reportingPct >= callFloor;

  let status: PrimaryNightStatus;
  if (nowMs < closeMs) status = "polls_open";
  else if (reportingPct < PRIMARY_NIGHT_COUNTING_FLOOR || total <= 0) status = "counting";
  else if (reportingPct < PRIMARY_NIGHT_LEADER_FLOOR) status = "too_early";
  else if (called) status = "called";
  else status = "leaning";

  const votes: Record<string, number> = {};
  if (status === "leaning" || status === "called") {
    // Real shares plus seeded noise that shrinks to nothing at full reporting.
    // A called state's noise is bounded so its leader cannot flip on screen.
    let amp = PRIMARY_NIGHT_NOISE_MAX * Math.pow(1 - q, 2);
    if (called) amp = Math.min(amp, marginPp / 100 / 4);
    const shares: Record<string, number> = {};
    let sum = 0;
    for (const [cid, v] of ranked) {
      const share = Math.max(0.001, v / total + smoothNoise(`${key}:${cid}`, q * 20) * amp);
      shares[cid] = share;
      sum += share;
    }
    const counted = total * q;
    for (const [cid] of ranked) votes[cid] = Math.round((shares[cid] / sum) * counted);
  }

  return {
    status,
    reportingPct,
    called,
    calledFor: called ? leader : null,
    closesAt,
    votes,
  };
}

/** Whether the real result may be shown: the night is over, or the state is called. */
export function isPrimaryStateSettled(state: PrimaryNightState): boolean {
  return state.status === "final" || state.status === "called";
}

/** When the call lands for a state (ms epoch), or null when it is only called at the end. */
export function primaryCallAtMs(input: Omit<PrimaryNightInput, "nowMs">): number | null {
  const ranked = Object.values(input.finalVotes)
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  const total = ranked.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const marginPp = ranked.length > 1 ? ((ranked[0] - ranked[1]) / total) * 100 : 100;
  const floor = primaryCallFloor(marginPp) / 100;
  const closeMs =
    input.waveAtMs +
    primaryNightCloseFraction(input.electionId, input.stateId, input.waveStates) * PRIMARY_NIGHT_MS;
  const rampMs =
    PRIMARY_NIGHT_RAMP *
    (0.85 + hashFraction(`${input.electionId}:${input.partyId}:${input.stateId}:pn-ramp`) * 0.3) *
    PRIMARY_NIGHT_MS;
  const at = closeMs + reportingCurveInverse(floor / PRIMARY_NIGHT_REPORTING_CAP) * rampMs;
  return at < input.waveAtMs + PRIMARY_NIGHT_MS ? at : null;
}

/** Wave history as the tally stores it. */
export interface PrimaryWaveRecord {
  statesVoted: readonly string[];
  recordedAt: Date | string;
}

/**
 * Every state whose wave night is still running at `nowMs`, with its wave's
 * start and states. A state voting in a later wave replaces an earlier entry.
 */
export function activePrimaryNights(
  waves: readonly PrimaryWaveRecord[] | undefined,
  nowMs: number
): Map<string, { waveAtMs: number; waveStates: readonly string[] }> {
  const out = new Map<string, { waveAtMs: number; waveStates: readonly string[] }>();
  for (const wave of waves ?? []) {
    const at = new Date(wave.recordedAt).getTime();
    if (!Number.isFinite(at) || nowMs >= at + PRIMARY_NIGHT_MS || nowMs < at) continue;
    for (const stateId of wave.statesVoted) {
      out.set(stateId, { waveAtMs: at, waveStates: wave.statesVoted });
    }
  }
  return out;
}

/**
 * For one party: the night view of every state still in an active night, and
 * the states whose real result must stay hidden (not yet called).
 */
export function primaryNightForParty(args: {
  electionId: string;
  partyId: string;
  waves: readonly PrimaryWaveRecord[] | undefined;
  /** stateId → candidateId → final votes, for this party. */
  stateVotes: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
  nowMs: number;
}): { byState: Record<string, PrimaryNightState>; hidden: Set<string> } {
  const byState: Record<string, PrimaryNightState> = {};
  const hidden = new Set<string>();
  for (const [stateId, night] of activePrimaryNights(args.waves, args.nowMs)) {
    const view = primaryNightState({
      electionId: args.electionId,
      partyId: args.partyId,
      stateId,
      waveStates: night.waveStates,
      finalVotes: args.stateVotes?.[stateId] ?? {},
      waveAtMs: night.waveAtMs,
      nowMs: args.nowMs,
    });
    byState[stateId] = view;
    if (!isPrimaryStateSettled(view)) hidden.add(stateId);
  }
  return { byState, hidden };
}
