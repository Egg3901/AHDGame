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
 * ## Capital is the bank's own money, not the cash in the drawer
 *
 * The first version of this module measured capital as `postedCapital +
 * liquidCapital`: the money posted at charter plus whatever cash the bank
 * happened to be holding. Money drawn on the discount window lands in
 * `liquidCapital` (`discountWindowCommands.ts:80` increments it directly), and
 * so does a CB margin draw. Both are somebody else's claim on the bank, and
 * both counted as the bank's own capital.
 *
 * The consequence was not subtle: **borrowing raised your capital ratio**. A
 * bank one draw away from breaching the minimum could cure the breach by
 * drawing on the emergency facility that exists precisely because it is in
 * trouble. Capital is now:
 *
 *   equity = postedCapital + liquidCapital − discountWindow − cbMargin − interbank
 *
 * A draw moves cash and the matching liability together and leaves the ratio
 * exactly where it was, which is the whole point: emergency liquidity should
 * keep a bank alive without making it look solvent.
 *
 * ## Why deposits are absent from that line
 *
 * Because in this engine deposits are not cash. `bankingTurn` phase (b) moves
 * `npcDeposits` against the central bank's `externalBroadMoney` and never
 * touches `liquidCapital`; deposit flight in `bankSolvencyTurn` does the same
 * in reverse. The deposit base is a claim the bank must hold
 * `reserveRatio × deposits` of cash against — that is the liquidity test in the
 * solvency pass, and the reserve floor on the corp treasury — and it is
 * deliberately not a capital test.
 *
 * Subtracting the full deposit base here would be double-counting a liability
 * whose matching asset the engine does not model, and it would report every
 * honestly-run bank in the world as insolvent the moment it took a deposit. The
 * loan book is funded by that deposit base (`bankingTurn` caps it at
 * `deposits × (1 − reserveRatio)`), which is why loans do not add to equity
 * either: originating a loan grows the denominator and leaves the numerator
 * alone, so lending costs you ratio, exactly as it should.
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
 * ## Why the stress scenario is published rather than random
 *
 * The supervisor applies one published shock: a fraction of the loan book goes
 * bad at once. A player can compute their own result before the supervisor
 * does, which is what makes the requirement a constraint to plan against
 * rather than a periodic surprise. Same reasoning as the C3 bands, the C5
 * threshold and the B4 resolve clock.
 *
 * The shock is no longer flat across every bank. It is now derived from the
 * credit bands the book is actually made of (see `creditBands.ts`), so a
 * conservative book is shocked at ~3% and an aggressive one at ~15% — the flat
 * number every bank used to get regardless of what it had lent into.
 */

import {
  STRESS_LOSS_FRACTION,
  stressLossFraction,
  type BookTranche,
} from "@/lib/banking/creditBands";
import type { BankCharter } from "@/lib/db/types/bank";

export { STRESS_LOSS_FRACTION };

/** Capital as a share of the loan book below which a bank must recapitalize. */
export const MIN_CAPITAL_RATIO = 0.08;

/** Ratio the bank must still clear AFTER the supervisory shock to distribute. */
export const STRESS_CAPITAL_RATIO = 0.06;

/** Turns an undercapitalized bank has to post capital before its charter goes. */
export const RECAP_GRACE_TURNS = 12;

export type CapitalStanding =
  /** Meets the minimum and survives the stress scenario. */
  | "adequate"
  /** Meets the minimum but fails the scenario: distributions barred. */
  | "stressed"
  /** Below the minimum: recapitalize or lose the charter. */
  | "undercapitalized";

/** Everything the bank owes somebody other than its shareholders. */
export interface BankBorrowings {
  discountWindowDebt?: number;
  discountWindowArrears?: number;
  cbMarginDebt?: number;
  cbMarginArrears?: number;
  interbankDebt?: number;
}

export interface BankBalanceSheet {
  postedCapital: number;
  liquidCapital: number;
  /** Risk assets, not a funding source. See the note on deposits above. */
  totalLoans: number;
  /**
   * Required rather than optional, and required is the point: an omitted
   * liability silently inflates equity, which is the exact bug this module used
   * to have. Pass `{}` for a bank that has borrowed nothing, so that saying "no
   * borrowings" is a thing you did rather than a thing you forgot.
   */
  borrowings: BankBorrowings;
  propBookMarkValue?: number;
  /** Book composition for the band-weighted shock. Omit for the flat fallback. */
  bookTranches?: readonly BookTranche[];
}

export interface CapitalPosition {
  /** Equity: assets less every non-shareholder claim. May be negative. */
  capitalAnchor: number;
  /** Risk assets: the loan book plus any marked proprietary book. */
  riskAssetsAnchor: number;
  capitalRatio: number;
  /** Ratio after the published shock is absorbed by capital. */
  stressedCapitalRatio: number;
  /** Share of the book assumed to default at once, from its band mix. */
  appliedStressLossFraction: number;
  standing: CapitalStanding;
}

const finite = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** Sum of a charter's borrowings. Keeps call sites from forgetting a field. */
export function borrowingsFromCharter(
  charter:
    | Pick<
        BankCharter,
        | "discountWindowDebt"
        | "discountWindowArrears"
        | "cbMarginDebt"
        | "cbMarginArrears"
        | "interbankDebt"
      >
    | null
    | undefined
): BankBorrowings {
  return {
    discountWindowDebt: charter?.discountWindowDebt,
    discountWindowArrears: charter?.discountWindowArrears,
    cbMarginDebt: charter?.cbMarginDebt,
    cbMarginArrears: charter?.cbMarginArrears,
    interbankDebt: charter?.interbankDebt,
  };
}

export function totalBorrowings(borrowings: BankBorrowings): number {
  return (
    Math.max(0, finite(borrowings.discountWindowDebt)) +
    Math.max(0, finite(borrowings.discountWindowArrears)) +
    Math.max(0, finite(borrowings.cbMarginDebt)) +
    Math.max(0, finite(borrowings.cbMarginArrears)) +
    Math.max(0, finite(borrowings.interbankDebt))
  );
}

export function assessCapital(input: BankBalanceSheet): CapitalPosition {
  const ownFunds =
    Math.max(0, finite(input.postedCapital)) + Math.max(0, finite(input.liquidCapital));

  // Equity. Deliberately NOT floored at zero: a bank that owes more than it
  // holds is insolvent, and the supervisor needs to see that rather than a
  // clamped zero that reads the same as a bank with no capital but no hole.
  const capitalAnchor = ownFunds - totalBorrowings(input.borrowings);

  const riskAssetsAnchor =
    Math.max(0, finite(input.totalLoans)) + Math.max(0, finite(input.propBookMarkValue));

  const appliedStressLossFraction = input.bookTranches
    ? stressLossFraction(input.bookTranches)
    : STRESS_LOSS_FRACTION;

  // A bank with no risk assets has lent nothing, so there is nothing for
  // capital to be inadequate against — unless equity is already negative, in
  // which case it is insolvent on its deposit book alone and saying "adequate"
  // would be reporting a hole as health.
  if (riskAssetsAnchor <= 0) {
    const solvent = capitalAnchor >= 0;
    return {
      capitalAnchor,
      riskAssetsAnchor: 0,
      capitalRatio: solvent ? 1 : 0,
      stressedCapitalRatio: solvent ? 1 : 0,
      appliedStressLossFraction,
      standing: solvent ? "adequate" : "undercapitalized",
    };
  }

  const capitalRatio = capitalAnchor / riskAssetsAnchor;

  // The shock burns capital; the book it is measured against shrinks by the
  // same losses, because a defaulted loan stops being an asset.
  const lossAnchor = riskAssetsAnchor * appliedStressLossFraction;
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

  return {
    capitalAnchor,
    riskAssetsAnchor,
    capitalRatio,
    stressedCapitalRatio,
    appliedStressLossFraction,
    standing,
  };
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
