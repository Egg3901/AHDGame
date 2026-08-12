import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/**
 * A8: a union's occupational pension scheme.
 *
 * One scheme per union, created the first time an agreement is settled with a
 * contribution rate above zero. A union that has never bargained a pension has
 * no scheme document at all, rather than a row of zeroes: the absence is the
 * honest record that the union never won one.
 *
 * Assets are in ₳, like every other fund leg since the A0 currency SSOT fix.
 */
export interface PensionScheme {
  _id: ObjectId;
  unionId: ObjectId;
  countryId: CountryId;
  /** Denormalized for the surface; the union document stays the source of truth. */
  unionName: string;

  /**
   * CASH paid in by employers and not yet invested. Real money, never minted.
   *
   * Phase 2 note: this is no longer the whole of a scheme's assets. Once a
   * scheme invests, part of what it owns is index-fund units. Total assets are
   * `assetsAnchor + investedValueAnchor`, and every funding-ratio read must go
   * through `pensionSchemeAssetsAnchor` rather than touching this field
   * directly, or the ratio silently collapses the moment a scheme invests.
   */
  assetsAnchor: number;
  /**
   * Marked-to-market value of the scheme's index-fund units (₳), refreshed
   * every turn from the live positions. A CACHE of a derived number, kept on
   * the document so the union surface and the top-up rule read the same figure
   * the turn pass used. `indexFundPositions` stays the source of truth.
   */
  investedValueAnchor?: number;
  /** Cash the scheme has put into funds, cumulative. Not a valuation. */
  totalInvestedAnchor?: number;

  /** Claims accrued by covered workers. What the scheme has promised. */
  liabilitiesAnchor: number;
  /**
   * The slice of `liabilitiesAnchor` that has come into payment: claims of
   * covered workers who have retired. Carried separately because a claim in
   * payment is a call on cash THIS turn, while the rest is a promise for later.
   * Always <= liabilitiesAnchor.
   */
  benefitsInPaymentAnchor?: number;

  /** Running totals, so the surface can show where the assets came from. */
  totalContributionsAnchor: number;
  totalTopUpsAnchor: number;
  /** Benefits actually paid out, cumulative. */
  totalBenefitsPaidAnchor?: number;
  /**
   * Benefits that fell due and could not be paid, cumulative. The scheme never
   * mints to cover them, so this is the running record of the promise the
   * underfunding broke.
   */
  totalBenefitsUnpaidAnchor?: number;

  createdAtTurn: number;
  lastChargedTurn?: number;
  lastBenefitTurn?: number;
  /** Benefit cut applied last turn, 0..1. 0 means benefits were paid in full. */
  lastBenefitCutFraction?: number;

  createdAt: Date;
  updatedAt: Date;
}
