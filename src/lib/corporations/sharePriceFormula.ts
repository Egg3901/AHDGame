/**
 * Three-component fundamental share-price formula.
 *
 * sharePrice = fundamentalValue × sentimentMultiplier × orderFlowMultiplier
 *
 * This module computes fundamentalValue only. Sentiment and order flow
 * multipliers are applied by the 15-minute price-update cron (Plan 2/3).
 *
 * Replaces the former 12-iteration cross-holdings convergence loop.
 * Cross-corp holdings now contribute via equity-method earnings adjustment
 * performed by the caller before constructing SharePriceInput.
 */
import {
  MIN_SHARE_PRICE,
  STOCK_SPLIT_PRICE_SMOOTHING_TURNS,
  STOCK_SPLIT_SMOOTHING_PREV_WEIGHT,
  FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT,
  FUNDAMENTAL_EARNINGS_POWER_WEIGHT,
  FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT,
  GROWTH_PREMIUM_CAP_BUFFER,
  BOND_INCOME_SHARE_PRICE_DISCOUNT,
  BOND_INCOME_RELIANCE_THRESHOLD,
  BOND_INCOME_MAX_RELIANCE_PENALTY,
  SHARE_PRICE_MAX_TURN_MOVE,
  SHARE_PRICE_RATE_LIMIT_MIN_PREV,
} from "@/lib/constants/corporations";
import { IMF_BAILOUT_SHARE_PRICE_MULTIPLIER } from "@/lib/imf/constants";
import { indexInclusionPriceMultiplier } from "@/lib/corporations/indexOwnership";

/** Per-corp inputs to the share-price formula. All monetary fields are ₳ (anchor). */
export interface SharePriceInput {
  corpId: string;
  /** liquidCapital normalized to ₳ (tangible-book numerator). */
  liquidCapitalAnchor: number;
  /** Sum of sector NPVs (₳). Added to liquidCapital for tangible book. */
  sectorNPVAnchor: number;
  /**
   * Σ outstanding construction-in-progress across the corp's sectors (₳, P3a).
   * Added to tangible book at full value: cash that left the corp and became a
   * half-built plant is still the shareholders' asset. Without this leg, a corp
   * mid-build reads as having burned its equity and the tangible-book floor —
   * plus the rate limiter that keys off it — punishes it for investing.
   * Absent/0 for every pre-P3a corp, so the formula is unchanged for them.
   */
  constructionInProgressAnchor?: number;
  /** Total issued bond debt (₳). Subtracted from liquidCapital for tangible book. */
  issuedBondDebt: number;
  /** Mark-to-market value of bonds + IMF receivables held by this corp (₳). Added to tangible book. */
  bondHoldingsAnchor: number;
  /**
   * 3-political-turn rolling average of annualised after-tax income (₳/year),
   * with equity-method additions from cross-corp holdings already applied.
   * Computed by the caller using earningsRollingAverage + applyEquityMethodEarnings.
   */
  normalizedEarningsAnchor: number;
  /**
   * Annualised bond-coupon income this corp earns as a holder (₳/year). This is
   * the bond-derived slice of {@link normalizedEarningsAnchor}; the formula
   * discounts it (interest-rate risk) and measures bond reliance from it.
   * Pass 0 for corps with no held bonds. Clamped internally to never exceed
   * total normalized earnings.
   */
  bondCouponEarningsAnchor: number;
  /**
   * Revenue-weighted average sector growth rate for this corp (as a decimal,
   * e.g. 0.05 = 5% per year).
   */
  sectorGrowthRate: number;
  /**
   * primeRate + SECTOR_RISK_PREMIUM[corp.type]. Pre-computed by caller.
   * Must be > 0; guarded inside the formula.
   */
  costOfCapital: number;
  totalShares: number;
  /** Previous share price — used only during the post-split smoothing cooldown. */
  previousSharePrice: number;
  imfBailoutActive: boolean;
  lastShareStructureTurn?: number | null;
  /**
   * CEO's share ownership as a fraction of totalShares (0–1). Only meaningful
   * for public corps with a character CEO; pass 0 for private/NPC/natcorps.
   * Used to compute the insider-concentration valuation discount.
   */
  ceoOwnershipFraction?: number;
  /**
   * Fraction of shares held by index funds (0–1), from
   * `indexFundOwnershipFraction`. Drives the index-inclusion price premium.
   */
  indexFundOwnershipFraction?: number;
  /** True when this is a private corporation — concentration penalty does not apply. */
  isPrivate?: boolean;
  /**
   * Decade-weighted value of all unlocked tech-tree nodes (₳). Computed from
   * unlockedTechNodeIds with 50% decay per decade back from the current game year.
   * Absent / 0 ⇒ no tech asset contribution.
   */
  techAssetValueAnchor?: number;
}

/**
 * Compute share prices for all corps. Returns corpId → price (₳, rounded to 2dp).
 * Pure: no DB writes, no mutation of inputs.
 */
export function computeSharePrices(
  inputs: SharePriceInput[],
  currentTurn: number
): Map<string, number> {
  const result = new Map<string, number>();

  for (const i of inputs) {
    // Bond-income interest-rate-risk adjustments.
    // Split normalized earnings into operating vs bond-coupon-derived, discount
    // the bond slice (0.75x), and measure reliance for the graduated penalty.
    // bondPortion is clamped to total earnings so operating earnings never go
    // negative when the (current-turn) coupon figure outruns the (rolling)
    // earnings average.
    const totalEarnings = Math.max(0, i.normalizedEarningsAnchor);
    const bondPortion = Math.min(Math.max(0, i.bondCouponEarningsAnchor), totalEarnings);
    const operatingEarnings = totalEarnings - bondPortion;
    const riskAdjustedEarnings = operatingEarnings + BOND_INCOME_SHARE_PRICE_DISCOUNT * bondPortion;
    const bondReliance = totalEarnings > 0 ? bondPortion / totalEarnings : 0;
    const reliancePenalty = bondRelianceValuationPenalty(bondReliance);

    // Component 1 — Tangible Book Per Share (liquidation floor).
    // Bond holdings are haircut (0.75x) for the same interest-rate / mark-to-
    // market risk that discounts coupon income above.
    // Tech assets are added at full face value — they represent the capitalized
    // value of unlocked R&D with decade-decay weighting applied upstream.
    const tangibleBook =
      i.liquidCapitalAnchor +
      i.sectorNPVAnchor +
      Math.max(0, i.constructionInProgressAnchor ?? 0) +
      (i.techAssetValueAnchor ?? 0) +
      BOND_INCOME_SHARE_PRICE_DISCOUNT * i.bondHoldingsAnchor -
      i.issuedBondDebt;
    const tangibleBookPerShare = i.totalShares > 0 ? Math.max(0, tangibleBook) / i.totalShares : 0;

    // Component 2 — Earnings Power Per Share (on risk-adjusted earnings)
    const earningsPowerPerShare =
      i.totalShares > 0 && i.costOfCapital > 0
        ? riskAdjustedEarnings / i.costOfCapital / i.totalShares
        : 0;

    // Component 3 — Growth Premium Per Share (Gordon Growth Model terminal value)
    const gCapped = Math.min(
      Math.max(0, i.sectorGrowthRate),
      i.costOfCapital - GROWTH_PREMIUM_CAP_BUFFER
    );
    const growthPremiumPerShare =
      i.totalShares > 0 && gCapped > 0 && i.costOfCapital > gCapped
        ? (riskAdjustedEarnings * gCapped) / (i.costOfCapital - gCapped) / i.totalShares
        : 0;

    // The graduated reliance penalty hits the income-derived components only —
    // the tangible-book floor already reflects the holdings haircut.
    const earningsComponent =
      (FUNDAMENTAL_EARNINGS_POWER_WEIGHT * earningsPowerPerShare +
        FUNDAMENTAL_GROWTH_PREMIUM_WEIGHT * growthPremiumPerShare) *
      reliancePenalty;

    const fundamentalValue =
      FUNDAMENTAL_TANGIBLE_BOOK_WEIGHT * tangibleBookPerShare + earningsComponent;

    // Post-split smoothing: bias toward the pre-computed split price for
    // STOCK_SPLIT_PRICE_SMOOTHING_TURNS turns so the new equilibrium is
    // reached gradually rather than in one snap.
    const turnsSinceSplit =
      i.lastShareStructureTurn != null ? currentTurn - i.lastShareStructureTurn : Infinity;
    const inSplitCooldown =
      turnsSinceSplit >= 0 && turnsSinceSplit <= STOCK_SPLIT_PRICE_SMOOTHING_TURNS;

    // Split-cooldown path has its own (stronger) smoothing; the per-turn rate
    // limiter only guards the normal fundamental path. Skipping the limiter in
    // cooldown avoids double-smoothing and keeps the split re-scaling intact.
    const rawPrice = inSplitCooldown
      ? STOCK_SPLIT_SMOOTHING_PREV_WEIGHT * i.previousSharePrice +
        (1 - STOCK_SPLIT_SMOOTHING_PREV_WEIGHT) * fundamentalValue
      : rateLimitPrice(fundamentalValue, i.previousSharePrice);

    // Insider-concentration discount: smooth quadratic penalty on public corps
    // where the character CEO holds > INSIDER_CONCENTRATION_THRESHOLD of all shares.
    // Ramps from 0% at the threshold to -30% at 100% ownership.
    const concentrationMultiplier = insiderConcentrationMultiplier(
      i.ceoOwnershipFraction ?? 0,
      i.isPrivate ?? false
    );

    // Index-inclusion premium (suggestion #62): the mirror of the concentration
    // discount. A broad passive holder base is a firmer bid under the stock, so
    // it earns a bounded premium. Private corps have no float for a fund to
    // hold, so they are exempt exactly as they are from the discount.
    const inclusionMultiplier =
      (i.isPrivate ?? false) ? 1 : indexInclusionPriceMultiplier(i.indexFundOwnershipFraction ?? 0);

    const clampedPrice = Math.max(
      MIN_SHARE_PRICE,
      Number.isFinite(rawPrice)
        ? rawPrice * concentrationMultiplier * inclusionMultiplier
        : MIN_SHARE_PRICE
    );
    const finalPrice = i.imfBailoutActive
      ? Math.round(clampedPrice * IMF_BAILOUT_SHARE_PRICE_MULTIPLIER * 100) / 100
      : Math.round(clampedPrice * 100) / 100;

    result.set(i.corpId, finalPrice);
  }

  return result;
}

/**
 * Per-turn share-price rate limiter (issue #2888).
 *
 * Clamps `rawPrice` to within ±{@link SHARE_PRICE_MAX_TURN_MOVE} of `prevPrice`
 * so the fundamental price can never jump/collapse more than 35% in a single
 * turn. This kills the equity knife-edge: when issued bond debt ≈ total assets,
 * the tangible-book floor flips through zero and the raw fundamental snaps ~200x
 * in one turn. The move direction is preserved and the price still converges to
 * the true fundamental, just over several turns.
 *
 * Two guards:
 *   - The caller must NOT apply this on the post-stock-split cooldown path (that
 *     path has its own stronger smoothing).
 *   - Skipped when `prevPrice <= {@link SHARE_PRICE_RATE_LIMIT_MIN_PREV}` ($1.00)
 *     so genuinely-recovering penny corps aren't pinned near the floor.
 */
export function rateLimitPrice(rawPrice: number, prevPrice: number): number {
  if (!Number.isFinite(rawPrice) || !Number.isFinite(prevPrice)) return rawPrice;
  if (prevPrice <= SHARE_PRICE_RATE_LIMIT_MIN_PREV) return rawPrice;
  const maxUp = prevPrice * (1 + SHARE_PRICE_MAX_TURN_MOVE);
  const maxDown = prevPrice * (1 - SHARE_PRICE_MAX_TURN_MOVE);
  return Math.min(maxUp, Math.max(maxDown, rawPrice));
}

/**
 * Insider-concentration share-price discount.
 *
 * Public corps where the character CEO personally holds more than
 * INSIDER_CONCENTRATION_THRESHOLD of all shares receive a quadratic price
 * penalty that reaches -30% at 100% CEO ownership.
 *
 * Private corps and non-character-CEO corps are exempt.
 */
export const INSIDER_CONCENTRATION_THRESHOLD = 0.65;
export const INSIDER_CONCENTRATION_MAX_PENALTY = 0.3;

export function insiderConcentrationMultiplier(
  ceoOwnershipFraction: number,
  isPrivate: boolean
): number {
  if (isPrivate || ceoOwnershipFraction <= INSIDER_CONCENTRATION_THRESHOLD) return 1;
  const span = 1 - INSIDER_CONCENTRATION_THRESHOLD;
  const over = Math.min(ceoOwnershipFraction, 1) - INSIDER_CONCENTRATION_THRESHOLD;
  const t = span > 0 ? over / span : 1;
  return 1 - INSIDER_CONCENTRATION_MAX_PENALTY * t * t;
}

/**
 * Graduated valuation penalty for over-reliance on bond-coupon income.
 *
 * Returns a multiplier in [{@link BOND_INCOME_MAX_RELIANCE_PENALTY}, 1]:
 *   - reliance ≤ {@link BOND_INCOME_RELIANCE_THRESHOLD} → 1.0 (no penalty)
 *   - ramps linearly to {@link BOND_INCOME_MAX_RELIANCE_PENALTY} at reliance = 1.0
 *
 * No cliff at the threshold, so a corp can't dodge the penalty by sitting just
 * under it. `reliance` is the bond-coupon share of normalized net income (0..1).
 */
export function bondRelianceValuationPenalty(reliance: number): number {
  if (!(reliance > BOND_INCOME_RELIANCE_THRESHOLD)) return 1;
  const span = 1 - BOND_INCOME_RELIANCE_THRESHOLD;
  const over = Math.min(reliance, 1) - BOND_INCOME_RELIANCE_THRESHOLD;
  const t = span > 0 ? over / span : 1;
  return 1 - t * (1 - BOND_INCOME_MAX_RELIANCE_PENALTY);
}
