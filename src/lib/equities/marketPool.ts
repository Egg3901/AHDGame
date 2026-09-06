/**
 * Finite equity market pool: the cash side of corporation `publicFloat`.
 *
 * Every amount accepted here is in the corporation's local currency. The
 * corporation document remains the inventory authority; this module is the
 * one accounting authority for the public float's cash and quote depth.
 */

import type { ClientSession, Db } from "mongodb";
import type { Corporation, EquityMarketPool, EquityMarketPoolFlowKind } from "@/lib/db/types";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { resolveShareExecutionPrice } from "@/lib/corporations/marketExecution";
import { quoteEquityPrices, type EquityPoolQuote } from "@/lib/equities/marketPoolQuotes";

/** Share of broad money used as the pool's long-run secondary-liquidity target. */
export const EQUITY_POOL_M2_SHARE = 0.05;

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function equityPoolCurrency(corporation: {
  liquidCurrencyCode?: string | null;
  countryId?: string;
}): CurrencyCode {
  return (corporation.liquidCurrencyCode ??
    COUNTRY_CURRENCY_MAP[corporation.countryId as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
}

export async function readEquityPool(
  db: Db,
  currency: CurrencyCode,
  options?: { session?: ClientSession }
): Promise<EquityMarketPool | null> {
  return db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .findOne({ _id: currency }, options?.session ? { session: options.session } : undefined);
}

export async function creditEquityPool(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: EquityMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<void> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
    { _id: currency },
    {
      $inc: { cashLocal: amount, [`lifetime.${kind}`]: amount },
      $set: { updatedAt: now },
      $setOnInsert: { targetCashLocal: 0, createdAt: now },
    },
    { upsert: true, ...(options?.session ? { session: options.session } : {}) }
  );
}

/**
 * Credit many accruals to the equity market pools in one pass.
 *
 * Behaviourally identical to calling `creditEquityPool` per accrual, and for
 * the same reason the index-fund dividend batch is: the write is a pure `$inc`,
 * so it is additive and order-independent, and totals aggregate to the same
 * balance however they are grouped. Rounding still happens PER ACCRUAL before
 * summing, exactly as the per-call path does, so a run of sub-cent accruals
 * still contributes nothing rather than adding up to a cent.
 *
 * The reason this exists: corporationTurn credited these one accrual at a
 * time, each preceded by its own `readEquityPool` existence check, against a
 * collection with one document per currency. That was thousands of serial
 * round trips per turn to touch at most a couple of dozen documents, and
 * measured as the second-heaviest collection in the heaviest phase.
 *
 * A currency with no pool document is skipped, not upserted: a missing pool
 * means a pre-migration world, and creating a zero-target one halfway through
 * a turn would silently replace the legacy sink.
 */
export async function creditEquityPoolsBatch(
  db: Db,
  accruals: readonly { currency: CurrencyCode; amountLocal: number }[],
  kind: EquityMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<void> {
  const totalByCurrency = new Map<CurrencyCode, number>();
  for (const accrual of accruals) {
    const amount = roundCents(accrual.amountLocal);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    totalByCurrency.set(accrual.currency, (totalByCurrency.get(accrual.currency) ?? 0) + amount);
  }
  if (totalByCurrency.size === 0) return;

  // One read to learn which pools exist, replacing the per-accrual findOne.
  const currencies = [...totalByCurrency.keys()];
  const existing = await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .find(
      { _id: { $in: currencies } },
      { projection: { _id: 1 }, ...(options?.session ? { session: options.session } : {}) }
    )
    .toArray();
  const present = new Set(existing.map((pool) => pool._id));

  const ops = currencies
    .filter((currency) => present.has(currency))
    .map((currency) => ({
      updateOne: {
        filter: { _id: currency },
        update: {
          $inc: {
            cashLocal: totalByCurrency.get(currency)!,
            [`lifetime.${kind}`]: totalByCurrency.get(currency)!,
          },
          $set: { updatedAt: now },
        },
      },
    }));
  if (ops.length === 0) return;

  await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing; runtime shape is valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .bulkWrite(ops as any[], options?.session ? { session: options.session } : undefined);
}

export async function debitEquityPoolGated(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: EquityMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<{ ok: true; cashAfter: number } | { ok: false }> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  if (amount === 0) {
    const pool = await readEquityPool(db, currency, options);
    return { ok: true, cashAfter: Math.max(0, pool?.cashLocal ?? 0) };
  }
  const result = await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .findOneAndUpdate(
      { _id: currency, cashLocal: { $gte: amount } },
      {
        $inc: { cashLocal: -amount, [`lifetime.${kind}`]: amount },
        $set: { updatedAt: now },
      },
      {
        returnDocument: "after",
        projection: { cashLocal: 1 },
        ...(options?.session ? { session: options.session } : {}),
      }
    );
  return result ? { ok: true, cashAfter: result.cashLocal } : { ok: false };
}

export async function refundEquityPoolDebit(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: EquityMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<void> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).updateOne(
    { _id: currency },
    {
      $inc: { cashLocal: amount, [`lifetime.${kind}`]: -amount },
      $set: { updatedAt: now },
    },
    options?.session ? { session: options.session } : undefined
  );
}

export interface LoadedEquityQuote extends EquityPoolQuote {
  active: boolean;
  currency: CurrencyCode;
  poolCashLocal: number;
  targetCashLocal: number;
  bidPriceLocal: number;
  askPriceLocal: number;
  bidDepthShares: number;
  askDepthShares: number;
}

/** Load the pool's executable quote. A missing pool preserves legacy mid-price settlement. */
export async function loadEquityQuote(
  db: Db,
  corporation: Pick<
    Corporation,
    | "countryId"
    | "liquidCurrencyCode"
    | "fundamentalSharePrice"
    | "publicFloat"
    | "sharePrice"
    | "totalShares"
  >
): Promise<LoadedEquityQuote> {
  const currency = equityPoolCurrency(corporation);
  const pool = await readEquityPool(db, currency);
  const mid = resolveShareExecutionPrice(corporation);
  if (!pool) {
    return {
      active: false,
      currency,
      poolCashLocal: 0,
      targetCashLocal: 0,
      mid,
      bid: mid,
      ask: mid,
      halfSpread: 0,
      cashSkew: 0,
      bidPriceLocal: mid,
      askPriceLocal: mid,
      bidDepthShares: Number.MAX_SAFE_INTEGER,
      askDepthShares: Math.max(0, Math.floor(corporation.publicFloat ?? 0)),
    };
  }
  const quote = quoteEquityPrices({
    marketPrice: mid,
    cashLocal: pool.cashLocal,
    targetCashLocal: pool.targetCashLocal,
  });
  return {
    ...quote,
    active: true,
    currency,
    poolCashLocal: Math.max(0, pool.cashLocal ?? 0),
    targetCashLocal: Math.max(0, pool.targetCashLocal ?? 0),
    bidPriceLocal: quote.bid,
    askPriceLocal: quote.ask,
    bidDepthShares:
      quote.bid > 0 ? Math.floor((Math.max(0, pool.cashLocal ?? 0) + 1e-9) / quote.bid) : 0,
    askDepthShares: Math.max(0, Math.floor(corporation.publicFloat ?? 0)),
  };
}

export function equityPoolDepthMessage(fillableShares: number, currency: CurrencyCode): string {
  if (fillableShares <= 0) {
    return `The ${currency} equity market has no cash to buy right now. Place a limit order or try again after the next turn.`;
  }
  return `The ${currency} equity market can only absorb ${fillableShares.toLocaleString("en-US")} shares at this price right now. Sell that many, place a limit order, or wait for the next turn.`;
}
