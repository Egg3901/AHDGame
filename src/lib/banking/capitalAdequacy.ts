/**
 * B7 — bank supervision: capital adequacy, stress tests, and forced recap.
 *
 * The solvency pass already models a bank RUN: confidence falls, depositors
 * flee, and a bank that cannot meet withdrawals fails. That is the market
 * disciplining a bank after the fact.
 *
 * What did not exist is a supervisor disciplining it BEFORE the fact. Nothing
 * required a bank to hold capital against its loan book, so the profitable move
 * was to lever as far as the deposit ceiling allowed and let confidence be
 * whatever it turned out to be — capital was a number posted once at charter
 * and never looked at again.
 *
 * ## Two thresholds, two different consequences
 *
 * A single threshold would make supervision binary: fine one turn, dead the
 * next. Two makes it a gradient a player can act inside.
 *
 *  - **Below the STRESS ratio** the bank is not in danger, but it fails the
 *    supervisor's scenario. It keeps operating and keeps its charter; what it
 *    loses is the right to distribute. A bank that cannot survive a downturn
 *    on paper does not get to pay its owner in the meantime.
 *  - **Below the MINIMUM ratio** the bank is undercapitalized in fact. It has
 *    `RECAP_GRACE_TURNS` to post more capital. Miss that and the charter is
 *    revoked and the existing resolution machinery runs.
 *
 * ## Why the stress scenario is fixed rather than random
 *
 * The supervisor applies one published shock: a fraction of the loan book goes
 * bad at once. A player can compute their own result before the supervisor
 * does, which is what makes the requirement a constraint to plan against
 * rather than a periodic surprise. Same reasoning as the C3 bands, the C5
 * threshold and the B4 resolve clock.
 */

/** Capital as a share of the loan book below which a bank must recapitalize. */
export const MIN_CAPITAL_RATIO = 0.08;

/** Ratio the bank must still clear AFTER the supervisory shock to distribute. */
export const STRESS_CAPITAL_RATIO = 0.06;

/**
 * The published supervisory scenario: this share of the loan book defaults at
 * once, absorbed by capital.
 */
export const STRESS_LOSS_FRACTION = 0.15;

/** Turns an undercapitalized bank has to post capital before its charter goes. */
export const RECAP_GRACE_TURNS = 12;

export type CapitalStanding =
  /** Meets the minimum and survives the stress scenario. */
  | "adequate"
  /** Meets the minimum but fails the scenario: distributions barred. */
  | "stressed"
  /** Below the minimum: recapitalize or lose the charter. */
  | "undercapitalized";

export interface CapitalPosition {
  /** Capital backing the book: posted capital plus the bank's own free cash. */
  capitalAnchor: number;
  /** Risk assets: the loan book plus any marked proprietary book. */
  riskAssetsAnchor: number;
  capitalRatio: number;
  /** Ratio after the published shock is absorbed by capital. */
  stressedCapitalRatio: number;
  standing: CapitalStanding;
}

export function assessCapital(input: {
  postedCapital: number;
  liquidCapital: number;
  totalLoans: number;
  propBookMarkValue?: number;
}): CapitalPosition {
  const finite = (n: number | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? n : 0;

  const capitalAnchor = Math.max(0, finite(input.postedCapital)) + Math.max(0, finite(input.liquidCapital));
  const riskAssetsAnchor =
    Math.max(0, finite(input.totalLoans)) + Math.max(0, finite(input.propBookMarkValue));

  // A bank with no risk assets is trivially adequate. It has lent nothing, so
  // there is nothing for capital to be inadequate against — and dividing by a
  // floor of 1 would report a nonsense ratio for a brand new charter.
  if (riskAssetsAnchor <= 0) {
    return {
      capitalAnchor,
      riskAssetsAnchor: 0,
      capitalRatio: 1,
      stressedCapitalRatio: 1,
      standing: "adequate",
    };
  }

  const capitalRatio = capitalAnchor / riskAssetsAnchor;

  // The shock burns capital; the book it is measured against shrinks by the
  // same losses, because a defaulted loan stops being an asset.
  const lossAnchor = riskAssetsAnchor * STRESS_LOSS_FRACTION;
  const stressedCapital = capitalAnchor - lossAnchor;
  const stressedAssets = riskAssetsAnchor - lossAnchor;
  const stressedCapitalRatio =
    stressedAssets > 0 ? stressedCapital / stressedAssets : stressedCapital > 0 ? 1 : 0;

  const standing: CapitalStanding =
    capitalRatio < MIN_CAPITAL_RATIO
      ? "undercapitalized"
      : stressedCapitalRatio < STRESS_CAPITAL_RATIO
        ? "stressed"
        : "adequate";

  return { capitalAnchor, riskAssetsAnchor, capitalRatio, stressedCapitalRatio, standing };
}

/**
 * Capital the bank must post to clear the minimum. Zero when it already does.
 *
 * Solves for the posting that brings the ratio to exactly the minimum, so the
 * number shown to the player is the number that actually cures the breach
 * rather than a guess they have to iterate on.
 */
export function capitalShortfall(position: CapitalPosition): number {
  if (position.standing !== "undercapitalized") return 0;
  const required = position.riskAssetsAnchor * MIN_CAPITAL_RATIO;
  return Math.max(0, Math.ceil(required - position.capitalAnchor));
}

/** Is a bank past its recapitalization deadline? */
export function recapDeadlineExpired(
  undercapitalizedSinceTurn: number | undefined,
  currentTurn: number
): boolean {
  if (typeof undercapitalizedSinceTurn !== "number") return false;
  return currentTurn - undercapitalizedSinceTurn >= RECAP_GRACE_TURNS;
}

/**
 * May this bank distribute to its owner (dividends, prop-book risk-taking)?
 *
 * Only an ADEQUATE bank may. Both impaired standings are barred: a bank that
 * cannot survive the published scenario does not get to pay out in the
 * meantime, and one that is actually below the minimum obviously does not.
 */
export function mayDistribute(standing: CapitalStanding): boolean {
  return standing === "adequate";
}
