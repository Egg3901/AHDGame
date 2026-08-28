import * as Sentry from "@sentry/nextjs";
import { ObjectId, type Db } from "mongodb";
import { accountCurrency, accountKind, isRealAccount } from "@/lib/ledger/accounts";
import { epsilonFor, isAnchorBalanced, nativeImbalance } from "@/lib/ledger/epsilon";
import { LEDGER_ENTRIES_COLLECTION } from "@/lib/ledger/emit";
import { loadBalanceSnapshot, loadPreForexBalanceCheckpoint } from "@/lib/ledger/balanceSnapshot";
import type {
  LedgerEntry,
  LedgerReconciliation,
  MoneySupplyFinding,
  ReconcileReport,
  ReconcileStatus,
  StockVsFlowFinding,
  TrialBalanceFinding,
} from "@/lib/ledger/types";

export const LEDGER_RECONCILIATIONS_COLLECTION = "ledgerReconciliations";

const MAX_FINDINGS = 100;

function worseStatus(a: ReconcileStatus, b: ReconcileStatus): ReconcileStatus {
  const rank: Record<ReconcileStatus, number> = { green: 0, amber: 1, red: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export interface ReconcileInput {
  turn: number;
  entries: LedgerEntry[];
  openingBalances: Record<string, number>;
  closingBalances: Record<string, number>;
  preForexBalances?: Record<string, number>;
  openingAnchorRates?: Record<string, number>;
  preForexAnchorRates?: Record<string, number>;
  closingAnchorRates?: Record<string, number>;
  /** Skip stock-vs-flow (e.g. a reset/reseed epoch legitimately rewrote balances). */
  skipStockVsFlow?: boolean;
}

/**
 * Pure reconciler — no DB. Given this turn's ledger entries and the opening /
 * closing authoritative-balance snapshots, produce a green/amber/red report.
 *
 * 1. Trial balance (Invariant #1): every entry sums to ~0 in ₳; single-currency
 *    entries also net to ~0 natively (the t841 catch). Violation → red.
 * 2. Stock-vs-flow: per real account, Σ primary-leg ₳ vs actual balance delta.
 *    Divergence (incl. accounts that moved with NO legs) → amber, and drives the
 *    Phase 3 coverage sweep. Expected to be noisy until coverage lands.
 * 3. Money supply: per currency, Σ mints − Σ sinks by reason. Reported; the big
 *    `unattributed` bucket is the Phase 3 backlog.
 *
 * See docs/plans/2026-07-05-shadow-ledger-plan.md §2.
 */
export function reconcileLedger(input: ReconcileInput): ReconcileReport {
  const { turn, entries } = input;

  // --- Check 1: trial balance -------------------------------------------------
  const trialFindings: TrialBalanceFinding[] = [];
  for (const entry of entries) {
    const anchorOk = isAnchorBalanced(entry.legs);
    const native = nativeImbalance(entry.legs);
    if (!anchorOk || native) {
      const residual = entry.legs.reduce((s, l) => s + l.anchorAmount, 0);
      trialFindings.push({
        entryId: entry._id.toString(),
        txType: entry.txType,
        emitSite: entry.emitSite,
        anchorResidual: residual,
        nativeResidual: native?.residual,
      });
    }
  }
  const trialStatus: ReconcileStatus = trialFindings.length > 0 ? "red" : "green";

  // --- Check 2: stock vs flow -------------------------------------------------
  // Ledger delta per account = Σ PRIMARY legs (contra legs are ignored so a
  // two-sided transfer isn't double-counted against the counterparty's own row).
  const ledgerDelta = new Map<string, number>();
  const emitSitesByAccount = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const leg of entry.legs) {
      if (leg.role !== "primary") continue;
      ledgerDelta.set(leg.account, (ledgerDelta.get(leg.account) ?? 0) + leg.anchorAmount);
      const set = emitSitesByAccount.get(leg.account) ?? new Set<string>();
      set.add(`${entry.txType}@${entry.emitSite}`);
      emitSitesByAccount.set(leg.account, set);
    }
  }

  const stockFindings: StockVsFlowFinding[] = [];
  if (!input.skipStockVsFlow) {
    const accounts = new Set<string>([
      ...Object.keys(input.openingBalances),
      ...Object.keys(input.closingBalances),
      ...ledgerDelta.keys(),
    ]);
    for (const account of accounts) {
      if (!isRealAccount(account)) continue;
      const actualDelta = cashMovementDelta(input, account);
      const led = ledgerDelta.get(account) ?? 0;
      const divergence = led - actualDelta;
      const eps = epsilonFor([actualDelta, led]);
      if (Math.abs(divergence) < eps) continue;
      stockFindings.push({
        account,
        actualDelta,
        ledgerDelta: led,
        divergence,
        uninstrumented: Math.abs(led) < eps && Math.abs(actualDelta) >= eps,
        candidateEmitSites: [...(emitSitesByAccount.get(account) ?? [])],
      });
    }
    stockFindings.sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
  }
  const stockStatus: ReconcileStatus = stockFindings.length > 0 ? "amber" : "green";

  // --- Check 3: money supply --------------------------------------------------
  // minted = Σ(-anchor) over mint legs; sunk = Σ(anchor) over sink legs.
  const supply = new Map<
    string,
    { minted: number; sunk: number; reasons: Map<string, { mint: number; sink: number }> }
  >();
  const unattributed = new Map<
    string,
    { txType: string; emitSite: string; anchorAmount: number }
  >();
  for (const entry of entries) {
    for (const leg of entry.legs) {
      const kind = accountKind(leg.account);
      if (kind !== "mint" && kind !== "sink") continue;
      // Rows with no economically material value can be emitted by a valid
      // zero-quantity transaction. They do not create or retire money and
      // must not manufacture an attribution failure in the confidence gate.
      if (Math.abs(leg.anchorAmount) < epsilonFor([leg.anchorAmount])) continue;
      const currency = accountCurrency(leg.account);
      const bucket = supply.get(currency) ?? { minted: 0, sunk: 0, reasons: new Map() };
      const reason = leg.account.split(":")[1] ?? "unknown";
      const rb = bucket.reasons.get(reason) ?? { mint: 0, sink: 0 };
      if (kind === "mint") {
        bucket.minted += -leg.anchorAmount;
        rb.mint += -leg.anchorAmount;
      } else {
        bucket.sunk += leg.anchorAmount;
        rb.sink += leg.anchorAmount;
      }
      bucket.reasons.set(reason, rb);
      supply.set(currency, bucket);
      if (reason === "unattributed") {
        const key = `${entry.txType}@${entry.emitSite}`;
        const prev = unattributed.get(key) ?? {
          txType: entry.txType,
          emitSite: entry.emitSite,
          anchorAmount: 0,
        };
        prev.anchorAmount += Math.abs(leg.anchorAmount);
        unattributed.set(key, prev);
      }
    }
  }
  const supplyFindings: MoneySupplyFinding[] = [...supply.entries()].map(([currencyCode, b]) => ({
    currencyCode,
    minted: b.minted,
    sunk: b.sunk,
    netDrift: b.minted - b.sunk,
    byReason: [...b.reasons.entries()].map(([reason, r]) => ({
      reason,
      mint: r.mint,
      sink: r.sink,
    })),
  }));
  // Net creation or retirement is an economic outcome, not a failed
  // reconciliation. The confidence failure is an unexplained mint/sink leg.
  // Keep reporting net drift by currency and reason, but turn amber only while
  // the semantic attribution backlog is non-empty.
  const supplyStatus: ReconcileStatus = unattributed.size > 0 ? "amber" : "green";

  const status = worseStatus(worseStatus(trialStatus, stockStatus), supplyStatus);

  return {
    turn,
    generatedAt: new Date(),
    status,
    entriesChecked: entries.length,
    trialBalance: {
      status: trialStatus,
      unbalancedCount: trialFindings.length,
      findings: trialFindings.slice(0, MAX_FINDINGS),
    },
    stockVsFlow: {
      status: stockStatus,
      skipped: Boolean(input.skipStockVsFlow),
      divergentCount: stockFindings.length,
      findings: stockFindings.slice(0, MAX_FINDINGS),
    },
    moneySupply: {
      status: supplyStatus,
      findings: supplyFindings,
    },
    unattributed: [...unattributed.values()]
      .sort((a, b) => b.anchorAmount - a.anchorAmount)
      .slice(0, MAX_FINDINGS),
  };
}

function rateForAccount(account: string, rates: Record<string, number> | undefined): number {
  const rate = rates?.[accountCurrency(account)];
  return rate && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/**
 * Value cash movement without treating a forex repricing as money entering or
 * leaving an account. Before the checkpoint, flows are valued at the
 * pre-forex rate. After it, flows are valued at the closing rate.
 */
function cashMovementDelta(input: ReconcileInput, account: string): number {
  if (
    !input.preForexBalances ||
    !input.openingAnchorRates ||
    !input.preForexAnchorRates ||
    !input.closingAnchorRates
  ) {
    return (input.closingBalances[account] ?? 0) - (input.openingBalances[account] ?? 0);
  }

  const openingRate = rateForAccount(account, input.openingAnchorRates);
  const preForexRate = rateForAccount(account, input.preForexAnchorRates);
  const closingRate = rateForAccount(account, input.closingAnchorRates);
  const openingNative = (input.openingBalances[account] ?? 0) * openingRate;
  const preForexNative = (input.preForexBalances[account] ?? 0) * preForexRate;
  const closingNative = (input.closingBalances[account] ?? 0) * closingRate;

  return (
    (preForexNative - openingNative) / preForexRate + (closingNative - preForexNative) / closingRate
  );
}

/**
 * DB-backed reconciliation for a turn: loads this turn's ledger entries and the
 * opening (turn-1) / closing (turn) balance snapshots, runs {@link
 * reconcileLedger}, persists a {@link LedgerReconciliation} doc, and routes
 * CRITICAL trial-balance breaks to Sentry. Never throws — the reconciler must
 * not fail turn processing.
 */
export async function reconcileTurn(
  db: Db,
  turn: number,
  opts: { skipStockVsFlow?: boolean } = {}
): Promise<ReconcileReport | null> {
  try {
    const entries = await db
      .collection<LedgerEntry>(LEDGER_ENTRIES_COLLECTION)
      .find({ turn })
      .toArray();

    const closing = await loadBalanceSnapshot(db, turn);
    const opening = await loadBalanceSnapshot(db, turn - 1);
    const preForex = await loadPreForexBalanceCheckpoint(db, turn);
    // No opening snapshot (first shadow turn) or an explicit rebaseline epoch →
    // stock-vs-flow would alarm on the whole world; skip it for this turn.
    const skipStockVsFlow = opts.skipStockVsFlow || !opening || Boolean(closing?.rebaselined);

    const report = reconcileLedger({
      turn,
      entries,
      openingBalances: opening?.balances ?? {},
      closingBalances: closing?.balances ?? {},
      preForexBalances: preForex?.balances,
      openingAnchorRates: opening?.anchorRates,
      preForexAnchorRates: preForex?.anchorRates,
      closingAnchorRates: closing?.anchorRates,
      skipStockVsFlow,
    });

    const doc: LedgerReconciliation = { ...report, _id: new ObjectId() };
    await db.collection<LedgerReconciliation>(LEDGER_RECONCILIATIONS_COLLECTION).insertOne(doc);

    if (report.trialBalance.status === "red") {
      Sentry.captureMessage(
        `[ledger] CRITICAL: ${report.trialBalance.unbalancedCount} unbalanced ledger entr` +
          `${report.trialBalance.unbalancedCount === 1 ? "y" : "ies"} at turn ${turn}`,
        {
          level: "error",
          extra: {
            turn,
            findings: report.trialBalance.findings.slice(0, 10),
          },
        }
      );
    }

    return report;
  } catch (err) {
    Sentry.captureException(err, { extra: { phase: "reconcileTurn", turn } });
    return null;
  }
}

/** Fetch the most recent persisted reconciliation (for the ops-dash / Watchtower section). */
export async function loadLatestReconciliation(db: Db): Promise<LedgerReconciliation | null> {
  return db
    .collection<LedgerReconciliation>(LEDGER_RECONCILIATIONS_COLLECTION)
    .findOne({}, { sort: { turn: -1 } });
}
