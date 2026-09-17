/**
 * Bank-NAV floor for hostile-takeover squeeze-out pricing (issue #1750).
 *
 * The quoted share price recognizes only BANK_EQUITY_VALUATION_WEIGHT of a
 * subsidiary bank's book equity, so a bank-heavy target can be squeezed out
 * for less than the realizable bank net assets the acquirer inherits
 * (ring-fenced cash plus loans, net of cash-backed deposits and borrowings).
 * These pure helpers floor the per-share consideration at full authoritative
 * book equity per share, so the implied whole-corp value can never underprice
 * the bank the deal delivers.
 *
 * Rules zone: plain data in, plain data out. No DB, clock, randomness, env.
 */

export interface BankNavFloorInput {
  /**
   * Authoritative bank book equity (bankEquity(), charter currency normalized
   * to anchor by the caller). May be negative; negative equity never floors.
   */
  bankBookEquityAnchor: number;
  /** Fully-diluted share count. Must be > 0 for a floor to apply. */
  totalShares: number;
}

/**
 * Full realizable bank net assets per share, in anchor. Zero when the bank is
 * at or below water, the share count is unusable, or either input is not
 * finite: a missing floor fails open to the market price, never to zero.
 */
export function bankNavFloorPerShareAnchor(input: BankNavFloorInput): number {
  const equity = input.bankBookEquityAnchor;
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
