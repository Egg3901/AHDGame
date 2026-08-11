import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { CorporationType } from "../../constants/corporations";

export type IndexFundScope = "country" | "global";
export type IndexFundKind = "broad" | "sector";
export type IndexFundStatus = "active" | "paused" | "delisted";
export type IndexFundPauseReason = "manual" | "backing_ratio" | "constituent_delisted";

export interface IndexFundTargetConstituent {
  corporationId: ObjectId;
  /** Target portfolio weight, represented as a 0..1 fraction. */
  targetWeight: number;
  /** Constituent market cap converted to the fund anchor currency at weight-lock time. */
  marketCapAnchor: number;
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
  createdAt: Date;
  updatedAt: Date;
}

export type IndexFundHolderKind = "character" | "imperial_character" | "npp" | "fund_reserve";

export interface IndexFundPosition {
  _id: ObjectId;
  fundId: ObjectId;
  holderKind: IndexFundHolderKind;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
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
  | "capital_injection";

export interface IndexFundTransaction {
  _id: ObjectId;
  fundId: ObjectId;
  kind: IndexFundTransactionKind;
  turn?: number;
  holderKind?: IndexFundHolderKind;
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  nppId?: ObjectId;
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
  holderKind: Exclude<IndexFundHolderKind, "fund_reserve">;
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
