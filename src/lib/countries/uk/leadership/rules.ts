/**
 * UK party leadership removal — portable rules core (epic #856, ticket #861).
 *
 * Pure data in / plain data out. The shell (`leadershipCommands`, API routes,
 * the turn processor) loads documents, calls these helpers, and writes the
 * results back. No database, clock, randomness, environment, or network here.
 *
 * Covers the two NEW formulas this ticket adds on top of the `leadershipRemoval`
 * evaluator (which stays untouched):
 *  - safe bounds for committee amendments to a party's removal ruleset;
 *  - committee faction-control resolution from seat tags.
 */

import type { LeadershipElectorate } from "@/lib/uk/leadership/leadershipRemoval";

/** Turn spacing between two committee amendments to the same party's ruleset. */
export const LEADERSHIP_AMENDMENT_COOLDOWN_TURNS = 24;

/** Ballot window once a challenge opens (turns). Mirrors the 24h PM votes. */
export const LEADERSHIP_BALLOT_DURATION_TURNS = 24;

/** Gathering window: a challenge that never reaches threshold expires. */
export const LEADERSHIP_GATHERING_WINDOW_TURNS = 48;

/** Bounded audit trail per party leadership document. */
export const LEADERSHIP_HISTORY_CAP = 50;

/** Safe bounds a committee amendment must stay inside. */
export const LEADERSHIP_RULESET_BOUNDS = {
  /** 5% (a fringe can force a conversation) to 50% (never above half to trigger). */
  triggerThresholdPct: { min: 0.05, max: 0.5 },
  /** Strictly above a half (ties keep the leader) up to a three-quarter supermajority. */
  removalMajorityPct: { minExclusive: 0.5, max: 0.75 },
  /** No immunity up to ~4 days of turns. */
  survivalImmunityTurns: { min: 0, max: 96 },
} as const;

export interface RulesetAmendmentPatch {
  triggerThresholdPct?: number;
  electorate?: LeadershipElectorate;
  removalMajorityPct?: number;
  survivalImmunityTurns?: number;
}

export interface AmendmentValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a committee amendment patch. Rejects unknown electorates,
 * out-of-bounds numbers, non-integers for the immunity window, and empty
 * patches (a no-op amendment must not consume the cooldown).
 */
export function validateRulesetAmendment(patch: RulesetAmendmentPatch): AmendmentValidation {
  const errors: string[] = [];
  if (
    patch.triggerThresholdPct === undefined &&
    patch.electorate === undefined &&
    patch.removalMajorityPct === undefined &&
    patch.survivalImmunityTurns === undefined
  ) {
    return { ok: false, errors: ["amendment changes nothing"] };
  }
  if (patch.triggerThresholdPct !== undefined) {
    const v = patch.triggerThresholdPct;
    const { min, max } = LEADERSHIP_RULESET_BOUNDS.triggerThresholdPct;
    if (typeof v !== "number" || Number.isNaN(v) || v < min || v > max) {
      errors.push(`triggerThresholdPct must be between ${min} and ${max}`);
    }
  }
  if (patch.electorate !== undefined) {
    if (patch.electorate !== "mps" && patch.electorate !== "members") {
      errors.push('electorate must be "mps" or "members"');
    }
  }
  if (patch.removalMajorityPct !== undefined) {
    const v = patch.removalMajorityPct;
    const { minExclusive, max } = LEADERSHIP_RULESET_BOUNDS.removalMajorityPct;
    if (typeof v !== "number" || Number.isNaN(v) || v <= minExclusive || v > max) {
      errors.push(`removalMajorityPct must be above ${minExclusive} and at most ${max}`);
    }
  }
  if (patch.survivalImmunityTurns !== undefined) {
    const v = patch.survivalImmunityTurns;
    const { min, max } = LEADERSHIP_RULESET_BOUNDS.survivalImmunityTurns;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      errors.push(`survivalImmunityTurns must be an integer between ${min} and ${max}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** One committee seat tagged with its holder's faction (caucus slug, null = unaligned). */
export interface CommitteeSeatTag {
  memberId: string;
  faction: string | null;
}

export interface CommitteeControl {
  totalSeats: number;
  /** Faction holding the most seats (null when the committee is empty). */
  leadingFaction: string | null;
  leadingSeats: number;
  /** True when one faction holds an outright majority of seats. */
  majorityHeld: boolean;
  /** Seats per faction; unaligned seats count under "(unaligned)". */
  seatsByFaction: Record<string, number>;
}

/**
 * Resolve which faction controls the committee: the faction with the most
 * seats, and whether that is an outright majority. Ties and empty committees
 * report no majority — a divided committee cannot be wielded by one faction.
 */
export function resolveCommitteeControl(seats: CommitteeSeatTag[]): CommitteeControl {
  const seatsByFaction: Record<string, number> = {};
  for (const seat of seats) {
    const key = seat.faction ?? "(unaligned)";
    seatsByFaction[key] = (seatsByFaction[key] ?? 0) + 1;
  }
  let leadingFaction: string | null = null;
  let leadingSeats = 0;
  let tied = false;
  for (const [faction, count] of Object.entries(seatsByFaction)) {
    if (count > leadingSeats) {
      leadingFaction = faction;
      leadingSeats = count;
      tied = false;
    } else if (count === leadingSeats) {
      tied = true;
    }
  }
  const totalSeats = seats.length;
  const majorityHeld =
    !tied && leadingFaction !== null && leadingSeats > totalSeats / 2 && totalSeats > 0;
  return {
    totalSeats,
    leadingFaction: totalSeats === 0 ? null : leadingFaction,
    leadingSeats,
    majorityHeld,
    seatsByFaction,
  };
}

/** Governing-committee display name per party family. */
export function committeeNameForFamily(family: string): string {
  switch (family) {
    case "lab":
      return "National Executive Committee";
    case "con":
      return "1922 Committee";
    default:
      return "National Committee";
  }
}
