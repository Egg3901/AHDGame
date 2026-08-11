import { RD_INNOVATION_SCORE_THRESHOLD } from "@/lib/constants/corporations";

/**
 * Resource Prospecting + Extraction Contract constants.
 *
 * Prospecting lets an extraction corporation or a government pay to run a
 * geological survey that, on success, expands a state's per-resource extraction
 * capacity. Contract issuance lets a government reserve a share of a state's
 * capacity for a corporation in exchange for a signing fee and a per-turn
 * royalty. Both ship behind gameConfig flags (prospectingEnabled /
 * contractIssuanceEnabled) — see src/lib/extraction/featureFlag.ts.
 *
 * COPY/BALANCE comments are "why" notes per the turn-system comment standard.
 */

// ── Prospecting ──────────────────────────────────────────────────────────────

/** Turns from launch to resolution (12 turns = one game quarter at 48/yr). */
export const PROSPECT_DURATION_TURNS = 12;

/** Base survey cost, anchor units, before escalation. */
export const PROSPECT_BASE_COST_ANCHOR = 500_000;

/**
 * Cost escalation multiplier as a state+resource gets prospected repeatedly:
 * min(4, 1 + 0.5 × priorSuccessCount). Caps at 4× so a heavily-surveyed deposit
 * gets expensive but never unbounded. priorSuccessCount counts SUCCEEDED
 * surveys (any initiator) for that (state, resource).
 */
export function prospectCostMultiplier(priorSuccessCount: number): number {
  return Math.min(4, 1 + 0.5 * Math.max(0, priorSuccessCount));
}

/** Escalated survey cost in anchor units for a given prior-success count. */
export function prospectCostAnchor(priorSuccessCount: number): number {
  return PROSPECT_BASE_COST_ANCHOR * prospectCostMultiplier(priorSuccessCount);
}

/** Flat government success chance (national + state surveys). */
export const PROSPECT_GOVT_SUCCESS_CHANCE = 0.5;

/** Government yield multiplier applied to the base uniform(0.03,0.08) roll. */
export const PROSPECT_GOVT_RD_MULT = 1.5;

/** Uniform yield band as a fraction of current capacity (before rdMult). */
export const PROSPECT_YIELD_MIN = 0.03;
export const PROSPECT_YIELD_MAX = 0.08;

/** Hard cap on a single survey's capacity gain: 20% of current capacity. */
export const PROSPECT_MAX_GAIN_FRACTION = 0.2;

/** Max active surveys per initiator (corp or government). */
export const PROSPECT_MAX_ACTIVE_PER_INITIATOR = 3;

/**
 * Corp success chance from rdScore: 0.25 + 0.55 × min(1, rdScore / 200).
 * 25% at rdScore 0 → 80% at the innovation threshold (200) and above.
 */
export function prospectCorpSuccessChance(rdScore: number): number {
  return 0.25 + 0.55 * Math.min(1, Math.max(0, rdScore) / RD_INNOVATION_SCORE_THRESHOLD);
}

/**
 * Corp yield multiplier from rdScore: 1 + min(1, rdScore / 200).
 * With the uniform(0.03,0.08) base band this gives a 3–16% capacity gain.
 */
export function prospectCorpRdMult(rdScore: number): number {
  return 1 + Math.min(1, Math.max(0, rdScore) / RD_INNOVATION_SCORE_THRESHOLD);
}

// ── Extraction contracts ─────────────────────────────────────────────────────

/**
 * Total contracted share ceiling per (state, resource). The sum of `share`
 * over every non-terminal contract (offered + active, any issuer, incl. legacy
 * admin grants) plus any new share must stay <= this. Keeps open-access
 * extractors from being fully crowded out.
 */
export const GOVT_CONTRACT_MAX_TOTAL_SHARE = 0.75;

/** Missed royalty payments that trigger a default. */
export const CONTRACT_DEFAULT_MISSED_PAYMENTS = 3;

/** Turns an unaccepted offer stays open before it lapses (expired). */
export const CONTRACT_OFFER_EXPIRY_TURNS = 24;

/** Royalty rate bounds (fraction of contracted capacity market value / turn). */
export const CONTRACT_ROYALTY_RATE_MIN = 0;
export const CONTRACT_ROYALTY_RATE_MAX = 0.02;

/** Term bounds in turns (24 = half a game year, 480 = ten game years). */
export const CONTRACT_TERM_TURNS_MIN = 24;
export const CONTRACT_TERM_TURNS_MAX = 480;

/** Per-contract share bounds. */
export const CONTRACT_SHARE_MIN = 0.01;
export const CONTRACT_SHARE_MAX = 0.75;

// ── Era ──────────────────────────────────────────────────────────────────────

/**
 * Era scaling for prospecting.
 *
 * A survey in 1953 and a survey in 2019 were running the same numbers, which
 * gets the era wrong in two opposite directions at once.
 *
 * Finding oil in 1953 meant surface geology, magnetometers and single-fold
 * seismic read off paper — no digital processing, no 3D imaging, no satellite
 * gravimetry. Success rates were far worse and a survey took much longer. But
 * the deposits still out there were the easy ones: shallow, large, and
 * unclaimed. By 2019 the technology finds almost anything, and what is left to
 * find is marginal.
 *
 * So the era model is a trade rather than a difficulty slider: earlier worlds
 * hit less often and wait longer, and are paid more when they do hit. That
 * keeps prospecting a live decision in every era instead of a strictly worse
 * one in the past.
 *
 * Anchors interpolate linearly, matching `METRIC_BAND_CURVES`. A null year
 * (era clock off) returns neutral, so an existing world is unchanged.
 */
export interface ProspectEraScaling {
  /** Multiplier on success chance. */
  success: number;
  /** Multiplier on the yield band (payoff when a survey hits). */
  yield: number;
  /** Multiplier on survey duration. */
  duration: number;
}

const PROSPECT_ERA_ANCHORS: Array<{ year: number } & ProspectEraScaling> = [
  // Pre-digital: paper seismic, ~1-in-8 wildcat odds, surveys measured in
  // seasons. The compensation is that a hit could be a whole new field.
  { year: 1953, success: 0.6, yield: 1.6, duration: 1.5 },
  // Digital processing and offshore capability arrive; the majors have already
  // taken the obvious onshore structures.
  { year: 1979, success: 0.8, yield: 1.3, duration: 1.25 },
  { year: 1991, success: 0.9, yield: 1.15, duration: 1.1 },
  // Present day = the authored constants, unscaled.
  { year: 2019, success: 1, yield: 1, duration: 1 },
];

const NEUTRAL_ERA_SCALING: ProspectEraScaling = { success: 1, yield: 1, duration: 1 };

export function prospectEraScaling(year: number | null | undefined): ProspectEraScaling {
  if (year == null || !Number.isFinite(year)) return NEUTRAL_ERA_SCALING;
  const a = PROSPECT_ERA_ANCHORS;
  if (year <= a[0].year)
    return { success: a[0].success, yield: a[0].yield, duration: a[0].duration };
  const last = a[a.length - 1];
  if (year >= last.year)
    return { success: last.success, yield: last.yield, duration: last.duration };
  for (let i = 1; i < a.length; i++) {
    if (year <= a[i].year) {
      const t = (year - a[i - 1].year) / (a[i].year - a[i - 1].year);
      const lerp = (lo: number, hi: number) => lo + (hi - lo) * t;
      return {
        success: lerp(a[i - 1].success, a[i].success),
        yield: lerp(a[i - 1].yield, a[i].yield),
        duration: lerp(a[i - 1].duration, a[i].duration),
      };
    }
  }
  return NEUTRAL_ERA_SCALING;
}

/** Survey duration in turns for a year, rounded to a whole turn (min 1). */
export function prospectDurationTurns(year: number | null | undefined): number {
  return Math.max(1, Math.round(PROSPECT_DURATION_TURNS * prospectEraScaling(year).duration));
}
