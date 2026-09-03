/**
 * Bond market pool quotes: what the pool bids for a unit and what it asks.
 *
 * `Bond.marketPrice` stays the rate-derived fair value (the mid) so every
 * valuation surface keeps reading one number. The pool trades around it:
 *
 *   bid = mid x (1 - halfSpread - skew)
 *   ask = mid x (1 + halfSpread - skew)
 *
 * The half spread is what a dealer keeps. The skew shifts BOTH sides down
 * when the pool wants cash more than paper: low cash against target, or a
 * sovereign issuer the demand model has little appetite for. A short pool
 * therefore pays sellers less and lets buyers in cheaper, which is how it
 * rebuilds cash. Pure: no database, no clock.
 */

import type { BondIssuerType } from "@/lib/db/types/bond";

/** Dealer half spread, as a fraction of the mid. */
export const BOND_POOL_HALF_SPREAD: Record<BondIssuerType, number> = {
  sovereign: 0.01,
  corporation: 0.02,
};

/** How hard a cash shortfall against target pushes the quote down (per unit of shortfall share). */
export const BOND_POOL_CASH_SKEW_RATE = 0.05;
/** Most the cash shortfall alone can move the quote. */
export const BOND_POOL_CASH_SKEW_CAP = 0.03;
/** How hard weak sovereign appetite (demand ratio below 1) pushes the quote down. */
export const BOND_POOL_APPETITE_SKEW_RATE = 0.05;
/** Appetite skew bounds: a strong issuer earns at most a slight lift, a weak one a real discount. */
export const BOND_POOL_APPETITE_SKEW_MIN = -0.01;
export const BOND_POOL_APPETITE_SKEW_MAX = 0.05;
/** Total skew bounds. */
export const BOND_POOL_SKEW_MIN = -0.01;
export const BOND_POOL_SKEW_MAX = 0.08;
/** Neutral appetite when the demand model has nothing to say (corporate paper, no snapshot). */
export const BOND_POOL_NEUTRAL_APPETITE = 1;

export interface BondPoolQuoteInput {
  /** Rate-derived fair value as a fraction of face (`Bond.marketPrice`). */
  marketPrice: number;
  issuerType: BondIssuerType;
  cashLocal: number;
  targetCashLocal: number;
  /** Sovereign demand ratio for the issuer country; 1 is neutral. */
  appetite?: number;
  /** A defaulted bond trades at recovery value with no dealer market. */
  defaulted?: boolean;
}

export interface BondPoolQuote {
  mid: number;
  bid: number;
  ask: number;
  halfSpread: number;
  cashSkew: number;
  appetiteSkew: number;
  skew: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function bondPoolCashSkew(cashLocal: number, targetCashLocal: number): number {
  if (!(targetCashLocal > 0)) return 0;
  const cash = Number.isFinite(cashLocal) && cashLocal > 0 ? cashLocal : 0;
  const shortfallShare = clamp((targetCashLocal - cash) / targetCashLocal, -1, 1);
  return clamp(
    shortfallShare * BOND_POOL_CASH_SKEW_RATE,
    -BOND_POOL_CASH_SKEW_CAP,
    BOND_POOL_CASH_SKEW_CAP
  );
}

export function bondPoolAppetiteSkew(appetite: number | undefined): number {
  const a = Number.isFinite(appetite) ? (appetite as number) : BOND_POOL_NEUTRAL_APPETITE;
  return clamp(
    (BOND_POOL_NEUTRAL_APPETITE - a) * BOND_POOL_APPETITE_SKEW_RATE,
    BOND_POOL_APPETITE_SKEW_MIN,
    BOND_POOL_APPETITE_SKEW_MAX
  );
}

export function quoteBondPrices(input: BondPoolQuoteInput): BondPoolQuote {
  const mid = Number.isFinite(input.marketPrice) && input.marketPrice > 0 ? input.marketPrice : 0;
  if (input.defaulted || mid <= 0) {
    return { mid, bid: mid, ask: mid, halfSpread: 0, cashSkew: 0, appetiteSkew: 0, skew: 0 };
  }
  const halfSpread = BOND_POOL_HALF_SPREAD[input.issuerType] ?? BOND_POOL_HALF_SPREAD.corporation;
  const cashSkew = bondPoolCashSkew(input.cashLocal, input.targetCashLocal);
  const appetiteSkew = input.issuerType === "sovereign" ? bondPoolAppetiteSkew(input.appetite) : 0;
  const skew = clamp(cashSkew + appetiteSkew, BOND_POOL_SKEW_MIN, BOND_POOL_SKEW_MAX);
  const bid = round4(Math.max(0.01, mid * (1 - halfSpread - skew)));
  const ask = round4(Math.max(bid, mid * (1 + halfSpread - skew)));
  return { mid, bid, ask, halfSpread, cashSkew, appetiteSkew, skew };
}
