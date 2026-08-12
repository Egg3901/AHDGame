/**
 * A7 part 2: the index committee, and what a waiver can and cannot buy.
 *
 * Part 1 made index membership a bar. This is the discretion on top of it: an
 * issuer that fails a standard petitions the committee, and a named
 * officeholder rules. Inclusion pays the issuer (a credit notch and a share
 * price premium once funds hold 10%), so there is a real reason to lobby for it,
 * and a real reason for the decision to be answerable to somebody.
 *
 * ## Solvency is NOT waivable
 *
 * A committee that can wave an insolvent corporation into an index is a
 * committee that can make fund holders pay for a political favour. Free float
 * and size are qualification bars and can be argued about; solvency is a
 * statement about whether the thing is going concern. The waiver suppresses the
 * first two and never the third, enforced here rather than at the API, so no
 * future caller can grant something the rule does not allow.
 *
 * ## The automatic decision is DETERMINISTIC
 *
 * Most seats in most worlds are NPP-held or vacant. Those petitions are decided
 * by rule at the deadline, never by a dice roll, so a replay produces the same
 * world. The rule is: a big enough contribution, against a shortfall that is
 * close enough to the bar to be arguable. Money alone does not get a shell into
 * an index, and being nearly qualified does not get you in for free.
 */

import type { ListingFailure } from "../listingStandards";

/** Failures a waiver may suppress. Solvency is deliberately absent. */
export const WAIVABLE_FAILURES: readonly ListingFailure[] = ["free_float", "size"];

/** Turns a petition sits before the deadline decides it. */
export const PETITION_DECISION_TURNS = 12;

/** Turns a granted waiver is honoured for. */
export const WAIVER_TURNS = 48;

/**
 * Contribution needed to move an NPP or vacant seat, as a share of the
 * petitioner's market cap. Scaled rather than flat so lobbying costs a big
 * issuer what it costs a small one, and so it cannot be trivially cheap for the
 * corporations that gain the most from inclusion.
 */
export const AUTO_GRANT_CONTRIBUTION_RATIO = 0.02;

/** Floor for the above, so a near-worthless corp still has to pay something real. */
export const AUTO_GRANT_MIN_CONTRIBUTION_ANCHOR = 250_000;

/**
 * How far below a bar an automatic grant tolerates. At 0.5 a corporation must
 * be at least half the required size or float; below that the shortfall is not
 * a marginal case any officeholder could defend and the rule refuses.
 */
export const AUTO_GRANT_MIN_SHORTFALL_RATIO = 0.5;

export function isWaivable(failure: ListingFailure): boolean {
  return WAIVABLE_FAILURES.includes(failure);
}

/**
 * Failures still standing once a waiver is applied.
 *
 * Returns the input unchanged when there is no waiver, so the caller does not
 * need to branch.
 */
export function failuresAfterWaiver(
  failures: ListingFailure[],
  hasWaiver: boolean
): ListingFailure[] {
  if (!hasWaiver) return failures;
  return failures.filter((f) => !isWaivable(f));
}

/** The contribution an automatic grant requires from this petitioner. */
export function requiredContributionAnchor(marketCapAnchor: number): number {
  const scaled = Math.max(0, marketCapAnchor) * AUTO_GRANT_CONTRIBUTION_RATIO;
  return Math.max(AUTO_GRANT_MIN_CONTRIBUTION_ANCHOR, scaled);
}

export interface AutoDecisionInput {
  contributionAnchor: number;
  marketCapAnchor: number;
  /**
   * How close the petitioner is to the bar it misses, as observed/required.
   * 1 or more means it is not failing that standard at all. `null` means the
   * shortfall could not be measured.
   */
  worstShortfallRatio: number | null;
  /** Any unwaivable failure standing at decision time refuses outright. */
  hasUnwaivableFailure: boolean;
}

export interface AutoDecision {
  granted: boolean;
  reason:
    | "unwaivable_failure"
    | "shortfall_too_large"
    | "contribution_too_small"
    | "granted"
    | "no_longer_failing";
}

/**
 * Decide a petition nobody answered. Order matters: the reasons are checked
 * worst-first, so the record says the most fundamental thing that was wrong
 * rather than the last one tested.
 */
export function decidePetitionAutomatically(input: AutoDecisionInput): AutoDecision {
  if (input.hasUnwaivableFailure) return { granted: false, reason: "unwaivable_failure" };

  // Nothing left to waive. Granting would be harmless but dishonest: the record
  // would show a waiver doing work it never did.
  if (input.worstShortfallRatio === null || input.worstShortfallRatio >= 1) {
    return { granted: false, reason: "no_longer_failing" };
  }

  if (input.worstShortfallRatio < AUTO_GRANT_MIN_SHORTFALL_RATIO) {
    return { granted: false, reason: "shortfall_too_large" };
  }

  if (input.contributionAnchor < requiredContributionAnchor(input.marketCapAnchor)) {
    return { granted: false, reason: "contribution_too_small" };
  }

  return { granted: true, reason: "granted" };
}

/** A granted waiver is honoured through `waiverUntilTurn`, inclusive. */
export function isWaiverActive(
  petition: { status: string; waiverUntilTurn?: number },
  currentTurn: number
): boolean {
  if (petition.status !== "granted") return false;
  if (petition.waiverUntilTurn === undefined) return false;
  return currentTurn <= petition.waiverUntilTurn;
}
