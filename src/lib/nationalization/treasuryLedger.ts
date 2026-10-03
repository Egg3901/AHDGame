/**
 * State-enterprise treasury accounting witnesses the cash that remittances, CEO
 * draws, loss backing and capex grants actually move. Treasury legs use the
 * balance snapshot's treasury valuation; both sides of a transfer share the
 * flow's settlement reason so the money-supply check nets them, and a capex
 * grant sinks into the plant it buys.
 */
import * as Sentry from "@sentry/nextjs";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { treasuryAnchorValuation } from "@/lib/budget/rules/treasuryAccrual";
import { accountId, mintSinkAccount } from "@/lib/ledger/accounts";
import { snapshotTreasuryCurrency } from "@/lib/ledger/balanceSnapshot";
import { emitLedgerEntries } from "@/lib/ledger/emit";
import type { LedgerEntryInput } from "@/lib/ledger/types";
import type { FinancialTxType } from "@/lib/db/types/financialTxLog";

/**
 * Each flow's transaction type and settlement reason. Event-driven flows reuse
 * their counterparty row's type and reason so the money-supply check nets the
 * treasury leg against it.
 */
const FLOW_ACCOUNTING = {
  soe_remittance: { txType: "soe_remittance", reason: "soe_remittance" },
  soe_treasury_draw: { txType: "soe_treasury_draw", reason: "soe_treasury_draw" },
  soe_loss_backing: { txType: "soe_loss_backing", reason: "soe_loss_backing" },
  soe_capex_grant: { txType: "soe_capex_grant", reason: "soe_capex_grant" },
  nationalization_compensation: {
    txType: "nationalization_compensation",
    reason: "nationalization_compensation",
  },
  group_loss_relief: { txType: "corp_group_relief", reason: "corporate_group_transfer" },
  regulatory_fine: { txType: "corp_fine", reason: "regulatory_fine" },
} as const satisfies Record<string, { txType: FinancialTxType; reason: string }>;

export type TreasuryCashFlow = keyof typeof FLOW_ACCOUNTING;

export interface TreasuryCashContext {
  turn: number;
  preset: string;
  rates: ReadonlyMap<string, number>;
  treasuryCurrencies: ReadonlyMap<string, CurrencyCode>;
  /** A phase-owned batch; direct callers publish immediately. */
  pending?: LedgerEntryInput[];
}

/** `context: undefined` loads one for an immediate witness; `null` means shadow accounting is off. */
export interface TreasuryCashOptions {
  context?: TreasuryCashContext | null;
}

export type TreasuryCashAccount =
  | { kind: "government"; countryId: CountryId }
  | { kind: "corporation"; corpId: string; currency: CurrencyCode };

/** One projected read per phase, from the same database as the cash writer. */
export async function loadTreasuryCashContext(
  db: Db,
  turn?: number
): Promise<TreasuryCashContext | null> {
  try {
    const config = await db
      .collection<{ _id: string; ledgerShadow?: boolean }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { ledgerShadow: 1 } });
    if (config?.ledgerShadow !== true) return null;
    const [state, rates, budgets] = await Promise.all([
      db
        .collection<{ _id: string; currentTurn: number; preset?: string }>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1, preset: 1 } }),
      db
        .collection<{ currencyCode: string; rate: number }>("exchangeRates")
        .find({}, { projection: { currencyCode: 1, rate: 1 } })
        .toArray(),
      db
        .collection<{ countryId: string; currencyCode?: CurrencyCode }>("federalBudget")
        .find({}, { projection: { countryId: 1, currencyCode: 1 } })
        .toArray(),
    ]);
    const resolvedTurn = turn ?? state?.currentTurn;
    if (resolvedTurn === undefined || !Number.isInteger(resolvedTurn)) {
      throw new Error("Treasury cash witness requires a turn");
    }
    return {
      turn: resolvedTurn,
      preset: state?.preset ?? DEFAULT_SEED_PRESET,
      rates: new Map(rates.map((row) => [row.currencyCode, row.rate])),
      treasuryCurrencies: new Map(
        budgets.map((row) => [row.countryId, snapshotTreasuryCurrency(row)])
      ),
    };
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "loadTreasuryCashContext" } });
    return null;
  }
}

/** Resolve once so both legs of a transfer share one context. */
export async function resolveTreasuryCashOptions(
  db: Db,
  options?: TreasuryCashOptions
): Promise<TreasuryCashOptions> {
  return options?.context === undefined ? { context: await loadTreasuryCashContext(db) } : options;
}

/** Called only after the authoritative write landed, with its signed native amount. */
export async function witnessTreasuryCash(
  db: Db,
  options: TreasuryCashOptions | undefined,
  input: {
    flow: TreasuryCashFlow;
    account: TreasuryCashAccount;
    amount: number;
    now: Date;
    site: string;
  }
): Promise<void> {
  if (!Number.isFinite(input.amount) || input.amount === 0) return;
  try {
    const { context } = await resolveTreasuryCashOptions(db, options);
    if (!context) return;
    const { account } = input;
    let ledgerAccount: string;
    let currency: CurrencyCode;
    let anchorRate: number;
    if (account.kind === "government") {
      currency =
        context.treasuryCurrencies.get(account.countryId) ??
        snapshotTreasuryCurrency({ countryId: account.countryId });
      ledgerAccount = accountId("government", account.countryId, currency);
      anchorRate = treasuryAnchorValuation({
        countryId: account.countryId,
        currencyCode: currency,
        preset: context.preset,
        observedRate: context.rates.get(currency),
      }).anchorRate;
    } else {
      currency = account.currency;
      ledgerAccount = accountId("corporation", account.corpId, currency);
      const rate = context.rates.get(currency);
      // Same missing-rate fallback as the snapshot's corporation valuation.
      anchorRate = !rate || rate <= 0 ? 1 : rate;
    }
    const anchorAmount = input.amount / anchorRate;
    const entry: LedgerEntryInput = {
      turn: context.turn,
      createdAt: input.now,
      txType: FLOW_ACCOUNTING[input.flow].txType,
      emitSite: `nationalization/${input.site}`,
      legs: [
        {
          account: ledgerAccount,
          amount: input.amount,
          currencyCode: currency,
          anchorAmount,
          role: "primary",
        },
        {
          account: mintSinkAccount(anchorAmount, FLOW_ACCOUNTING[input.flow].reason, currency),
          amount: -input.amount,
          currencyCode: currency,
          anchorAmount: -anchorAmount,
          role: "contra",
        },
      ],
    };
    if (context.pending) context.pending.push(entry);
    else await emitLedgerEntries(db, [entry]);
  } catch (error) {
    Sentry.captureException(error, { extra: { phase: "witnessTreasuryCash", site: input.site } });
  }
}

/** Publish one batch even if later work in the phase fails after cash moved. */
export async function withTreasuryCashBatch<T>(
  db: Db,
  context: TreasuryCashContext | null,
  work: (options: TreasuryCashOptions) => Promise<T>
): Promise<T> {
  const pending: LedgerEntryInput[] = [];
  try {
    return await work({ context: context ? { ...context, pending } : null });
  } finally {
    await emitLedgerEntries(db, pending);
  }
}
