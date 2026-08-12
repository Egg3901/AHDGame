/**
 * C5 — transfer pricing.
 *
 * Supply agreements already carry a `pricePremium`: an agreed offset from the
 * market price, bounded to ±`SUPPLY_AGREEMENT_PRICE_BAND`. Between two
 * unrelated corporations that is a negotiation, and the band is what stops it
 * becoming a disguised gift.
 *
 * Between two members of the SAME GROUP it is something else. Both sides have
 * the same owner, so "agreement" is not a constraint at all, and the premium
 * becomes a dial for deciding which corporation books the profit. When those
 * corporations sit in different countries, that is a dial for deciding which
 * TREASURY collects the tax.
 *
 * That has been possible since supply agreements shipped. What was missing is
 * anybody noticing.
 *
 * ## Why this is deterministic
 *
 * No dice. Exposure accrues on the agreement, and the audit fires when the
 * accrued amount crosses a published threshold. A player can compute exactly
 * how long a given position survives, which makes aggressive pricing a
 * calculated risk rather than a slot machine. Same reasoning as the C3 review
 * bands and the B4 resolve clock.
 *
 * ## Why same-country pricing is ignored
 *
 * Shifting profit between two corporations taxed by the SAME treasury moves no
 * tax base — and C4 group relief already nets the two positions against each
 * other. There is nothing to audit.
 */

/** Cumulative shifted base (₳) on one agreement before the authority acts. */
export const TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR = 5_000_000;

/**
 * Surcharge on the reassessed tax, on top of paying what was owed. Without it,
 * an audit is a free option: shift profit, and in the worst case pay exactly
 * the tax you would have paid anyway, years later.
 */
export const TRANSFER_PRICING_PENALTY_RATE = 0.4;

/**
 * Premium magnitude below which a position is treated as arm's length. A
 * contract priced a little off market is ordinary commercial negotiation, not
 * a tax position, and auditing it would make every intra-group contract a
 * liability.
 */
export const ARMS_LENGTH_TOLERANCE = 0.05;

export interface IntraGroupPosition {
  agreementId: string;
  supplierCorpId: string;
  buyerCorpId: string;
  supplierCountryId: string;
  buyerCountryId: string;
  pricePremium: number;
  /** The ₳ premium that actually settled this turn (signed, supplier's view). */
  premiumAnchor: number;
}

export interface AuditAssessment {
  agreementId: string;
  /** The corporation that gained the profit and therefore owes the reassessment. */
  liableCorpId: string;
  /** The treasury that lost the tax base. */
  claimantCountryId: string;
  /** Cumulative base that was shifted out of the claimant country (₳). */
  shiftedBaseAnchor: number;
  /** Tax reassessed at arm's length, plus the surcharge (₳). */
  assessmentAnchor: number;
}

/**
 * Is this a transfer-pricing position at all?
 *
 * Three conditions, all necessary: the two parties are in the same group, they
 * are in different countries, and the price is not arm's length.
 */
export function isTransferPricingPosition(
  position: Pick<
    IntraGroupPosition,
    "supplierCountryId" | "buyerCountryId" | "pricePremium"
  >,
  sameGroup: boolean
): boolean {
  if (!sameGroup) return false;
  if (position.supplierCountryId === position.buyerCountryId) return false;
  return Math.abs(position.pricePremium) > ARMS_LENGTH_TOLERANCE;
}

/**
 * Which side gained, and which treasury lost, for one settled premium.
 *
 * A POSITIVE premium moves cash from buyer to supplier: profit lands in the
 * supplier's country, and the buyer's country loses the deduction-equivalent
 * base. A negative premium is the mirror image.
 */
export function shiftDirection(position: IntraGroupPosition): {
  gainerCorpId: string;
  claimantCountryId: string;
  shiftedBaseAnchor: number;
} | null {
  const magnitude = Math.abs(position.premiumAnchor);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  if (position.premiumAnchor > 0) {
    return {
      gainerCorpId: position.supplierCorpId,
      claimantCountryId: position.buyerCountryId,
      shiftedBaseAnchor: magnitude,
    };
  }
  return {
    gainerCorpId: position.buyerCorpId,
    claimantCountryId: position.supplierCountryId,
    shiftedBaseAnchor: magnitude,
  };
}

/**
 * Does accrued exposure trigger an audit, and what is assessed?
 *
 * `effectiveTaxRate` is the claimant country's corporate rate as a 0..1
 * fraction. Returns null below the threshold — exposure keeps accruing.
 */
export function assessIfDue(params: {
  agreementId: string;
  gainerCorpId: string;
  claimantCountryId: string;
  accruedExposureAnchor: number;
  effectiveTaxRate: number;
}): AuditAssessment | null {
  if (params.accruedExposureAnchor < TRANSFER_PRICING_AUDIT_THRESHOLD_ANCHOR) return null;
  if (!Number.isFinite(params.effectiveTaxRate) || params.effectiveTaxRate <= 0) return null;

  const reassessed = params.accruedExposureAnchor * params.effectiveTaxRate;
  const assessment = reassessed * (1 + TRANSFER_PRICING_PENALTY_RATE);
  if (!Number.isFinite(assessment) || assessment <= 0) return null;

  return {
    agreementId: params.agreementId,
    liableCorpId: params.gainerCorpId,
    claimantCountryId: params.claimantCountryId,
    shiftedBaseAnchor: params.accruedExposureAnchor,
    assessmentAnchor: Math.round(assessment),
  };
}
