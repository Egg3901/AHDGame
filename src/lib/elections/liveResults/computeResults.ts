/**
 * Pure computation for the live election results page.
 *
 * Everything here is deterministic on its inputs (including `now`), so the
 * API can compute a drip-fed "election night" reveal that is identical for
 * every viewer, and tests can pin exact behavior.
 *
 * Display-only: none of this feeds election resolution. A unit being
 * "called" here is a UI projection; the turn engine remains the sole
 * authority on outcomes.
 */

import type { NationalParty, NationalProjection, ResultsUnit, ResultsUnitCandidate } from "./types";

/** Margin (percentage points) a leader needs before a reporting unit is called. */
export const CALL_MARGIN_PCT = 5;

/** Reporting % ceiling while the race is still mid-campaign (pre final hour). */
export const PRE_FINAL_REPORTING_CAP = 88;

/** Election types that get the Westminster majority / hung-parliament call. */
export const WESTMINSTER_STYLE_TYPES = new Set([
  "commons",
  "snap_commons",
  "holyrood",
  "senedd",
  "dail",
  "shugiin",
  "snap_shugiin",
  "sangiin",
  "bundestag",
  "landtag",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR)
  "assembleeNationale",
  "cameraDeputati",
  "congresoDiputados",
  "riksdag",
  "milletMeclisi",
]);

/**
 * Multi-region chamber types aggregated into a national seat projection by
 * summing sibling elections of the same type + cycle.
 */
export const NATIONAL_AGGREGATION_TYPES = new Set([
  "house",
  "commons",
  "snap_commons",
  "shugiin",
  "snap_shugiin",
  "sangiin",
  "npcDelegate",
  "peoplesCongress",
  "bundestag",
  "dail",
  // Beta-country parliamentary lower chambers (FR/IT/ES/SE/TR)
  "assembleeNationale",
  "cameraDeputati",
  "congresoDiputados",
  "riksdag",
  "milletMeclisi",
]);

export const CHAMBER_LABELS: Record<string, string> = {
  house: "House of Representatives",
  commons: "House of Commons",
  snap_commons: "House of Commons",
  holyrood: "Scottish Parliament",
  senedd: "Senedd",
  dail: "Dáil Éireann",
  shugiin: "Shūgiin",
  snap_shugiin: "Shūgiin",
  sangiin: "Sangiin",
  bundestag: "Bundestag",
  landtag: "Landtag",
  npcDelegate: "National People's Congress",
  peoplesCongress: "People's Congress",
  regionalCouncil: "Regional Council",
  stateSenate: "State Senate",
  assembleeNationale: "National Assembly",
  cameraDeputati: "Chamber of Deputies",
  congresoDiputados: "Congress of Deputies",
  riksdag: "Riksdag",
  milletMeclisi: "Grand National Assembly",
};

/** FNV-1a → 0..1. Stable across processes; drives per-unit reveal offsets. */
export function hashFraction(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Where in the final hour this unit reveals (0.06..0.94). Deterministic per
 * election+unit so all viewers watch the same states declare in the same
 * order, and the first/last few minutes always have something happening.
 */
export function unitRevealOffset(electionId: string, unitId: string): number {
  return 0.06 + hashFraction(`${electionId}:${unitId}`) * 0.88;
}

export interface FinalHourInput {
  status: string;
  currentTurn: number;
  endTurn: number | null | undefined;
  nextScheduledTurn: Date | null | undefined;
  pausedAt: Date | null | undefined;
  now: Date;
}

/**
 * The drip window: the wall-clock interval between the second-to-last and the
 * final turn of an active election. Returns the elapsed fraction (0..1) and
 * the scheduled resolution moment, or null outside the window (including when
 * the turn clock is paused — a frozen clock must not drip). `windowMs` is the
 * turn interval (30 min in fastMode).
 */
export function computeFinalHour(
  input: FinalHourInput,
  windowMs: number = 60 * 60 * 1000
): { progress: number; endsAt: Date } | null {
  const { status, currentTurn, endTurn, nextScheduledTurn, pausedAt, now } = input;
  if (status !== "active") return null;
  if (endTurn == null || nextScheduledTurn == null || pausedAt != null) return null;
  const turnsUntilEnd = endTurn - currentTurn;
  if (turnsUntilEnd > 1 || turnsUntilEnd < 0) return null;

  const endsAt = nextScheduledTurn;
  const msRemaining = endsAt.getTime() - now.getTime();
  const progress = Math.min(1, Math.max(0, 1 - msRemaining / windowMs));
  return { progress, endsAt };
}

export interface BaselineReportingInput {
  currentTurn: number;
  startTurn: number | null | undefined;
  endTurn: number | null | undefined;
  primaryEndTurn: number | null | undefined;
}

/**
 * Turn-based reporting estimate for an active election, capped below 100 so
 * the final hour always has counting left to dramatize. There is no stored
 * expected-turnout figure, so elapsed general-phase turns are the estimate.
 */
export function computeBaselineReportingPct(input: BaselineReportingInput): number {
  const { currentTurn, startTurn, endTurn, primaryEndTurn } = input;
  if (endTurn == null) return PRE_FINAL_REPORTING_CAP;
  const generalStart = primaryEndTurn ?? startTurn ?? endTurn;
  const span = endTurn - generalStart;
  if (span <= 0) return PRE_FINAL_REPORTING_CAP;
  const elapsed = Math.min(span, Math.max(0, currentTurn - generalStart));
  return Math.min(PRE_FINAL_REPORTING_CAP, Math.round((elapsed / span) * 100));
}

export interface ComputeUnitInput {
  electionId: string;
  unitId: string;
  name: string;
  weight: number;
  /** candidateId -> cumulative votes in this unit. */
  votes: Record<string, number>;
  isEnded: boolean;
  baselineReportingPct: number;
  /** null outside the final-hour window. */
  finalHourProgress: number | null;
}

/**
 * Shape one unit's row: leader, margin, reporting %, and the cosmetic
 * "called" projection.
 *
 * Call rules: while mid-campaign nothing is called (leads are shown, calls
 * wait for election night); during the final hour a unit is called once the
 * drip passes its reveal offset AND the margin clears CALL_MARGIN_PCT; when
 * the election has ended every decided unit is called. Ties are never called.
 */
export function computeUnitResult(input: ComputeUnitInput): ResultsUnit {
  const { electionId, unitId, name, weight, votes, isEnded, baselineReportingPct } = input;

  const entries = Object.entries(votes).filter(([, v]) => v > 0);
  const totalVotes = entries.reduce((sum, [, v]) => sum + v, 0);

  let leaderId = "";
  let leaderVotes = 0;
  let runnerUpVotes = 0;
  for (const [cid, v] of entries) {
    if (v > leaderVotes) {
      runnerUpVotes = leaderVotes;
      leaderVotes = v;
      leaderId = cid;
    } else if (v > runnerUpVotes) {
      runnerUpVotes = v;
    }
  }
  const tied = totalVotes > 0 && leaderVotes === runnerUpVotes;
  const leaderMargin = leaderVotes - runnerUpVotes;
  const leaderMarginPct = totalVotes > 0 ? (leaderMargin / totalVotes) * 100 : 0;

  const revealOffset = unitRevealOffset(electionId, unitId);
  const revealed =
    isEnded || (input.finalHourProgress != null && input.finalHourProgress >= revealOffset);

  let reportingPct: number;
  if (totalVotes === 0) {
    reportingPct = 0;
  } else if (isEnded || revealed) {
    reportingPct = 100;
  } else if (input.finalHourProgress != null) {
    // Ramp from the campaign baseline toward (not past) full as the unit's
    // reveal approaches. Monotonic in progress, so numbers only climb.
    const ramp = Math.min(1, input.finalHourProgress / revealOffset);
    reportingPct = Math.round(baselineReportingPct + (98 - baselineReportingPct) * ramp);
  } else {
    // Mid-campaign: baseline with a small stable per-unit jitter so the board
    // doesn't read as one uniform number.
    const jitter = 0.9 + hashFraction(`${electionId}:${unitId}:jitter`) * 0.2;
    reportingPct = Math.min(PRE_FINAL_REPORTING_CAP, Math.round(baselineReportingPct * jitter));
  }

  const called =
    !tied &&
    totalVotes > 0 &&
    leaderId !== "" &&
    (isEnded || (revealed && leaderMarginPct >= CALL_MARGIN_PCT));

  const candidates: ResultsUnitCandidate[] = entries
    .map(([candidateId, v]) => ({
      candidateId,
      votes: v,
      voteShare: totalVotes > 0 ? (v / totalVotes) * 100 : 0,
    }))
    .sort((a, b) => b.votes - a.votes);

  return {
    id: unitId,
    name,
    weight,
    totalVotes,
    reportingPct,
    called,
    calledFor: called ? leaderId : undefined,
    leaderId: leaderId || undefined,
    tied,
    leaderMargin,
    leaderMarginPct,
    candidates,
  };
}

/** Sum called + leading EV per candidate from computed units. */
export function computeElectoralTotals(units: ResultsUnit[]): {
  calledEv: Record<string, number>;
  leadingEv: Record<string, number>;
} {
  const calledEv: Record<string, number> = {};
  const leadingEv: Record<string, number> = {};
  for (const unit of units) {
    if (unit.called && unit.calledFor) {
      calledEv[unit.calledFor] = (calledEv[unit.calledFor] ?? 0) + unit.weight;
    } else if (unit.leaderId && !unit.tied) {
      leadingEv[unit.leaderId] = (leadingEv[unit.leaderId] ?? 0) + unit.weight;
    }
  }
  return { calledEv, leadingEv };
}

/**
 * National projection call from full projected seats. Westminster style turns
 * "no majority" into a hung parliament; generic style reports the largest
 * party. `tooEarly` when nothing has been counted yet.
 */
export function computeNationalProjection(
  parties: NationalParty[],
  majorityThreshold: number,
  style: "westminster" | "generic"
): NationalProjection {
  const totalProjected = parties.reduce((s, p) => s + p.projectedSeats, 0);
  if (totalProjected === 0) return { kind: "tooEarly" };

  const sorted = [...parties].sort((a, b) => b.projectedSeats - a.projectedSeats);
  const top = sorted[0];
  if (top.projectedSeats >= majorityThreshold) {
    return {
      kind: "majority",
      partyId: top.party,
      partyName: top.name,
      margin: top.projectedSeats - majorityThreshold + 1,
    };
  }
  if (style === "westminster") {
    return { kind: "hung", partyId: top.party, partyName: top.name };
  }
  const runnerUp = sorted[1];
  return {
    kind: "largest",
    partyId: top.party,
    partyName: top.name,
    margin: top.projectedSeats - (runnerUp?.projectedSeats ?? 0),
  };
}
