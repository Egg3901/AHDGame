/**
 * Corporate credit ratings combine leverage, interest coverage, profit and liquidity.
 * calculateCorporateCreditScore uses supplied weights and thresholds; optional
 * maturity coverage constrains liquidity before smoothing and default adjustments.
 */
import type { CreditRating } from "@/lib/db/types/centralBank";

export interface CorporateCreditScorePolicy {
  weights: {
    debtToEquity: number;
    interestCoverage: number;
    profitability: number;
    liquidity: number;
  };
  thresholds: readonly (readonly [number, CreditRating])[];
  ratings: readonly CreditRating[];
}

export function calculateCorporateCreditScore(
  liquidCapital: number,
  totalDebt: number,
  annualIncome: number,
  annualInterestPayments: number,
  totalEquity: number,
  options:
    | {
        /** Percentage of forecast near-term debt service covered, bounded from zero to 100. */
        nearTermLiquidityScore?: number;
        bondDefaultCreditPenaltyActive?: boolean;
        previousCompositeScore?: number;
        /**
         * The composite the turn already wrote. Used verbatim, no smoothing.
         * Read-only surfaces pass this so they report the score the turn persisted
         * rather than blending it a second time (ticket #1138).
         */
        persistedCompositeScore?: number;
        /** One-notch downgrade for insider concentration >65% on public corps. */
        insiderConcentrationPenalty?: boolean;
        /**
         * One-notch UPGRADE for a corp whose shares are meaningfully held by index
         * funds (suggestion #62). The mirror of the concentration penalty: a broad,
         * sticky passive holder base is cheaper capital. Nets against it - a corp
         * that is both insider-concentrated and index-held ends where it started.
         */
        indexInclusionUpgrade?: boolean;
      }
    | undefined,
  policy: CorporateCreditScorePolicy
): {
  rating: CreditRating;
  compositeScore: number;
  components: {
    debtToEquity: number;
    interestCoverage: number;
    profitability: number;
    liquidity: number;
  };
} {
  // 1. Debt-to-equity ratio score (lower ratio = better)
  // D/E of 0 → 100, D/E of 1 → 66.7, D/E of 3+ → 0
  const deRatio = totalEquity > 0 ? totalDebt / totalEquity : totalDebt > 0 ? 10 : 0;
  const debtToEquity = Math.max(0, Math.min(100, 100 - (deRatio / 3) * 100));

  // 2. Interest coverage ratio score (higher coverage = better)
  // Coverage 5x+ → 100, 1x → 20, zero or negative → 0
  const coverage =
    annualInterestPayments > 0 ? annualIncome / annualInterestPayments : annualIncome > 0 ? 10 : 5; // No debt = good coverage
  const interestCoverage = Math.max(0, Math.min(100, coverage * 20));

  // 3. Profitability score (positive income relative to equity)
  // ROE about 17.1%+ → 100, 0% → 40, deeply negative → 5
  // Uses a gentler curve for losses: small deficits don't crater the score
  const roe = totalEquity > 0 ? annualIncome / totalEquity : 0;
  let profitability: number;
  if (roe >= 0) {
    // Positive ROE: 40 baseline + linear climb to 100 at ~17% ROE
    profitability = Math.min(100, 40 + roe * 350);
  } else {
    // Negative ROE: gentle decline from 40 using sqrt curve
    // ROE -5% → ~29, ROE -20% → ~18, ROE -50% → 5
    const lossMagnitude = Math.min(Math.abs(roe), 1); // cap at -100%
    profitability = Math.max(5, 40 - 50 * Math.sqrt(lossMagnitude));
  }

  // 4. Liquidity score (cash relative to short-term obligations)
  // Cash covers 2x+ annual interest → 100, 1x → 60, 0x → 20
  const liquidityRatio =
    annualInterestPayments > 0 ? liquidCapital / annualInterestPayments : liquidCapital > 0 ? 5 : 0;
  const couponLiquidity = Math.max(0, Math.min(100, 20 + liquidityRatio * 40));
  const liquidity =
    options?.nearTermLiquidityScore != null && Number.isFinite(options.nearTermLiquidityScore)
      ? Math.min(couponLiquidity, Math.max(0, Math.min(100, options.nearTermLiquidityScore)))
      : couponLiquidity;

  // Weighted composite (raw, before smoothing)
  const rawComposite = Math.round(
    debtToEquity * policy.weights.debtToEquity +
      interestCoverage * policy.weights.interestCoverage +
      profitability * policy.weights.profitability +
      liquidity * policy.weights.liquidity
  );

  // Inertia smoothing: blend 75% new + 25% previous to prevent single-turn score nuking.
  // Real credit agencies use trailing multi-quarter data - this approximates that lag.
  //
  // Ticket #1138: smoothing is a TURN-TIME mechanic. The turn blends against the
  // previous snapshot and then PERSISTS the result. A read-only surface that passes
  // the persisted value back in as `previousCompositeScore` blends a second time
  // against an already-blended number, so it reports a score the turn never wrote.
  // That is why one corp showed AA / 76 on the bonds panel (0.75 x 85 + 0.25 x 47)
  // while its header, health card and peer stats all read the stored 47 / BBB.
  // Display surfaces must pass `persistedCompositeScore` instead, which is used
  // verbatim. Only the turn may smooth.
  let compositeScore: number;
  if (options?.persistedCompositeScore != null && options.persistedCompositeScore > 0) {
    compositeScore = Math.round(options.persistedCompositeScore);
  } else if (options?.previousCompositeScore != null && options.previousCompositeScore > 0) {
    compositeScore = Math.round(0.75 * rawComposite + 0.25 * options.previousCompositeScore);
  } else {
    compositeScore = rawComposite;
  }

  // Map to letter rating
  let rating: CreditRating = "CCC";
  for (const [threshold, grade] of policy.thresholds) {
    if (compositeScore >= threshold) {
      rating = grade;
      break;
    }
  }

  if (options?.bondDefaultCreditPenaltyActive) {
    // A live default overrides everything, including index inclusion. Passive
    // funds holding your stock does not make you a good credit after you have
    // missed a coupon.
    rating = "CCC";
    compositeScore = Math.min(compositeScore, 12);
  } else {
    // Net the notch adjustments so the two never double-apply in sequence.
    // policy.ratings runs best → worst, so +1 index = one step toward the front.
    const notches =
      (options?.insiderConcentrationPenalty ? 1 : 0) - (options?.indexInclusionUpgrade ? 1 : 0);
    if (notches !== 0) {
      const idx = policy.ratings.indexOf(rating);
      if (idx >= 0) {
        const next = Math.max(0, Math.min(policy.ratings.length - 1, idx + notches));
        rating = policy.ratings[next];
      }
    }
  }

  return {
    rating,
    compositeScore,
    components: {
      debtToEquity: Math.round(debtToEquity),
      interestCoverage: Math.round(interestCoverage),
      profitability: Math.round(profitability),
      liquidity: Math.round(liquidity),
    },
  };
}
