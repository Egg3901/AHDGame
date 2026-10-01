/**
 * Bond-pool cash accounting witnesses the upkeep and issuer receipts that land.
 * Modeled liquidity remains excluded inventory; coupon and maturity receipts
 * share the issuer's settlement reason. Trade journals retain their own legs.
 */
import * as Sentry from "@sentry/nextjs";
import type { ClientSession, Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondMarketPoolFlowKind } from "@/lib/db/types/bondMarketPool";
import type { FinancialTxType } from "@/lib/db/types/financialTxLog";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import type { LedgerEntryInput } from "@/lib/ledger/types";
import { emitLedgerEntries } from "@/lib/ledger/emit";

export interface BondPoolLedgerContext {
  turn: number;
  rates: ReadonlyMap<string, number>;
  /** A phase-owned batch; direct callers publish immediately. */
  pendingEntries?: LedgerEntryInput[];
}

/** Load once for a bond turn, from the same database as the cash writer. */
export async function loadBondPoolLedgerContext(
  db: Db,
  turn?: number
): Promise<BondPoolLedgerContext | null> {
  try {
    const config = await db
      .collection<{ _id: string; ledgerShadow?: boolean }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    if (config?.ledgerShadow !== true) return null;
    const [rates, state] = await Promise.all([
      db
        .collection<{ currencyCode: string; rate: number }>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      turn === undefined
        ? db
            .collection<{ _id: string; currentTurn: number }>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } })
        : Promise.resolve(null),
    ]);
    const resolvedTurn = turn ?? state?.currentTurn;
    if (resolvedTurn === undefined || !Number.isInteger(resolvedTurn)) {
      throw new Error("Bond-pool ledger witness requires a turn");
    }
    return { turn: resolvedTurn, rates: new Map(rates.map((r) => [r.currencyCode, r.rate])) };
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "loadBondPoolLedgerContext" } });
    return null;
  }
}

const FLOW_ACCOUNTING: Partial<
  Record<
    BondMarketPoolFlowKind,
    {
      txType: FinancialTxType;
      reason: string;
    }
  >
> = {
  inflowIn: { txType: "bond_pool_inflow", reason: "bond_pool_excluded_liquidity" },
  sweepOut: { txType: "bond_pool_sweep", reason: "bond_pool_excluded_liquidity" },
  couponsIn: { txType: "bond_coupon", reason: "bond_coupon_settlement" },
  maturitiesIn: { txType: "bond_maturity", reason: "bond_settlement" },
};

/** Called only after a successful cash write, using its rounded native amount. */
export async function witnessBondPoolCash(
  db: Db,
  currency: CurrencyCode,
  amount: number,
  kind: BondMarketPoolFlowKind,
  now: Date,
  options?: { ledgerContext?: BondPoolLedgerContext | null; session?: ClientSession }
): Promise<void> {
  const accounting = FLOW_ACCOUNTING[kind];
  // Secondary trades and primary placement are deliberately not inferred here.
  // Their settlement owner must also handle failed follow-up writes/refunds.
  if (!accounting) return;
  const context =
    options?.ledgerContext === undefined
      ? await loadBondPoolLedgerContext(db)
      : options.ledgerContext;
  if (!context) return;
  const rate = context.rates.get(currency);
  // Match bond_pool valuation in collectBalances, including its missing-rate fallback.
  const anchorAmount = !rate || rate <= 0 ? amount : amount / rate;
  const entry: LedgerEntryInput = {
    turn: context.turn,
    createdAt: now,
    txType: accounting.txType,
    emitSite: `bonds/marketPool:${kind}`,
    legs: [
      {
        account: accountId("bond_pool", currency, currency),
        amount,
        currencyCode: currency,
        anchorAmount,
        role: "primary",
      },
      {
        account: mintSinkAccount(anchorAmount, accounting.reason, currency),
        amount: -amount,
        currencyCode: currency,
        anchorAmount: -anchorAmount,
        role: "contra",
      },
    ],
  };
  if (context.pendingEntries && !options?.session) {
    context.pendingEntries.push(entry);
  } else {
    await emitLedgerEntries(
      db,
      [entry],
      options?.session ? { session: options.session } : undefined
    );
  }
}

/** Publish one batch even if a later phase operation fails after moving cash. */
export async function withBondPoolLedgerBatch<T>(
  db: Db,
  context: BondPoolLedgerContext | null,
  work: (context: BondPoolLedgerContext | null) => Promise<T>
): Promise<T> {
  const batch = context ? { ...context, pendingEntries: [] as LedgerEntryInput[] } : null;
  try {
    return await work(batch);
  } finally {
    if (batch) await emitLedgerEntries(db, batch.pendingEntries);
  }
}
