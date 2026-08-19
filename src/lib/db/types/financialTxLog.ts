import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type FinancialTxType =
  // Character / imperial cash
  | "fund_credit" // legacy mixed-source entry — keep for back-compat
  | "fund_debit"
  | "office_income"
  | "fundraise_credit"
  | "wire_transfer_in"
  | "wire_transfer_out"
  | "campaign_donation"

  // Bonds
  | "bond_purchase"
  | "bond_sell"
  | "bond_coupon"
  | "bond_maturity"
  | "bond_default"
  | "bond_issuance"
  | "bond_dissolution_payout"

  // Corp & shares
  | "corp_revenue"
  | "corp_dividend"
  | "corp_salary"
  | "corp_tax_paid"
  | "corp_capital_seed"
  | "corp_capital_injection"
  | "corp_sector_sale"
  | "corp_sector_purchase"
  | "corp_supply_agreement"
  | "defence_contract_payment"
  | "corp_dissolution_distribution"
  | "corp_escrow_funding"
  | "corp_escrow_withdrawal"
  // C4 corporate groups: tax refunded when a group surrenders losses.
  | "corp_group_relief"
  // B8 discount window: emergency central-bank liquidity for a deposit-taker.
  | "bank_discount_window_draw"
  | "bank_discount_window_repay"
  // Private banking: the money legs the release review found missing.
  // Origination CREATES deposit money (the bank's own cash is untouched), so it
  // is a mint-contra leg rather than a transfer from the bank.
  | "bank_loan_origination"
  | "bank_loan_repayment"
  | "bank_npc_loan_interest"
  | "bank_deposit_interest"
  // Prop book. A trade is a RECLASS between the bank's cash and its own
  // trading book, so only the cash side is a money movement and both
  // directions share one mint/sink reason, exactly like capacity capex.
  | "bank_prop_trade_buy"
  | "bank_prop_trade_sell"
  // Depositor resolution when a bank fails: insured balances made whole from
  // the recovery pool, the insurance fund, then the Treasury backstop.
  | "bank_insurance_payout"
  // Central-bank advance to a chartered bank (liquidity injection), booked as
  // charter debt and repaid through the margin path.
  | "bank_cb_advance"
  // Interbank market: retail/universal bank cash lent to an investment or
  // universal bank and repaid. A real corp-to-corp transfer, two-sided.
  | "bank_interbank_lend"
  | "bank_interbank_repay"
  // CB margin line principal. Draw CREATES cash into the corp (LOC-style,
  // mirrored on the CB's netMoneyCreatedLifetime); repayment destroys it.
  | "bank_cb_margin_draw"
  | "bank_cb_margin_repay"
  // Merger review (C3): fine for an overdue divestiture order.
  | "corp_fine"
  // A7 index committee: corporate cash spent lobbying for a listing waiver.
  | "index_listing_lobbying"
  // A8: employer contribution or deficit top-up into a union pension scheme.
  | "pension_contribution"
  | "pension_benefit"

  // Capacity builds (P3a, marketSystemMode >= "plants"). A build is a CAPEX
  // reclass, not a loss: cash leaves `liquidCapital` and becomes the sector's
  // `constructionInProgressAnchor`, then becomes capacity on completion. The
  // money leg is the only side the tx log models — completion moves no money,
  // so it emits nothing.
  | "corp_capacity_build" // corp cash → capitalized construction in progress (debit)
  | "corp_capacity_build_refund" // cancelled build returns unspent CIP to corp cash (credit)
  | "stock_trade_buy"
  | "stock_trade_sell"

  // Index funds
  | "index_fund_subscribe"
  | "index_fund_redeem"
  | "index_fund_dividend"
  | "stock_order_escrow"
  | "stock_self_issue"
  | "stock_order_refund"
  | "ipo_proceeds"
  | "share_offer_escrow"
  | "share_listing_refund"
  | "share_buyout_payout"
  | "share_buyout_buyback"
  | "share_buyout_outflow"

  // Forex / savings / LOC
  | "forex_trade"
  | "savings_deposit"
  | "savings_withdrawal"
  | "savings_interest"
  | "loc_draw"
  | "loc_repay"
  | "loc_interest"
  | "loc_garnishment"

  // Admin / system
  | "admin_transfer"
  | "onboarding_reward" // one-time new-player checklist completion payout
  // Remediation ledger payback: a registered defect crediting value a shipped
  // bug destroyed. Always references its source row in `meta`, so the shadow
  // ledger books an attributed mint instead of unexplained money.
  | "restitution_credit"

  // Party budget
  | "party_transfer"
  | "party_gotv_spend"
  | "party_dues_received"
  | "caucus_tax_debit"

  // Government & subsidies
  | "gov_tax_revenue"
  | "gov_bond_issuance"
  | "gov_coupon_payment"
  | "gov_bond_maturity_payment"
  | "gov_subsidy_paid"
  | "gov_grant_paid"
  | "gov_budget_transfer"
  | "monetary_treasury_advance"

  // Crisis / events
  | "crisis_payout"
  | "crisis_levy"

  // World events (Phase 0)
  | "world_event_payout"

  // Resource prospecting + extraction contracts
  | "corp_prospecting_cost" // corp pays to launch a geological survey
  | "govt_prospecting_cost" // national/state government funds a survey
  | "contract_signing_fee" // corp pays a one-time fee on accepting a contract
  | "contract_royalty_payment" // corp pays a per-turn extraction royalty
  // Government-side receipts pairing the corp-paid sinks above (same convention
  // as corp_tax_paid ↔ gov_tax_revenue): emitted ONLY when the credit lands in
  // the national treasury (creditTreasury), because that is the only
  // government balance the shadow ledger stock-checks. State-budget credits are
  // not ledger-backed and stay single-sided.
  | "govt_signing_fee_receipt" // national treasury receives a contract signing fee
  | "govt_royalty_receipt"; // national treasury receives an extraction royalty

export type FinancialSubjectType =
  | "character"
  | "corporation"
  | "party"
  | "government"
  // A8: a union pension scheme holds real assets paid in by employers, so it is
  // a counterparty in its own right rather than a destination with no account.
  | "pension_scheme";
export type FinancialCounterpartyType = FinancialSubjectType | "system";
export type SuspectFlagType =
  | "large_transaction"
  | "velocity"
  | "round_trip"
  | "admin_transfer"
  | "wash_trade"
  // Phase 6 — finer-grained successors to `velocity` / `wash_trade`.
  | "time_velocity" // same-subject same-type ≥N tx within seconds
  | "same_price_wash" // round-trip same-corp at identical price within minutes
  | "cash_mismatch"; // logged-net diverges from actual cash delta beyond threshold
export type SuspectFlagSeverity = "low" | "medium" | "high";

export interface FinancialSuspectFlag {
  type: SuspectFlagType;
  severity: SuspectFlagSeverity;
  detail: string;
  detectedAt: Date;
  reviewedByAdminId?: ObjectId;
  reviewedAt?: Date;
  dismissed?: boolean;
}

export interface FinancialTxLogEntry {
  _id: ObjectId;
  type: FinancialTxType;

  turn: number;
  createdAt: Date;
  expiresAt: Date;

  subjectType: FinancialSubjectType;
  subjectId?: ObjectId; // set for character/corporation/party; omitted for government
  countryId?: string; // set when subjectType === "government"
  subjectName: string;

  amount: number; // positive = credit, negative = debit
  currencyCode: CurrencyCode;
  /**
   * Anchor-denominated snapshot of `amount` at emit time.
   *
   * Reconcile/suspect scans must compare tx totals against portfolioHistory,
   * which is already stored in anchor units. Deriving anchor value later from
   * the current FX table causes historical drift as rates move. When this
   * field is present, it is the canonical cross-currency value for the row.
   */
  anchorAmount?: number;
  balanceAfter?: number; // included where cheap (savings, LOC); omitted for batch events

  counterpartyType?: FinancialCounterpartyType;
  counterpartyId?: ObjectId;
  counterpartyName?: string;

  meta?: Record<string, unknown>;

  suspectFlags?: FinancialSuspectFlag[];
  flagged: boolean; // denormalized; true when suspectFlags has at least one non-dismissed flag

  /**
   * Set when the subject character / corporation has been deleted, retired,
   * or dissolved. Tx rows are NEVER cascade-deleted — admin forensic queries
   * must still resolve the subject after the entity is gone. The existing
   * `subjectName` was captured at emit time so it's still readable; this
   * timestamp marks "the entity behind subjectId is no longer joinable".
   *
   * Pre-Phase-4 a deleted character's tx history was orphaned: subjectId
   * pointed at a row that no longer existed in `characters`, and the wealth-
   * list audit had to special-case lookups. Phase 4 stamps this field on the
   * deletion path so the financial ledger UI can render a "(deleted)" badge
   * without doing a cross-collection join.
   */
  subjectDeletedAt?: Date;
  /**
   * Stable cross-reference for de-referenced subjects post-deletion. Set when
   * the subject was a character / corp with a `sequentialId` (most are);
   * lets admin queries find adjacent tx rows by short ID even after the
   * source doc is gone.
   */
  subjectSequentialId?: number;

  /** Counterparty equivalents — set when the OTHER side of the tx was deleted. */
  counterpartyDeletedAt?: Date;
  counterpartySequentialId?: number;
}

// Threshold config shape stored in systemSettings.financialTxLog.thresholds
export type TxThresholds = {
  [S in FinancialSubjectType]?: Partial<Record<FinancialTxType, number>>;
};

export const DEFAULT_TX_THRESHOLDS: TxThresholds = {
  character: {
    fund_credit: 500_000,
    fund_debit: 500_000,
    bond_purchase: 1_000_000,
    index_fund_subscribe: 1_000_000,
    index_fund_redeem: 1_000_000,
    index_fund_dividend: 500_000,
  },
  corporation: {
    corp_revenue: 50_000_000,
    bond_issuance: 10_000_000,
  },
  party: {
    party_transfer: 500_000,
  },
  government: {
    gov_bond_issuance: 100_000_000,
  },
};

/**
 * Retention window for financial transaction log entries, expressed in turns.
 *
 * 168 turns × 60 min/turn = 7 IRL days at the default cadence. The MongoDB
 * TTL index still operates on `expiresAt` (a wall-clock Date), but emitters
 * now compute that Date as `createdAt + TX_TTL_TURNS × turnLengthMinutes ×
 * 60_000ms` so admins can change turn cadence without silently shrinking or
 * stretching log retention. See `src/lib/financialTxLog/expiresAt.ts`.
 *
 * Pre-fix this was `TX_TTL_MS = 96 * 60 * 60 * 1000` (96 wall-clock hours
 * regardless of turn cadence) — the live audit confirmed log rows for
 * Mark/KIMI dropped at the 96h mark and erased the ~$8B inflow event from
 * forensic visibility.
 */
export const TX_TTL_TURNS = 168;

/**
 * Default turn length in minutes — used when gameConfig hasn't been seeded
 * yet (test environments, fresh installs). Keep in sync with the seed in
 * `src/lib/seeds/reference/gameConfig.ts`.
 */
export const DEFAULT_TURN_LENGTH_MINUTES = 60;

/**
 * Pre-computed default TTL in milliseconds, used as a synchronous fallback
 * when the helper cannot reach `gameConfig` (test paths that never seed it).
 * Equivalent to TX_TTL_TURNS × DEFAULT_TURN_LENGTH_MINUTES × 60_000.
 */
export const TX_TTL_DEFAULT_MS = TX_TTL_TURNS * DEFAULT_TURN_LENGTH_MINUTES * 60_000;
