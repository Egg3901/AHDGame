import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Private banking (1.1). A corporation owning at least one `financial` sector
 * may charter exactly one bank. Charter type is retail XOR investment while
 * the era's Glass-Steagall separation is in force; a repeal unlocks universal.
 */
export type BankCharterType = "retail" | "investment" | "universal";

export type BankCharterStatus = "active" | "revoked" | "failed";

/** Where a character's per-currency savings balance is held. */
export type SavingsHolder = "centralBank" | string; // string = bank corp id (hex)

/**
 * Sub-document on Corporation. Balance-sheet quantities are home-currency
 * face values; the deposit/loan ledgers are the per-account source of truth
 * and these are cached aggregates recomputed by bankingTurn.
 */
export interface BankCharter {
  type: BankCharterType;
  status: BankCharterStatus;
  currency: CurrencyCode;
  charteredTurn: number;
  /** Capital posted at charter; absorbs losses before depositors do. */
  postedCapital: number;
  /** CEO-set offsets against prime, bounded by the Regulation Q corridor. */
  depositOffset: number;
  lendingOffset: number;
  /**
   * Cached deposit aggregate (recomputed each bankingTurn): player-held pointer
   * deposits (characters with savingsHolder[CODE] = this bank) + npcDeposits.
   */
  totalDeposits?: number;
  totalLoans?: number;
  /**
   * @deprecated Legacy mirror of `cashReserves`, written once per banking turn
   * and therefore stale between turns. Nothing writes it any more: cash moves
   * only through the money primitive, and a second copy of a balance is a
   * second answer waiting to disagree. Kept on the type so old documents
   * deserialize; read `cashReserves`.
   */
  reserves?: number;
  /**
   * The bank's own cash, ring-fenced from `corporation.liquidCapital`.
   *
   * The corporation spends `liquidCapital`; the bank spends this. Every banking
   * cash flow — deposit interest, loan servicing, insurance premiums, discount
   * window, prop desk, interbank — moves this balance and never the parent's.
   * The boundary is crossed only by `banking/bankCash.ts`: freely inward,
   * supervised outward.
   *
   * Absent on charters written before the ring-fence; treat as 0 via
   * `getCashReserves`.
   */
  cashReserves?: number;
  /**
   * CEO's household lending stance. Sets which credit bands the bank will
   * originate into from now on; it never re-prices or re-rates a loan already
   * on the book. See `banking/creditBands.ts`.
   */
  lendingProfile?: import("@/lib/banking/creditBands").LendingProfileId;
  /** Turn the charter type was last switched. Absent = never switched. */
  charterSwitchTurn?: number;
  /** Charter type is locked until this turn. See `CHARTER_SWITCH_COOLDOWN_TURNS`. */
  charterSwitchCooldownUntilTurn?: number;
  /**
   * Captured NPC household deposits in home-currency face value. Moved each
   * bankingTurn between this charter and the CB's externalBroadMoney.
   */
  npcDeposits?: number;
  /**
   * Player savings the bank owes as a REAL, cash-backed liability: the sum
   * of the savings accounts whose holder is this bank, maintained as a
   * projection by the savings commands once accounts are authoritative for
   * the currency. Absent (or ignored) before then, when player balances are
   * still pointers the bank never received cash for.
   */
  playerDeposits?: number;
  /**
   * 0..1 solvency/liquidity confidence, recomputed each bankSolvencyTurn.
   * Drives NPC deposit flight and the published warning band.
   */
  confidence?: number;
  /** Contagion panic remaining; counts down by 1 each bankSolvencyTurn (floor 0). */
  panicTurns?: number;
  /** Published warning band one turn ahead of NPC flight bite (players see this). */
  warningBand?: "green" | "amber" | "red";
  /**
   * Idempotency key for bankSolvencyTurn - standalone Mongo has no transactions.
   * Set to the processed turn at the END of that bank's solvency pass.
   */
  lastSolvencyTurn?: number;
  /** Share of financial-sector capacity allocated to the branch network (vs commodity output), 0..1. */
  branchCapacityShare?: number;
  /**
   * Cached deposit ceiling recomputed each bankingTurn from financial-sector
   * capacity × branchCapacityShare × DEPOSIT_CEILING_PER_CAPACITY_UNIT.
   */
  depositCeiling?: number;
  /** Refused counterparties. Index funds blacklist every constituent. */
  blacklist?: {
    corporationIds?: string[];
    characterIds?: string[];
    indexFundIds?: string[];
  };
  /**
   * Opt-in loan approval. When true, new named loans land `pending` and the CEO
   * accepts or rejects each from the bank console instead of them auto-granting.
   * Absent/false = the historical objective auto-approval. See `banking/loanApproval.ts`.
   */
  requireApproval?: boolean;
  /**
   * Idempotency key for bankingTurn - standalone Mongo has no transactions.
   * Set to the processed turn at the END of that bank's pass.
   */
  lastBankingTurn?: number;
  /**
   * Idempotency key for depositor resolution after failure. Set when
   * resolveFailedBankDepositors finishes (insurance payouts / haircuts / holder flips).
   */
  depositorsResolvedTurn?: number;
  /**
   * Turn on which resolution of a failed estate was claimed. Set before the
   * waterfall moves any money, so a crashed resolution reads as `resolving`
   * and is finished by recovery rather than re-run from the start.
   */
  resolutionClaimedTurn?: number;
  revokedTurn?: number;
  revokedReason?: string;
  failedTurn?: number;
  /**
   * Proprietary trading book (investment / universal). Marked each
   * bankSolvencyTurn; cash legs settle against the market counterparty.
   */
  propBook?: PropPosition[];
  /** Outstanding principal borrowed on the interbank market (not retail totalLoans). */
  interbankDebt?: number;
  /** Outstanding CB margin-line principal (cash created at the CB on draw). */
  cbMarginDebt?: number;
  /**
   * B8 discount window: outstanding emergency-liquidity principal owed to the
   * central bank. Deposit-taking charters only. Carries a penalty rate AND a
   * confidence penalty while outstanding — see `banking/discountWindow.ts`.
   */
  discountWindowDebt?: number;
  /** Idempotency key for discount-window interest servicing in bankingTurn. */
  lastDiscountWindowTurn?: number;
  /** Window interest the bank could not pay, accrued against its headroom. */
  discountWindowArrears?: number;
  /** Cached sum of prop-book mark values; refreshed each bankSolvencyTurn. */
  propBookMarkValue?: number;
  /** Idempotency key for CB margin interest servicing in bankingTurn. */
  lastCbMarginTurn?: number;
  /**
   * CB margin interest the bank could not pay, accumulated. Rolls into the
   * principal the draw cap is measured against, so a bank that keeps missing
   * payments loses headroom instead of borrowing interest-free forever.
   */
  cbMarginArrears?: number;

  // ── B7 supervision ──────────────────────────────────────────────────
  /** Capital standing at the last supervisory pass. Absent = never assessed. */
  capitalStanding?: import("@/lib/banking/capitalAdequacy").CapitalStanding;
  /** Capital / risk assets at the last pass, rounded to 4dp for display. */
  capitalRatio?: number;
  /** The same ratio after the published supervisory shock. */
  stressedCapitalRatio?: number;
  /**
   * Share of the loan book the last supervisory pass assumed would default at
   * once, derived from the book's credit-band mix. Published so the console can
   * show the shock this bank was measured against.
   */
  appliedStressLossFraction?: number;
  /**
   * Turn the CURRENT undercapitalization began. Cleared the moment the bank is
   * back above the minimum, so curing and later breaching again earns a fresh
   * grace period rather than inheriting a stale clock.
   */
  undercapitalizedSinceTurn?: number;
  /** Idempotency key for the supervisory pass. */
  lastSupervisionTurn?: number;
}

/**
 * Collection: bankCharterHistory. Snapshot of a charter sub-doc when it leaves
 * active use (revoke, failure, or overwrite on recharter).
 */
export interface BankCharterHistoryEntry {
  _id: ObjectId;
  corporationId: ObjectId;
  charter: BankCharter;
  archivedTurn: number;
  reason: "revoked" | "failed" | "recharter";
}

/** Collection: bankLoans. One doc per named loan (NPC bulk book lives on the charter). */
export interface BankLoan {
  _id: ObjectId;
  bankCorporationId: ObjectId;
  currency: CurrencyCode;
  borrowerType: "corporation" | "character" | "npcBulk";
  borrowerId?: ObjectId;
  /**
   * Credit band, for `npcBulk` tranches. The household book is one doc per
   * band rather than one lump, which is what lets the console report it by
   * rating and the supervisor shock it by composition.
   *
   * Absent on named player loans (they carry the borrower's own rating) and on
   * books originated before the split, which are reported under
   * `creditBands.LEGACY_BAND`.
   */
  creditBand?: import("@/lib/banking/creditBands").CreditBandId;
  principal: number;
  outstanding: number;
  ratePercent: number;
  originatedTurn: number;
  /** Contract length in turns (required for named player loans). */
  termTurns: number;
  /**
   * `pending` = awaiting CEO decision on a bank whose charter has
   * `requireApproval` set; principal is NOT disbursed and does NOT count against
   * the loan book until accepted. `rejected` = CEO declined; terminal, no money
   * moved. All other states are live/closed loans. See `banking/loanApproval.ts`.
   */
  status: "pending" | "current" | "arrears" | "defaulted" | "repaid" | "rejected";
  /** Turn a `pending` loan was requested (for CEO queue ordering / staleness). */
  requestedTurn?: number;
  /** Turn a pending loan was accepted or rejected. */
  decisionTurn?: number;
  /** Optional CEO-supplied reason shown to the borrower on rejection. */
  rejectedReason?: string;
  /** Consecutive shortfall turns while in arrears; defaults at ARREARS_DEFAULT_TURNS. */
  arrearsTurns?: number;
  /** Idempotency key for turn processing — standalone Mongo has no transactions. */
  lastProcessedTurn?: number;
}

/** Collection: depositInsuranceFunds. One per currency; premium-funded, Treasury backstop. */
export interface DepositInsuranceFund {
  _id: CurrencyCode;
  balance: number;
  /** Insured cap in local currency, era/FX-anchored at seed and re-anchorable. */
  insuredCap: number;
  premiumsCollectedLifetime: number;
  payoutsLifetime: number;
  treasuryBackstopLifetime: number;
  lastProcessedTurn?: number;
}

/** Collection: interbankLoans. Retail bank lends non-reserved deposits to an investment bank. */
export interface InterbankLoan {
  _id: ObjectId;
  lenderCorporationId: ObjectId;
  borrowerCorporationId: ObjectId;
  currency: CurrencyCode;
  principal: number;
  outstanding: number;
  ratePercent: number;
  originatedTurn: number;
  status: "current" | "defaulted" | "repaid";
  /** Consecutive interest shortfall turns; defaults at ARREARS_DEFAULT_TURNS. */
  arrearsTurns?: number;
  lastProcessedTurn?: number;
}

/** Prop-book position on an investment/universal bank (marked in bankSolvencyTurn). */
export interface PropPosition {
  asset: "equity" | "bond" | "indexUnit" | "forex";
  /** Corp id / bond id / fund id / currency code depending on asset. */
  ref: string;
  units: number;
  costBasis: number;
  markValue?: number;
}
