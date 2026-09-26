import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";
import type { CurrencyCode } from "../../constants/currencies";
import type { CorporationType } from "../../constants/corporations";

export type IndexFundScope = "country" | "global";
/**
 * `broad` and `sector` are equity index funds with a bond reserve; `bond` is a
 * bond fund: no equities, a cash buffer, and the rest in the bonds its
 * definition's universe allows (see `BOND_FUND_DEFINITIONS`).
 */
export type IndexFundKind = "broad" | "sector" | "bond";
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

/** One outstanding queued-redemption fund debit (#2223, see `IndexFund.redemptionDebitMarkers`). */
export interface IndexFundRedemptionDebitMarker {
  /** Anchor-currency cash debited. */
  amountAnchor: number;
  /** Fund units burned with the debit (legacy-burn rows only). */
  units: number;
  /** Queue entry this debit belongs to. */
  queueEntryId: ObjectId;
  markedAt: Date;
}

/** Standalone-only in-progress redemption-liquidity sale (#2223). */
export interface IndexFundPendingLiquiditySale {
  saleId: string;
  corporationId: ObjectId;
  shares: number;
  proceedsAnchor: number;
  startedAt: Date;
}

/**
 * Durable holder-credit receipt (#2223). Written with `$addToSet` in the SAME
 * `updateOne` as the holder credit, on whatever holder document was credited
 * (`characters`, `imperialCharacters`, or `npps` under `redemptionReceipts`),
 * so the receipt's presence proves the credit landed. Replays and the reaper
 * consult the receipt instead of guessing: a present receipt means finalize
 * bookkeeping without moving money again. The figures carried here let the
 * reaper finalize a payout whose owner died after the credit without
 * recomputing a quote that is no longer reproducible (NAV moved on).
 */
export interface IndexFundRedemptionReceipt {
  /** Per-attempt key, matching the queue journal's `attemptKey`. */
  key: string;
  /** Anchor-currency cash credited. */
  amountAnchor: number;
  /** Queue units this credit settled. */
  units: number;
  /** Queue units left unserved after this credit. */
  remainingUnits: number;
  /** Forward NAV the payout was struck at. */
  nav: number;
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
  /** Serializes non-transactional redemption fallback on standalone Mongo. */
  redemptionLock?: { token: ObjectId; expiresAt: Date };
  /**
   * Outstanding queued-redemption fund debits (#2223). Each payout attempt
   * writes its marker in the SAME `updateOne` as the fund debit, so the
   * marker's presence is durable proof the debit landed: the owner resolves
   * ambiguous failures and the reaper (`reapStaleRedemptionProcessing`)
   * decides restore-vs-finalize-vs-quarantine from this map, never from the
   * queue journal alone. The reaper never refunds from an ambiguous stale
   * state: it keeps the marker and quarantines, and only a live owner that
   * proves its own credit never landed (or the explicit manual
   * `reconcileQuarantinedRedemption`) refunds. Keys are per-attempt
   * (`redemptionAttemptKey`), never reused, so a refunded or finalized
   * attempt's marker is simply `$unset` (batched at the end of the pass);
   * orphan markers from a crash before cleanup are harmless because no
   * future attempt reuses the key.
   */
  redemptionDebitMarkers?: Record<string, IndexFundRedemptionDebitMarker>;
  /**
   * Standalone-only crash journal for redemption-liquidity holding sales
   * (#2223). Set (if absent) before a sale's first value-moving leg and
   * cleared right after the holdings write lands. A surviving journal means
   * the process may have died mid-sale, where the legs span too many
   * documents for marker atomicity: the next pass quarantines liquidity
   * raising for this fund (fail-closed, manual reconciliation) instead of
   * replaying blind. Never set inside a transaction (the abort owns it).
   */
  pendingLiquiditySale?: IndexFundPendingLiquiditySale;
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
  | "bond_sale"
  | "rebalance"
  /** Holding in a dissolved corporation removed at zero: no buyer can exist. */
  | "holding_writeoff"
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

export type IndexFundRedemptionStatus = "queued" | "partial" | "processing" | "paid" | "cancelled";

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
  /** Set while the cron owns this payout. Processing rows require reconciliation after a crash. */
  processingStartedAt?: Date;
  /**
   * Crash-recovery journal for the payout attempt that owns this processing
   * claim (#2223). Written once, at claim time: `from` (status to restore if
   * nothing moved) plus `attemptKey`, the per-attempt id that ties together
   * the fund-side debit marker (`IndexFund.redemptionDebitMarkers`) and the
   * holder-side credit receipt (`IndexFundRedemptionReceipt`). The journal is
   * only a pointer: the owner and the reaper decide refund-vs-restore-vs-
   * finalize from the marker and the receipt, which are written atomically
   * with their money legs. Marker-less legacy rows are left for manual
   * reconciliation instead of being replayed blind.
   */
  processingAttempt?: {
    from: IndexFundRedemptionStatus;
    attemptKey: string;
    /** Set when the row was quarantined (ambiguous, needs a human). */
    quarantined?: boolean;
    /**
     * Outstanding fund debit (anchor cash, plus burned units for legacy-burn
     * rows) at quarantine time. The pending debit is an explicit
     * reconciliation obligation: it must be refunded or finalized by the
     * human runbook, never silently treated as conserved while it is
     * outstanding.
     */
    outstandingAnchor?: number;
    outstandingUnits?: number;
    /**
     * Unbacked holder credit awaiting a verified reversal (#2223, owner-side
     * quarantine). Stamped when a concurrent resolver refunded this
     * attempt's fund debit while the stale owner still landed its holder
     * credit (the reaper itself never refunds; only an operator's manual
     * refund-and-restore can race a live owner this way), and the
     * receipt-guarded reversal could not be verified (or settlement truth
     * was unreadable). The row is NOT replayable until
     * `retryQuarantinedHolderReversal` removes the receipt and proves it
     * gone: replaying first would pay the holder a second time. Amounts are
     * the exact credit figures, so the retry reverses precisely what the
     * stale owner credited. Never silently treated as conserved.
     */
    unreversedReceiptKey?: string;
    unreversedAmountAnchor?: number;
    unreversedNative?: number;
    unreversedUnits?: number;
  };
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
