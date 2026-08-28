import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { CorporationType } from "../../constants/corporations";

export type IndexFundScope = "country" | "global";
export type IndexFundKind = "broad" | "sector";
export type IndexFundStatus = "active" | "paused" | "winding_down" | "delisted";
export type IndexFundPauseReason = "manual" | "backing_ratio" | "constituent_delisted";

export interface IndexFundTargetConstituent {
  corporationId: ObjectId;
  /** Target portfolio weight, represented as a 0..1 fraction. */
  targetWeight: number;
  /** Constituent market cap converted to the fund anchor currency at weight-lock time. */
  marketCapAnchor: number;
}

/**
 * A7 listing standards: how many consecutive rebalances a corporation has
 * failed. Only failing corporations are carried; passing clears the record, and
 * a corporation that leaves the index's mandate entirely is dropped from the
 * list rather than kept at a stale count.
 */
export interface IndexFundListingFailureStreak {
  corporationId: ObjectId;
  consecutiveFailures: number;
  failures: string[];
}

export interface IndexFundHolding {
  corporationId: ObjectId;
  shares: number;
  avgCostPerShareAnchor?: number;
  /** Last observed holding value in the fund anchor currency. */
  lastValueAnchor?: number;
}

export interface IndexFundBondAllocation {
  countryId: CountryId;
  /** Anchor-currency principal allocated when stock float is not available. */
  principalAnchor: number;
  couponRate: number;
}

export interface IndexFund {
  _id: ObjectId;
  slug: string;
  name: string;
  tickerSymbol: string;
  scope: IndexFundScope;
  kind: IndexFundKind;
  /** Present for country-scoped funds. Omitted only for the global top-50 fund. */
  countryId?: CountryId;
  /** Present for sector funds. */
  sectorType?: CorporationType;
  anchorCurrencyCode: CurrencyCode;
  status: IndexFundStatus;
  pauseReason?: IndexFundPauseReason;
  pausedAt?: Date;
  pausedByUserId?: ObjectId;
  quotedNav: number;
  unitSupply: number;
  reserveUnits: number;
  cashAnchor: number;
  targetConstituents: IndexFundTargetConstituent[];
  holdings: IndexFundHolding[];
  bondAllocations?: IndexFundBondAllocation[];
  backingRatio?: number;
  lastRebalancedAt?: Date;
  /** A7: failing-corporation streaks, for the incumbent grace period. */
  listingFailureStreaks?: IndexFundListingFailureStreak[];

  // ── A5 sponsorship ──────────────────────────────────────────────────
  /**
   * Present only on SPONSORED funds. Absent means a system-seeded fund: no
   * sponsor, no fee, and no wind-up path. Every sponsorship field is optional
   * for exactly that reason — the seeded funds must stay byte-identical.
   */
  sponsorCorporationId?: ObjectId;
  sponsorName?: string;
  /** Annual expense ratio as a 0..1 fraction of AUM, capped at charter. */
  expenseRatioAnnual?: number;
  charteredAtTurn?: number;
  /**
   * Seed capital the sponsor put up (₳). Stays at risk for the fund's life and
   * is returned at wind-up only after every unit holder has been paid.
   */
  seedCapitalAnchor?: number;
  /** Running total of expense fees this fund has paid its sponsor (₳). */
  feesPaidToSponsorAnchor?: number;
  /** Turn the sponsor initiated wind-up; set with `status: "winding_down"`. */
  windDownStartedAtTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IndexFundHolderKind =
  | "character"
  | "imperial_character"
  | "npp"
  | "fund_reserve"
  // A8 phase 2: a union pension scheme investing its assets. Anchor-denominated
  // like the NPP holder, because scheme assets are ₳ and never touch a wallet.
  | "pension_scheme";

export interface IndexFundPosition {
  _id: ObjectId;
  fundId: ObjectId;
  holderKind: IndexFundHolderKind;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
  pensionSchemeId?: ObjectId;
  units: number;
  avgNavAnchor?: number;
  /**
   * Units acquired BEFORE the ticket #857 currency-scale fix, when subscribe
   * charged the raw ₳ magnitude as native (no × rate). These units redeem
   * rate-free (₳ magnitude credited as native, matching what was paid) so the
   * fix does not hand pre-fix holders a rate× windfall. Drained before normal
   * (post-fix) units on debit. Absent = treat all units as legacy (conservative:
   * never over-pays); new positions are created with legacyUnits: 0.
   */
  legacyUnits?: number;
  createdAt: Date;
  updatedAt: Date;
}

export type IndexFundTransactionKind =
  | "subscription"
  | "redemption"
  | "redemption_queued"
  | "public_float_buy"
  | "public_float_sell"
  | "dividend_reinvest"
  | "dividend_pass_through"
  | "bond_allocation"
  | "rebalance"
  | "cross_fund_buy"
  | "cross_fund_sell"
  | "liquidity_quote_buy"
  | "liquidity_quote_sell"
  | "capital_injection"
  // A5 sponsorship
  | "sponsor_seed_capital"
  | "expense_fee"
  | "wind_up_distribution"
  | "seed_capital_return";

export interface IndexFundTransaction {
  _id: ObjectId;
  fundId: ObjectId;
  kind: IndexFundTransactionKind;
  turn?: number;
  holderKind?: IndexFundHolderKind;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
  pensionSchemeId?: ObjectId;
  corporationId?: ObjectId;
  units?: number;
  shares?: number;
  navAnchor?: number;
  amountAnchor: number;
  note?: string;
  createdAt: Date;
}

export type IndexFundRedemptionStatus = "queued" | "partial" | "paid" | "cancelled";

export interface IndexFundRedemptionQueueEntry {
  _id: ObjectId;
  fundId: ObjectId;
  // Pension schemes have no redemption path (see `schemeInvesting.ts`), so they
  // cannot appear in the queue either.
  holderKind: Exclude<IndexFundHolderKind, "fund_reserve" | "pension_scheme">;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
  units: number;
  requestedNavAnchor: number;
  requestedAmountAnchor: number;
  paidAmountAnchor: number;
  /**
   * True for queue rows whose units were already removed from fund unitSupply
   * at redemption request time. These rows are cash payables and must be
   * subtracted from NAV backing until paid.
   */
  unitsBurnedAtRequest?: boolean;
  /**
   * The ₳ → native multiplier to apply when crediting this queued payout to a
   * character/imperial wallet (ticket #857 grandfather). Blended per request:
   * 1 for pre-fix (legacy) units, the fund's FX rate for post-fix units. Absent
   * = pre-fix queue row → credit rate-free (× 1), matching what the holder was
   * owed under the old symmetric-scale code. NPP credits ignore this (₳-native).
   */
  redeemFxRate?: number;
  status: IndexFundRedemptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface IndexFundSnapshot {
  _id: ObjectId;
  fundId: ObjectId;
  turn: number;
  quotedNav: number;
  unitSupply: number;
  cashAnchor: number;
  totalHoldingsValueAnchor: number;
  backingRatio: number;
  targetConstituents: IndexFundTargetConstituent[];
  createdAt: Date;
}
