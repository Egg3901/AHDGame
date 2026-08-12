/**
 * B8 — the discount window.
 *
 * The central bank already had two ways to put money into a private bank: the
 * `liquidity_injection` operation (B1), which pushes money out pro rata whether
 * anyone asked or not, and the CB margin line, which funds a PROPRIETARY book
 * against posted collateral.
 *
 * Neither is a lender of last resort. A deposit-taking bank facing a run had no
 * facility to reach for at all: it could sell assets into a falling market, or
 * it could fail. That is the one thing a central bank exists to do.
 *
 * ## The stigma is the mechanic
 *
 * A discount window with a cheap rate and no consequence is free money, and
 * every bank would sit on it permanently. The real facility is priced above the
 * market and carries a signal: borrowing from the lender of last resort is what
 * a bank does when nobody else will lend to it.
 *
 * So drawing carries BOTH a penalty rate and a confidence hit — and confidence
 * is the input to the existing run mechanic, so using the window makes a run
 * marginally more likely even as it funds you through one. That is the actual
 * trade-off a bank faces, and it is why the facility is a decision rather than
 * an obvious yes.
 *
 * The stigma decays as the debt is repaid, so a bank that uses the window
 * briefly and clears it is not marked forever.
 */

import type { BankCharter } from "@/lib/db/types/bank";

/**
 * Penalty over prime, in percentage points. Deliberately above the CB margin
 * spread (`CB_MARGIN_SPREAD_PP`, 1.5): a collateralized loan to fund a trading
 * book should not cost more than emergency liquidity for a bank that cannot
 * fund itself.
 */
export const DISCOUNT_WINDOW_SPREAD_PP = 3;

/**
 * Ceiling on outstanding window debt, as a share of the bank's deposit base.
 * The window is a bridge across a liquidity shortfall, not a funding source: a
 * bank that needs more than this is not illiquid, it is insolvent, and the
 * resolution path is the right answer rather than a bigger loan.
 */
export const DISCOUNT_WINDOW_CAP_FRACTION = 0.25;

/** Confidence subtracted per unit of the cap actually drawn (0..1 scale). */
export const DISCOUNT_WINDOW_STIGMA = 0.1;

export type DiscountWindowDenial =
  | "not_deposit_taking"
  | "charter_inactive"
  | "no_deposits"
  | "cap_exhausted"
  | "invalid_amount";

export interface DiscountWindowQuote {
  /** Maximum outstanding debt this bank may carry. */
  capAnchor: number;
  /** How much more it may draw right now. */
  headroomAnchor: number;
  ratePercent: number;
}

/** Rate charged on window borrowing: prime plus the penalty. */
export function discountWindowRatePercent(primeRate: number): number {
  const prime = Number.isFinite(primeRate) ? primeRate : 0;
  return Math.max(0, prime + DISCOUNT_WINDOW_SPREAD_PP);
}

export function quoteDiscountWindow(
  charter: Pick<BankCharter, "totalDeposits" | "discountWindowDebt">,
  primeRate: number
): DiscountWindowQuote {
  const deposits = Math.max(0, charter.totalDeposits ?? 0);
  const outstanding = Math.max(0, charter.discountWindowDebt ?? 0);
  const capAnchor = deposits * DISCOUNT_WINDOW_CAP_FRACTION;
  return {
    capAnchor,
    headroomAnchor: Math.max(0, capAnchor - outstanding),
    ratePercent: discountWindowRatePercent(primeRate),
  };
}

/**
 * May this bank draw `amount`, and if not, why?
 *
 * Investment charters are refused: the window exists to protect DEPOSITORS,
 * and an investment bank has none. Its facility is the collateralized margin
 * line, which is what that line is for.
 */
export function canDraw(
  charter: Pick<BankCharter, "type" | "status" | "totalDeposits" | "discountWindowDebt">,
  amount: number,
  primeRate: number
): { ok: true; quote: DiscountWindowQuote } | { ok: false; reason: DiscountWindowDenial } {
  if (charter.status !== "active") return { ok: false, reason: "charter_inactive" };
  if (charter.type === "investment") return { ok: false, reason: "not_deposit_taking" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "invalid_amount" };

  const quote = quoteDiscountWindow(charter, primeRate);
  if (quote.capAnchor <= 0) return { ok: false, reason: "no_deposits" };
  if (amount > quote.headroomAnchor) return { ok: false, reason: "cap_exhausted" };
  return { ok: true, quote };
}

/**
 * Confidence penalty for a bank's current window usage, on the same 0..1 scale
 * `computeConfidence` produces.
 *
 * Scales with how much of the cap is drawn, not with the raw amount: a small
 * bank borrowing its whole capacity is in more trouble than a large one drawing
 * the same ₳ against a much bigger book.
 */
export function discountWindowStigma(
  charter: Pick<BankCharter, "totalDeposits" | "discountWindowDebt">
): number {
  const outstanding = Math.max(0, charter.discountWindowDebt ?? 0);
  if (outstanding <= 0) return 0;
  const cap = Math.max(0, charter.totalDeposits ?? 0) * DISCOUNT_WINDOW_CAP_FRACTION;
  if (cap <= 0) return DISCOUNT_WINDOW_STIGMA;
  const usage = Math.min(1, outstanding / cap);
  return DISCOUNT_WINDOW_STIGMA * usage;
}
