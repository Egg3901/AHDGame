/**
 * Bank-NAV floor for hostile-takeover squeeze-out pricing (issue #1750).
 *
 * The quoted share price recognizes only BANK_EQUITY_VALUATION_WEIGHT of a
 * subsidiary bank's book equity, so a bank-heavy target can be squeezed out
 * for less than the realizable bank net assets the acquirer inherits
 * (ring-fenced cash plus loans plus the marked bond/prop book, net of
 * cash-backed deposits and borrowings). These pure helpers floor the
 * per-share consideration at full realizable NAV per share, so the implied
 * whole-corp value can never underprice the bank the deal delivers.
 *
 * Rules zone: plain data in, plain data out. No DB, clock, randomness, env.
 */

import {
  bankEquity,
  type BalanceSheetCharter,
  type BalanceSheetOptions,
} from "@/lib/banking/balanceSheet";

/**
 * Realizable bank NAV a takeover acquirer inherits, in charter currency.
 *
 * `bankEquity()` deliberately excludes the marked prop book: marks move with
 * the market, so the distribution gate must not let an owner upstream cash
 * against them. A takeover is the other side of that trade. It moves the
 * whole charter (cash, loan book AND prop book) to the acquirer, and the
 * supervision revoke path unwinds the book to cash at exactly this mark, so
 * the marked book is realizable value the buyer receives and the floor must
 * count it. Counted exactly once: prop buys debit `cashReserves` into the
 * mark, so cash and mark never overlap and adding the mark to `bankEquity()`
 * counts each dollar one time. All of `bankEquity()`'s liability netting
 * (cash-backed deposits, every borrowing facility) still applies.
 *
 * Malformed marks (missing, non-numeric, non-finite, negative) contribute
 * zero: a corrupt cache must shrink the floor, never invent value.
 */
export function takeoverBankNav(
  charter: BalanceSheetCharter | null | undefined,
  options: BalanceSheetOptions = {}
): number {
  const mark = charter?.propBookMarkValue;
  const markedBook = typeof mark === "number" && Number.isFinite(mark) ? Math.max(0, mark) : 0;
  return bankEquity(charter, options) + markedBook;
}

export interface BankNavFloorInput {
  /**
   * Realizable bank NAV (takeoverBankNav(), charter currency normalized to
   * anchor by the caller). May be negative; negative NAV never floors.
   */
  bankNavAnchor: number;
  /** Fully-diluted share count. Must be > 0 for a floor to apply. */
  totalShares: number;
}

/**
 * Full realizable bank net assets per share, in anchor. Zero when the bank is
 * at or below water, the share count is unusable, or either input is not
 * finite: a missing floor fails open to the market price, never to zero.
 */
export function bankNavFloorPerShareAnchor(input: BankNavFloorInput): number {
  const equity = input.bankNavAnchor;
  const shares = input.totalShares;
  if (!Number.isFinite(equity) || !Number.isFinite(shares) || shares <= 0) return 0;
  if (equity <= 0) return 0;
  return equity / shares;
}

export interface AppliedTakeoverPrice {
  pricePerShareAnchor: number;
  floorApplied: boolean;
}

/**
 * Take the greater of the premium market price and the bank-NAV floor.
 * A non-finite market print falls back to a positive floor so a corrupt share
 * price can never zero-out a bank-backed squeeze-out; otherwise the market
 * price (with its takeover premium) passes through untouched.
 */
export function applyBankNavFloor(
  marketPricePerShareAnchor: number,
  floorPerShareAnchor: number
): AppliedTakeoverPrice {
  const floorUsable = Number.isFinite(floorPerShareAnchor) && floorPerShareAnchor > 0;
  if (!Number.isFinite(marketPricePerShareAnchor)) {
    if (floorUsable) return { pricePerShareAnchor: floorPerShareAnchor, floorApplied: true };
    return { pricePerShareAnchor: marketPricePerShareAnchor, floorApplied: false };
  }
  if (floorUsable && floorPerShareAnchor > marketPricePerShareAnchor) {
    return { pricePerShareAnchor: floorPerShareAnchor, floorApplied: true };
  }
  return { pricePerShareAnchor: marketPricePerShareAnchor, floorApplied: false };
}
