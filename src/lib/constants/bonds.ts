/**
 * Corporate bonds: credit ratings, coupon rates and bond prices. calculateCreditScore
 * weighs debt to equity (30%), interest coverage (25%), profitability (25%) and
 * liquidity (20%) into AAA through CCC (CREDIT_RATING_THRESHOLDS). The coupon is
 * prime + rating spread + 1 point + a term premium (getBondCouponRate). Issuance is
 * capped at 2x equity with a 24 turn cooldown; a default hurts credit for 96 turns
 * (BOND_DEFAULT_CREDIT_PENALTY_TURNS). Rising rates lower bond prices (calculateBondMarketPrice).
 */
/**
 * Bond system constants.
 * Credit rating calculation, coupon constraints, and market pricing.
 */

import type { CreditRating } from "@/lib/db/types/centralBank";
import { CREDIT_RATING_SPREADS, CREDIT_RATINGS } from "@/lib/db/types/centralBank";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { BondMaturityTurns } from "@/lib/db/types/bond";

/**
 * Extra percentage points added to tier credit spreads for **corporate** bond coupons only.
 * Sovereign/treasury issuance uses prime alone — see `issueSovereignBondSeries`.
 */
export const CORPORATE_BOND_SPREAD_PREMIUM = 1.0;

/** Term premium added to corporate bond coupon for locking up capital longer. */
export const CORPORATE_BOND_TERM_PREMIUMS: Record<BondMaturityTurns, number> = {
  48: 0,
  96: 0,
  240: 1.0,
  336: 1.75,
};

/**
 * Launch-window bond freeze. Corporate bond issuance is blocked until this
 * instant to keep the opening days from being dominated by debt-fuelled
 * expansion, giving small corps an easier start. Anchored 4 days from the
 * 2026-08-08 world switch-on; auto-expires with no follow-up deploy needed.
 * Set to null (or a past date) to lift the freeze.
 */
export const BOND_ISSUANCE_FREEZE_UNTIL: Date | null = new Date("2026-08-12T00:00:00Z");

// ── Bond issuance constants ──────────────────────────────────────────────────

/** Minimum face value for a bond issuance ($) */
export const MIN_BOND_ISSUANCE = 100_000;

/**
 * Absolute floor on a corporation's issuance headroom (₳) below which bonds are
 * unavailable at all. The `MIN_BOND_ISSUANCE` minimum is otherwise clamped down
 * to a corp's own ceiling, so a small corp can issue below ₳100,000 rather than
 * being locked out when its 2x-equity headroom sits under the flat minimum
 * (ticket #1083). This floor keeps dust-sized issuances (with their coupon
 * overhead) off the table.
 */
export const BOND_ISSUANCE_MIN_HEADROOM = 10_000;

/** Maximum face value per issuance as fraction of liquid capital */
export const MAX_BOND_ISSUANCE_FRACTION = 2.0;

/**
 * Hard cap on total debt as a multiple of EXIT equity — what a corp's balance
 * sheet would actually realize if the debt had to be settled today (see
 * {@link import("@/lib/bonds/corpExitEquity").corpExitEquityAnchor}).
 *
 * `MAX_BOND_ISSUANCE_FRACTION` above measures the going-concern equity a corp
 * is worth as a living business; this one measures what its creditors could
 * recover. Under `marketSystemMode: "plants"` the two diverge sharply, and
 * before ticket #1198 only the first was enforced at issuance while only the
 * second was enforced by `filterInsolventCorps` — so a corp could be sold a
 * debt ceiling ~75x larger than the one that could liquidate it. Corporation
 * #624 drew under 1% of its quoted ceiling and was declared insolvent two turns
 * later.
 *
 * At 1.0 the invariant is exact: `debt <= exit equity`, so a corp that stays
 * inside its quoted ceiling can never be judged insolvent. Raising this above
 * 1.0 reopens that gap by precisely the amount it is raised.
 */
export const MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION = 1.0;

/**
 * The issuance window a corporation may actually use, all in ₳. `maxAllowed` is
 * the smallest of the per-issuance cap, the remaining 2x going-concern leverage
 * headroom, and the remaining 1x exit-equity headroom (#1198).
 * `effectiveMin` clamps the flat `MIN_BOND_ISSUANCE` down to that
 * ceiling so a small corp is never locked out by min > max (ticket #1083).
 * `available` is false below the dust floor, where bonds are offered at all.
 * `limitedBy` names the binding constraint so callers can explain a refusal in
 * the terms that actually caused it.
 */
export function effectiveBondIssuanceWindow(args: {
  maxPerIssuance: number;
  totalEquity: number;
  existingDebt: number;
  /** Realizable equity on the exit basis, ₳. */
  exitEquity: number;
}): {
  maxAllowed: number;
  effectiveMin: number;
  available: boolean;
  limitedBy: "perIssuance" | "leverage" | "exitEquity";
} {
  const debtCeilingHeadroom = args.totalEquity * MAX_BOND_ISSUANCE_FRACTION - args.existingDebt;
  const exitCeilingHeadroom =
    args.exitEquity * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION - args.existingDebt;
  const maxAllowed = Math.max(
    0,
    Math.min(args.maxPerIssuance, debtCeilingHeadroom, exitCeilingHeadroom)
  );
  // Ties resolve to the more explanatory constraint: exit equity is the one a
  // CEO has never seen before, so it is named whenever it is (jointly) binding.
  const limitedBy =
    exitCeilingHeadroom <= debtCeilingHeadroom && exitCeilingHeadroom <= args.maxPerIssuance
      ? "exitEquity"
      : debtCeilingHeadroom <= args.maxPerIssuance
        ? "leverage"
        : "perIssuance";
  const available = maxAllowed >= BOND_ISSUANCE_MIN_HEADROOM;
  const effectiveMin = Math.min(MIN_BOND_ISSUANCE, maxAllowed);
  return { maxAllowed, effectiveMin, available, limitedBy };
}

/** Per-issuance cap as a fraction of annual revenue (25%) */
export const MAX_BOND_ISSUANCE_REVENUE_FRACTION = 0.25;

/** Minimum per-issuance cap regardless of revenue (floor at $500M) */
export const MIN_BOND_ISSUANCE_PER_ISSUE = 500_000_000;

/** Cooldown between bond issuances for public corporations (24 hours = 24 turns). */
export const BOND_ISSUANCE_COOLDOWN_TURNS = 24;

/** Reduced cooldown for private corporations (12 hours = 12 turns). */
export const BOND_ISSUANCE_COOLDOWN_TURNS_PRIVATE = 12;

/**
 * A former CEO cannot buy their old corporation's bonds for this many turns
 * after leaving the seat. Closes the "vacate CEO → buy own bonds" loophole.
 * Internal — the duration is never surfaced in player-facing messages.
 */
export const EX_CEO_BOND_PURCHASE_BLOCK_TURNS = 120;

/**
 * Issuer reminder turns before maturity (1 turn = 1 in-game week; 48 turns/year).
 * Two reminders — ~3 months and ~1 month out — so CEOs can plan liquidity before
 * principal is debited from cash on hand.
 */
export const CORP_BOND_DUE_SOON_REMINDER_TURNS: readonly number[] = [12, 4];

/**
 * After a corporate bond default, credit rating is floored for this many turns
 * (1 turn = 1 real hour; 96 turns = 4 real days / 2 game years).
 */
export const BOND_DEFAULT_CREDIT_PENALTY_TURNS = 96;

/**
 * Maximum number of times a corporation can refinance defaulted debt over its lifetime.
 * Prevents the default → refi → cash injection → default exploit loop. After this cap
 * is reached, dissolution is the only remaining option for defaulted debt.
 */
export const MAX_BOND_DEFAULT_REFINANCES = 2;

/** Each bond unit = $1,000 face value */
export const BOND_UNIT_FACE_VALUE = 1_000;

// ── Credit rating thresholds ─────────────────────────────────────────────────

/**
 * Corporate credit rating is a composite of four financial health metrics.
 * Each metric scores 0-100, weighted and combined into a composite score.
 * The composite maps to a letter rating (AAA through CCC).
 */

/** Weight of each component in composite score */
export const CREDIT_RATING_WEIGHTS = {
  debtToEquity: 0.3,
  interestCoverage: 0.25,
  profitability: 0.25,
  liquidity: 0.2,
} as const;

/** Composite score thresholds for each rating tier */
export const CREDIT_RATING_THRESHOLDS: [number, CreditRating][] = [
  [85, "AAA"],
  [70, "AA"],
  [55, "A"],
  [40, "BBB"],
  [25, "BB"],
  [15, "B"],
  [0, "CCC"],
];

/**
 * Calculate composite credit score from financial metrics.
 *
 * @param liquidCapital - Corporation's cash on hand
 * @param totalDebt - Sum of outstanding bond face values
 * @param annualIncome - Per-turn income × TURNS_PER_YEAR
 * @param annualInterestPayments - Annual coupon obligations
 * @param totalEquity - Balance sheet equity (liquidCapital + sector NPVs)
 */
export function calculateCreditScore(
  liquidCapital: number,
  totalDebt: number,
  annualIncome: number,
  annualInterestPayments: number,
  totalEquity: number,
  options?: {
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
     * sticky passive holder base is cheaper capital. Nets against it — a corp
     * that is both insider-concentrated and index-held ends where it started.
     */
    indexInclusionUpgrade?: boolean;
  }
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
  // D/E of 0 → 100, D/E of 1 → 60, D/E of 3+ → 0
  const deRatio = totalEquity > 0 ? totalDebt / totalEquity : totalDebt > 0 ? 10 : 0;
  const debtToEquity = Math.max(0, Math.min(100, 100 - (deRatio / 3) * 100));

  // 2. Interest coverage ratio score (higher coverage = better)
  // Coverage 5x+ → 100, 1x → 40, 0x → 0
  // Negative income softened: floor at -2x instead of hard zero
  const coverage =
    annualInterestPayments > 0 ? annualIncome / annualInterestPayments : annualIncome > 0 ? 10 : 5; // No debt = good coverage
  const interestCoverage = Math.max(0, Math.min(100, coverage * 20));

  // 3. Profitability score (positive income relative to equity)
  // ROE 20%+ → 100, 0% → 40, deeply negative → 5
  // Uses a gentler curve for losses: small deficits don't crater the score
  const roe = totalEquity > 0 ? annualIncome / totalEquity : 0;
  let profitability: number;
  if (roe >= 0) {
    // Positive ROE: 40 baseline + linear climb to 100 at ~17% ROE
    profitability = Math.min(100, 40 + roe * 350);
  } else {
    // Negative ROE: gentle decline from 40 using sqrt curve
    // ROE -5% → ~32, ROE -20% → ~20, ROE -50% → ~10
    const lossMagnitude = Math.min(Math.abs(roe), 1); // cap at -100%
    profitability = Math.max(5, 40 - 50 * Math.sqrt(lossMagnitude));
  }

  // 4. Liquidity score (cash relative to short-term obligations)
  // Cash covers 2x+ annual interest → 100, 1x → 70, 0x → 20
  const liquidityRatio =
    annualInterestPayments > 0 ? liquidCapital / annualInterestPayments : liquidCapital > 0 ? 5 : 0;
  const liquidity = Math.max(0, Math.min(100, 20 + liquidityRatio * 40));

  // Weighted composite (raw, before smoothing)
  const rawComposite = Math.round(
    debtToEquity * CREDIT_RATING_WEIGHTS.debtToEquity +
      interestCoverage * CREDIT_RATING_WEIGHTS.interestCoverage +
      profitability * CREDIT_RATING_WEIGHTS.profitability +
      liquidity * CREDIT_RATING_WEIGHTS.liquidity
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
  for (const [threshold, grade] of CREDIT_RATING_THRESHOLDS) {
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
    // CREDIT_RATINGS runs best → worst, so +1 index = one step toward the front.
    const notches =
      (options?.insiderConcentrationPenalty ? 1 : 0) - (options?.indexInclusionUpgrade ? 1 : 0);
    if (notches !== 0) {
      const idx = CREDIT_RATINGS.indexOf(rating);
      if (idx >= 0) {
        const next = Math.max(0, Math.min(CREDIT_RATINGS.length - 1, idx + notches));
        rating = CREDIT_RATINGS[next];
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

/**
 * Get the effective coupon rate for a **corporate** bond issuance.
 * couponRate = primeRate + tierSpread + CORPORATE_BOND_SPREAD_PREMIUM + termPremium
 *
 * `maturityTurns` is optional — omit it for display/what-if contexts that have
 * no specific duration in scope (gives the 2yr base rate, i.e. zero term premium).
 */
export function getBondCouponRate(
  primeRate: number,
  creditRating: CreditRating,
  maturityTurns?: BondMaturityTurns
): number {
  const termPremium =
    maturityTurns != null ? (CORPORATE_BOND_TERM_PREMIUMS[maturityTurns] ?? 0) : 0;
  return (
    Math.round(
      (primeRate +
        CREDIT_RATING_SPREADS[creditRating] +
        CORPORATE_BOND_SPREAD_PREMIUM +
        termPremium) *
        100
    ) / 100
  );
}

// ── Bond market price fluctuation ────────────────────────────────────────────

/**
 * Calculate bond market price based on current rates and time to maturity.
 * Price is expressed as fraction of face value (1.0 = par).
 *
 * When interest rates rise, existing bond prices fall (and vice versa).
 * As bonds approach maturity, price converges to par (pull-to-par).
 *
 * @param couponRate - Bond's fixed coupon rate (annual %)
 * @param currentRate - Current effective rate for this credit tier (annual %)
 * @param turnsRemaining - Turns until maturity
 * @param defaulted - Whether the bond is in default
 */
export function calculateBondMarketPrice(
  couponRate: number,
  currentRate: number,
  turnsRemaining: number,
  defaulted: boolean
): number {
  if (defaulted) return 0.1; // Recovery value: 10 cents on the dollar

  if (turnsRemaining <= 0) return 1.0; // At maturity, price = par

  const yearsRemaining = turnsRemaining / TURNS_PER_YEAR;

  // Simplified bond pricing: present value of coupons + present value of par
  // Using annual compounding for simplicity
  const r = currentRate / 100; // Convert % to decimal
  const c = couponRate / 100;

  if (r <= 0) return 1.0 + c * yearsRemaining; // Zero/negative rates: par + all remaining coupons

  // PV of coupon annuity + PV of face value
  const discountFactor = Math.pow(1 + r, -yearsRemaining);
  const annuityFactor = (1 - discountFactor) / r;
  const price = c * annuityFactor + discountFactor;

  // Clamp to reasonable range
  return Math.max(0.05, Math.min(2.0, Math.round(price * 10000) / 10000));
}

/**
 * Approximate yield-to-maturity as an annual percent using the normalized
 * bond fields stored in Mongo: coupon rate in percent and market price as a
 * fraction of par. Every UI/API surface should call this helper so identical
 * bond data cannot render different yields.
 */
export function calculateBondYieldToMaturityPercent(
  couponRate: number,
  marketPrice: number,
  turnsRemaining: number
): number {
  if (marketPrice <= 0 || turnsRemaining <= 0) return 0;

  const yearsRemaining = turnsRemaining / TURNS_PER_YEAR;
  if (yearsRemaining <= 0) return 0;

  return ((couponRate / 100 + (1 - marketPrice) / yearsRemaining) / marketPrice) * 100;
}

/**
 * Per-turn coupon payment per bond unit.
 * Annual coupon / TURNS_PER_YEAR.
 */
/**
 * Per-turn coupon payment for a single bond unit: annual coupon amortized
 * over TURNS_PER_YEAR game-weeks.
 *
 * **Unit contract:** output is in the same unit as `faceValue`. When called
 * with `BOND_UNIT_FACE_VALUE` (v0.2.6+), output is in the bond's LOCAL
 * currency (per `bond.currencyCode`). Multiply by `holder.units` → LOCAL
 * total payment. Callers feeding this into ₳-expecting APIs must first
 * anchor-normalize via `corpCapitalToAnchor(value, bond.currencyCode,
 * fxRate)`. See BOND_UNIT_FACE_VALUE's docstring for the governing convention.
 */
export function perTurnCouponPayment(couponRate: number, faceValue: number): number {
  return ((couponRate / 100) * faceValue) / TURNS_PER_YEAR;
}
