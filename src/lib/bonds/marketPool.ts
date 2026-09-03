/**
 * Bond market pool: the cash side of `Bond.publicFloat`.
 *
 * Before this module every trade against the float minted or burned money.
 * Buying from the float destroyed the buyer's cash, selling to it created the
 * seller's proceeds from nothing, and coupons on float units vanished. The
 * pool is the counterparty that was missing: one document per currency, real
 * cash, credited by purchases and by issuer coupon and maturity payments on
 * the units it holds, debited by sales and by primary-market underwriting.
 *
 * Every helper here takes LOCAL amounts in the bond's own currency. Callers
 * that hold anchor values convert before calling.
 */

import type { ClientSession, Db } from "mongodb";
import type { Bond, BondMarketPool, BondMarketPoolFlowKind } from "@/lib/db/types";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";

/** Share of a currency's broad money (M2) the pool is seeded with and steered toward. */
export const BOND_POOL_M2_SHARE = 0.05;

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The currency a bond's units, coupons and float trade in. */
export function bondPoolCurrency(bond: Pick<Bond, "currencyCode" | "countryId">): CurrencyCode {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
}

export async function readBondPoolCash(db: Db, currency: CurrencyCode): Promise<number> {
  const pool = await db
    .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
    .findOne({ _id: currency }, { projection: { cashLocal: 1 } });
  const cash = pool?.cashLocal;
  return Number.isFinite(cash) && cash! > 0 ? cash! : 0;
}

/**
 * Add cash to a pool. Upserts so a currency that has never traded gets a pool
 * the first time money flows into it; `targetCashLocal` starts at zero in that
 * case and the turn engine sizes it later.
 */
export async function creditBondPool(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: BondMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<void> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).updateOne(
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
 * Take cash out of a pool only if it is there. Returns `ok: false` when the
 * pool cannot cover the amount; nothing is written in that case. This is the
 * single place secondary liquidity becomes finite.
 */
export async function debitBondPoolGated(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: BondMarketPoolFlowKind,
  now: Date = new Date(),
  options?: { session?: ClientSession }
): Promise<{ ok: true; cashAfter: number } | { ok: false }> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };
  if (amount === 0) return { ok: true, cashAfter: await readBondPoolCash(db, currency) };
  const result = await db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).findOneAndUpdate(
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
  if (!result) return { ok: false };
  return { ok: true, cashAfter: result.cashLocal };
}

/**
 * Reverse a gated debit whose follow-up write failed. Puts the cash back and
 * unwinds the lifetime counter so the flow never happened as far as the audit
 * is concerned.
 */
export async function refundBondPoolDebit(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: BondMarketPoolFlowKind,
  now: Date = new Date()
): Promise<void> {
  const amount = roundCents(amountLocal);
  if (!Number.isFinite(amount) || amount <= 0) return;
  await db
    .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
    .updateOne(
      { _id: currency },
      { $inc: { cashLocal: amount, [`lifetime.${kind}`]: -amount }, $set: { updatedAt: now } }
    );
}

/**
 * Pay as much of `amountLocal` as the pool can afford, atomically. Used where
 * the pool is taking units it did not ask for (a liquidated estate's bond
 * holdings) and a refusal is not an option: the estate gets what the market
 * can pay and the rest is a loss to the estate, not minted.
 */
export async function debitBondPoolUpTo(
  db: Db,
  currency: CurrencyCode,
  amountLocal: number,
  kind: BondMarketPoolFlowKind,
  now: Date = new Date()
): Promise<number> {
  const wanted = roundCents(amountLocal);
  if (!Number.isFinite(wanted) || wanted <= 0) return 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cash = await readBondPoolCash(db, currency);
    const amount = roundCents(Math.min(wanted, cash));
    if (amount <= 0) return 0;
    const debit = await debitBondPoolGated(db, currency, amount, kind, now);
    if (debit.ok) return amount;
  }
  return 0;
}

/**
 * How many of `requestedUnits` the pool can buy at `pricePerUnitLocal` with
 * `cashLocal` on hand. Whole units only.
 */
export function bondPoolFillableUnits(
  cashLocal: number,
  pricePerUnitLocal: number,
  requestedUnits: number
): number {
  if (!(pricePerUnitLocal > 0) || !(requestedUnits > 0)) return 0;
  const cash = Number.isFinite(cashLocal) && cashLocal > 0 ? cashLocal : 0;
  return Math.max(0, Math.min(Math.floor(requestedUnits), Math.floor(cash / pricePerUnitLocal)));
}

/** Player-facing refusal when the pool cannot take a sale in full. */
export function bondPoolDepthMessage(fillableUnits: number, currency: CurrencyCode): string {
  if (fillableUnits <= 0) {
    return `The ${currency} bond market has no cash to buy right now. Try again after the next turn, when coupon income has replenished it.`;
  }
  return `The ${currency} bond market can only absorb ${fillableUnits.toLocaleString("en-US")} units at this price right now. Sell that many, or wait for the next turn.`;
}
