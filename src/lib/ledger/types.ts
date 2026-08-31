import type { ObjectId } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FinancialTxType } from "@/lib/db/types/financialTxLog";

/**
 * Shadow double-entry ledger — types.
 *
 * See docs/plans/2026-07-05-shadow-ledger-plan.md. This collection is
 * SHADOW-ONLY (Phases 1-3): game code never reads `ledgerEntries`; it exists so
 * the reconciler (src/lib/ledger/reconcile.ts) can assert a conservation law
 * over money movements and alarm the same turn a violation happens, instead of
 * discovering silent corruption turns later (t841 FX blowup, ghost-bank carry
 * trade, phantom-credit incidents).
 */

/** Role of a leg within an entry. */
export type LedgerLegRole =
  /** The authoritative movement — the subject whose real balance changed. */
  | "primary"
  /**
   * The balancing counter-leg. Either the real counterparty account (two-sided
   * rows) or a system mint:/sink: bucket (single-sided rows). Contra legs are
   * IGNORED by the stock-vs-flow reconciler check so a two-sided transfer isn't
   * double-counted against the counterparty's own primary row.
   */
  | "contra";

export interface LedgerLeg {
  /** Canonical account id — see src/lib/ledger/accounts.ts. */
  account: string;
  /** Signed native amount (positive = credit / money in, negative = debit). */
  amount: number;
  currencyCode: CurrencyCode;
  /** ₳ snapshot of `amount` at emit time — the canonical cross-currency value. */
  anchorAmount: number;
  role: LedgerLegRole;
}

export interface LedgerEntry {
  _id: ObjectId;
  turn: number;
  createdAt: Date;
  /** Reuses the existing FinancialTxType enum; extended as coverage gaps close. */
  txType: FinancialTxType;
  /** ≥2 legs; Σ anchorAmount MUST be 0 within ε (Invariant #1). */
  legs: LedgerLeg[];
  /** The game doc that motivated the entry, when known. */
  sourceRef?: { collection: string; id: ObjectId };
  /** Grep-able origin, e.g. "financialTxLog/emit.ts:shim". */
  emitSite: string;
  /** Denormalized: |Σ legs.anchorAmount| < ε. */
  balanced: boolean;
}

/** Input to the emitter — `_id`/`balanced` are computed. */
export type LedgerEntryInput = Omit<LedgerEntry, "_id" | "balanced">;

/**
 * Per-turn authoritative-balance snapshot. One doc per turn; the reconciler
 * diffs consecutive snapshots to detect balances that moved with no ledger
 * legs (uninstrumented writes — the Phase 3 coverage queue) and legs that moved
 * an account whose real balance didn't (the t841 wrong-currency class).
 */
export interface BalanceSnapshot {
  _id: ObjectId;
  turn: number;
  createdAt: Date;
  /** account id -> ₳ balance at snapshot time. */
  balances: Record<string, number>;
  /** Local-currency units per anchor unit at snapshot time. */
  anchorRates?: Record<string, number>;
  /**
   * When the balances were re-baselined after an admin reseed / era reset
   * (see reconcile.ts resetEpoch handling), stock-vs-flow is skipped for the
   * turn to avoid alarming on a legitimate wholesale rewrite.
   */
  rebaselined?: boolean;
}

export type ReconcileStatus = "green" | "amber" | "red";

export interface TrialBalanceFinding {
  entryId: string;
  txType: FinancialTxType;
  emitSite: string;
  /** Σ legs anchorAmount (should be ~0). */
  anchorResidual: number;
  /** Native residual for the offending single-currency group, when applicable. */
  nativeResidual?: number;
}

export interface StockVsFlowFinding {
  account: string;
  /** Authoritative balance delta from the snapshot diff (₳). */
  actualDelta: number;
  /** Σ primary-leg anchorAmount for this account (₳). */
  ledgerDelta: number;
  divergence: number;
  /** True when the account moved with NO ledger legs at all (uninstrumented). */
  uninstrumented: boolean;
  /** Candidate emit sites active this turn for the account. */
  candidateEmitSites: string[];
}

export interface MoneySupplyReason {
  reason: string;
  mint: number;
  sink: number;
}

export interface MoneySupplyFinding {
  currencyCode: string;
  minted: number;
  sunk: number;
  netDrift: number;
  byReason: MoneySupplyReason[];
}

export interface ReconcileReport {
  turn: number;
  generatedAt: Date;
  status: ReconcileStatus;
  entriesChecked: number;
  trialBalance: {
    status: ReconcileStatus;
    unbalancedCount: number;
    findings: TrialBalanceFinding[];
  };
  stockVsFlow: {
    status: ReconcileStatus;
    skipped: boolean;
    /** null when the check was skipped: unknown, not zero. */
    divergentCount: number | null;
    findings: StockVsFlowFinding[];
  };
  moneySupply: {
    status: ReconcileStatus;
    findings: MoneySupplyFinding[];
  };
  /** Unattributed mint/sink legs ranked by |anchor|, for the Phase 3 backlog. */
  unattributed: { txType: string; emitSite: string; anchorAmount: number }[];
}

/** Persisted per-run reconciliation, for trending in the ops dashboard. */
export interface LedgerReconciliation extends ReconcileReport {
  _id: ObjectId;
}
