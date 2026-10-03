/**
 * Bond-pool accounting records actual upkeep, issuer receipts, secondary trades
 * and refunds via witnessBondPoolCash. Modeled liquidity remains excluded
 * inventory; primary financing keeps its own journal. Phase snapshots batch reads.
 */
import { AsyncLocalStorage } from "node:async_hooks";
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

interface PoolLedgerScope {
  db: Db;
  context: () => Promise<BondPoolLedgerContext | null>;
}
const poolLedgerScope = new AsyncLocalStorage<PoolLedgerScope>();

/** Reuse the phase's stable rates and shared batch, never another world's context. */
export async function currentBondPoolLedgerContext(db: Db): Promise<BondPoolLedgerContext | null> {
  const scope = poolLedgerScope.getStore();
  return scope?.db === db ? scope.context() : loadBondPoolLedgerContext(db);
}

/** Load lazily once per phase and flush every landed cash witness, including on errors. */
export async function withBondPoolLedgerSnapshot<T>(
  db: Db,
  turn: number | undefined,
  work: () => Promise<T>
): Promise<T> {
  if (poolLedgerScope.getStore()?.db === db) return work();
  let loaded: Promise<BondPoolLedgerContext | null> | undefined;
  const state: { batch: BondPoolLedgerContext | null } = { batch: null };
  const context = () =>
    (loaded ??= loadBondPoolLedgerContext(db, turn).then((value) => {
      state.batch = value ? { ...value, pendingEntries: [] } : null;
      return state.batch;
    }));
  try {
    return await poolLedgerScope.run({ db, context }, work);
  } finally {
    if (loaded) await loaded;
    if (state.batch) await emitLedgerEntries(db, state.batch.pendingEntries!);
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
  purchasesIn: { txType: "bond_purchase", reason: "bond_principal_investment" },
  salesOut: { txType: "bond_sell", reason: "bond_principal_investment" },
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
  // Primary placement remains owned by its financing journal. Secondary cash
  // and its refunds use this same pool-side writer, separate from wallet rows.
  if (!accounting) return;
  const context =
    options?.ledgerContext === undefined
      ? await currentBondPoolLedgerContext(db)
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
    return await poolLedgerScope.run({ db, context: async () => batch }, () => work(batch));
  } finally {
    if (batch) await emitLedgerEntries(db, batch.pendingEntries);
  }
}
