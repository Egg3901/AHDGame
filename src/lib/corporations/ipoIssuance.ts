import { IPO_MAX_FLOAT_PCT, IPO_MIN_FLOAT_PCT } from "../constants/corporations";
import { SUPERSHARE_IPO_MAX_FLOAT_PCT } from "./superShares";

export interface IpoIssuanceInput {
  /** Founder/existing share count BEFORE the IPO (e.g. CEO_INITIAL_SHARES at founding) */
  existingShares: number;
  /** Per-share offering price in the corp's home currency */
  pricePerShare: number;
  /** Target free-float % of post-IPO totalShares (must be in [IPO_MIN_FLOAT_PCT, max float]) */
  floatPct: number;
  /**
   * True for a dual-class (supershare) IPO — raises the float cap to
   * SUPERSHARE_IPO_MAX_FLOAT_PCT since the founder keeps voting control.
   */
  withSuperShares?: boolean;
}

export interface IpoIssuanceResult {
  newShares: number;
  proceeds: number;
  totalSharesAfter: number;
  founderOwnershipPctAfter: number;
}

/**
 * Pure computation: given existing shares + offering price + target float %,
 * return how many new shares to issue, the cash raised, and the resulting cap table.
 *
 * Math: we want newShares / (existingShares + newShares) === floatPct / 100,
 * which solves to newShares = existingShares × floatPct / (100 − floatPct).
 * Floored so we never issue fractional shares; floor produces a slightly
 * lower-than-target float, which is acceptable.
 */
export function computeIpoIssuance(input: IpoIssuanceInput): IpoIssuanceResult {
  const { existingShares, pricePerShare, floatPct } = input;
  const maxFloatPct = input.withSuperShares ? SUPERSHARE_IPO_MAX_FLOAT_PCT : IPO_MAX_FLOAT_PCT;

  if (floatPct < IPO_MIN_FLOAT_PCT || floatPct > maxFloatPct) {
    throw new Error(`floatPct ${floatPct} out of range [${IPO_MIN_FLOAT_PCT}, ${maxFloatPct}]`);
  }
  if (!Number.isFinite(existingShares) || existingShares <= 0) {
    throw new Error(`existingShares must be positive, got ${existingShares}`);
  }
  if (!Number.isFinite(pricePerShare) || pricePerShare <= 0) {
    throw new Error(`pricePerShare must be positive, got ${pricePerShare}`);
  }

  const newShares = Math.floor((existingShares * floatPct) / (100 - floatPct));
  const proceeds = newShares * pricePerShare;
  const totalSharesAfter = existingShares + newShares;
  const founderOwnershipPctAfter = (existingShares / totalSharesAfter) * 100;

  return { newShares, proceeds, totalSharesAfter, founderOwnershipPctAfter };
}
