/**
 * UK independence/reunification referendum tunables + pure compute helpers.
 *
 * Single source of truth shared by the lifecycle processor, the domain
 * commands, the API routes, and the UI preview — mirrors the structure of
 * `src/lib/constants/devolution.ts`. No DB I/O lives here.
 *
 * See `docs/superpowers/specs/2026-06-16-independence-process-design.md`.
 */

// ─── Eligibility / lifecycle tunables (durations in turns; 48 turns = 1 yr) ──

/** Min `independenceDesire` to request a referendum (= PRO_INDY_BONUS_THRESHOLD). */
export const REQUEST_THRESHOLD = 60;
/** First Minister office AP to file a request. */
export const REQUEST_AP_COST = 3;
/** Campaign length once granted (1 game-year). */
export const CAMPAIGN_WINDOW_TURNS = 48;
/** Cooldown after the PM sits on it / the Commons refuses. */
export const DECLINE_COOLDOWN_TURNS = 96;
/** A PM decline stokes the cause — desire ticks up by this much (clamped to 100). */
export const DECLINE_DESIRE_BUMP = 5;
/** Cooldown after a No vote (~10 game-years). */
export const SETTLED_COOLDOWN_TURNS = 480;
/** A No vote dampens desire back to the unionist baseline. */
export const SETTLED_DESIRE_TARGET = 30;
/** Post-pass conversion window: a passed referendum sits in `actuating` for this
 *  many turns, during which an admin may resolve it early or block it. If
 *  neither happens, it auto-converts when the window closes. */
export const CONVERSION_WINDOW_TURNS = 24;

/** `yesShare` must strictly EXCEED this to pass. */
export const REFERENDUM_PASS_THRESHOLD = 50;

// ─── Campaign tunables ───────────────────────────────────────────────────────

/** Base percentage-points of `yesShare` shift per spend unit at zero prior spend. */
export const CAMPAIGN_SPEND_YESSHARE_PER_UNIT = 0.5;
/** Diminishing-returns scale: marginal effect halves every this-many prior units. */
export const CAMPAIGN_SPEND_HALF_LIFE_UNITS = 20;
/** ± percentage-point turnout/variance swing applied at the poll. */
export const CAMPAIGN_VARIANCE_BAND = 4;
/** Political Strength cost (before pressure escalation) per campaign spend unit. */
export const CAMPAIGN_PS_COST_PER_UNIT = 1;

// ─── Poll history / momentum (Sub-project B) ─────────────────────────────────

/** Max poll readings kept on a referendum (campaign window + slack); the array
 *  is window-bounded so this is a defensive guard, never normally reached. */
export const POLL_HISTORY_CAP = 64;
/** Momentum "recent swing" compares the latest reading to ~this many turns back. */
export const MOMENTUM_LOOKBACK_TURNS = 3;
/** |recentDelta| at or below this (percentage points) reads as flat. */
export const MOMENTUM_FLAT_THRESHOLD = 0.5;

// ─── Ground game / cohort model (Sub-project C) ──────────────────────────────

/** Per-cohort soft caps (applied via tanh at read time, see cohortEngine) so
 *  one cohort can't be driven past realism. */
export const GG_TURNOUT_MOD_CAP = 20;
export const GG_LEAN_MOD_CAP = 25;
/** Targeting a single cohort concentrates a persuade card's lean by this factor. */
export const GG_PERSUADE_TARGET_CONC = 6;
/** Targeting a single cohort concentrates a mobilize card's turnout by this factor. */
export const GG_MOBILIZE_TARGET_CONC = 3;
/** Mobilize also nudges the spender's side's lean by this fraction of its push. */
export const GG_MOBILIZE_LEAN_FRACTION = 0.2;

// ─── Campaign wire (Sub-project E) ───────────────────────────────────────────

/** Min |Δ yesShare| since the previous reading to log a `swing` event (pp). */
export const WIRE_SWING_THRESHOLD = 2;
/** Min |Δ yesShare| a ground-game action must produce to log a `ground` event (pp). */
export const WIRE_GROUND_MIN_DELTA = 0.3;
/** Wire pagination page size. */
export const WIRE_PAGE_SIZE = 10;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

export interface RequestEligibilityArgs {
  desire: number;
  hasActiveReferendum: boolean;
  cooldownReadyAtTurn: number | null;
  currentTurn: number;
}

/**
 * Decide whether a First Minister may request a referendum right now.
 * Order matters: an active referendum and an unexpired cooldown both block
 * regardless of desire, and surface their own reasons.
 */
export function referendumRequestEligibility(args: RequestEligibilityArgs): {
  eligible: boolean;
  reason?: string;
} {
  if (args.hasActiveReferendum) {
    return { eligible: false, reason: "A referendum is already in progress for this region." };
  }
  if (args.cooldownReadyAtTurn != null && args.currentTurn < args.cooldownReadyAtTurn) {
    return { eligible: false, reason: `On cooldown until turn ${args.cooldownReadyAtTurn}.` };
  }
  if (args.desire < REQUEST_THRESHOLD) {
    return {
      eligible: false,
      reason: `Independence desire must reach ${REQUEST_THRESHOLD} to request a referendum.`,
    };
  }
  return { eligible: true };
}

/**
 * Cumulative yesShare effect of a side's first `units` of spend, with
 * diminishing returns. Pure and order-independent — the effect of N units is a
 * function of N alone, so it can be derived from the atomic spend counters at
 * any time without depending on the order spends landed.
 */
export function cumulativeCampaignEffect(units: number): number {
  let total = 0;
  for (let i = 0; i < units; i++) {
    total += CAMPAIGN_SPEND_YESSHARE_PER_UNIT / (1 + i / CAMPAIGN_SPEND_HALF_LIFE_UNITS);
  }
  return total;
}

/**
 * Legacy scalar yesShare from the campaign baseline + each side's cumulative
 * spend units. Order-independent. Since the cohort cutover this is only the
 * FALLBACK used by `referendumYesShare` for a referendum with no cohort baseline
 * (the cohort aggregate is the canonical path). Clamped to [0,100].
 */
export function deriveCampaignYesShare(
  baseYesShare: number,
  yesUnits: number,
  noUnits: number
): number {
  return clamp(
    baseYesShare + cumulativeCampaignEffect(yesUnits) - cumulativeCampaignEffect(noUnits),
    0,
    100
  );
}

/**
 * Resolve the final vote. `varianceRoll` is a caller-supplied value in [-1, 1]
 * (kept out of this pure fn so it stays deterministic and testable); it scales
 * the ± turnout/variance band. Turnout rises with how polarised the result is.
 */
export function resolveReferendumVote(args: { yesShare: number; varianceRoll: number }): {
  finalYesShare: number;
  turnout: number;
  passed: boolean;
} {
  const swing = clamp(args.varianceRoll, -1, 1) * CAMPAIGN_VARIANCE_BAND;
  const finalYesShare = clamp(args.yesShare + swing, 0, 100);
  const turnout = clamp(55 + Math.abs(finalYesShare - 50) * 0.6, 0, 100);
  return {
    finalYesShare,
    turnout,
    passed: finalYesShare > REFERENDUM_PASS_THRESHOLD,
  };
}
