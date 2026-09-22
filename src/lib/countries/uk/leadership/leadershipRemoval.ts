/**
 * UK party-specific leadership removal (epic #856, ticket #861 — Cluster B).
 *
 * Distinct from the government confidence gauge: this is confidence in the PM
 * *as party leader* — a leadership contest, not a general election. The process
 * is a DATA-DRIVEN per-party ruleset, and the ruleset is CHANGEABLE BY THE
 * PARTY'S INTERNAL COMMITTEE (a 1922-style committee / NEC analogue). Controlling
 * the committee lets a faction rewrite these rules to protect or expose the
 * leader — so this module only EVALUATES a ruleset; amending it = storing a
 * different ruleset. Defaults for LAB / CON are starting configs, not hardcoded law.
 *
 * See ops-knowledge `uk-rework-design-2026-08-25`.
 */

/** Who votes in a leadership ballot once a challenge is triggered. */
export type LeadershipElectorate = "mps" | "members";

export interface LeadershipRemovalRuleset {
  /**
   * Fraction of the parliamentary party that must back a challenge to trigger a
   * ballot (e.g. CON letters to the 1922 committee ≈ 0.15 of MPs).
   */
  triggerThresholdPct: number;
  /** Who votes in the ballot. */
  electorate: LeadershipElectorate;
  /** Fraction of votes cast required to REMOVE the leader (e.g. 0.5 = simple majority). */
  removalMajorityPct: number;
  /**
   * If true, surviving a ballot grants immunity for a cooldown (CON-style: a
   * confidence-vote win protects the leader for a period). Cooldown length in
   * turns; 0 = no immunity.
   */
  survivalImmunityTurns: number;
}

/** Starting config: Conservative-style — letters from MPs, MPs vote, simple majority, 1-year-ish immunity. */
export const DEFAULT_CON_RULESET: LeadershipRemovalRuleset = {
  triggerThresholdPct: 0.15,
  electorate: "mps",
  removalMajorityPct: 0.5,
  survivalImmunityTurns: 48,
};

/** Starting config: Labour-style — nominations from a larger share of MPs, then members vote. */
export const DEFAULT_LAB_RULESET: LeadershipRemovalRuleset = {
  triggerThresholdPct: 0.2,
  electorate: "members",
  removalMajorityPct: 0.5,
  survivalImmunityTurns: 0,
};

/** Default ruleset for a party family key. Unknown families fall back to CON-style. */
export function defaultRulesetFor(partyFamily: string): LeadershipRemovalRuleset {
  switch (partyFamily.toLowerCase()) {
    case "labour":
    case "lab":
      return DEFAULT_LAB_RULESET;
    case "conservative":
    case "con":
    case "tory":
      return DEFAULT_CON_RULESET;
    default:
      return DEFAULT_CON_RULESET;
  }
}

/**
 * Can a challenge be triggered? True when the number of backers meets the ruleset
 * threshold as a fraction of the parliamentary party, and the leader is not
 * currently within a survival-immunity window.
 */
export function canTriggerChallenge(
  backers: number,
  totalMps: number,
  ruleset: LeadershipRemovalRuleset,
  opts: { turnsSinceLastSurvival?: number } = {}
): { canTrigger: boolean; reason: string } {
  if (totalMps <= 0) return { canTrigger: false, reason: "no parliamentary party" };
  const since = opts.turnsSinceLastSurvival;
  if (
    ruleset.survivalImmunityTurns > 0 &&
    typeof since === "number" &&
    since < ruleset.survivalImmunityTurns
  ) {
    return { canTrigger: false, reason: "leader within survival-immunity window" };
  }
  const share = Math.max(0, backers) / totalMps;
  if (share < ruleset.triggerThresholdPct) {
    return { canTrigger: false, reason: "threshold not met" };
  }
  return { canTrigger: true, reason: "threshold met" };
}

/**
 * Resolve a leadership ballot. The leader is REMOVED when the vote share to
 * remove strictly exceeds the required majority.
 */
export function resolveLeadershipBallot(
  votesToRemove: number,
  votesCast: number,
  ruleset: LeadershipRemovalRuleset
): { removed: boolean; removeShare: number } {
  if (votesCast <= 0) return { removed: false, removeShare: 0 };
  const removeShare = Math.max(0, votesToRemove) / votesCast;
  return { removed: removeShare > ruleset.removalMajorityPct, removeShare };
}
