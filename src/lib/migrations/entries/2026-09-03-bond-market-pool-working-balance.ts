import type { Db } from "mongodb";
import type { BondMarketPool } from "@/lib/db/types";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { sovereignFaceMaturingSoon } from "@/lib/bonds/marketPoolTurn";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * Top up each bond market pool to its rollover working balance.
 *
 * With a real primary market the pool re-buys each quarter's sovereign
 * rollover before the maturing series pays it back, so it needs one quarter
 * of maturing face in cash on top of the M2 share the seed gave it. Raises
 * `targetCashLocal` and `cashLocal` to that level where they are below it
 * (opening balance, same footing as the seed); never lowers either. Also
 * stamps `m2Local` from the latest money supply snapshot for the corporate
 * underwriting cap.
 */
async function topUpWorkingBalance(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const turnDoc = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const turn = turnDoc?.currentTurn ?? 0;
  const pools = await db
    .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
    .find({})
    .toArray();
  const notes: string[] = [];
  let updated = 0;
  for (const pool of pools) {
    const currency = pool._id as CurrencyCode;
    const rollover = await sovereignFaceMaturingSoon(db, currency, turn);
    const latest = await db
      .collection<{ currencyCode: string; m2?: number }>("moneySupplySnapshots")
      .find({ currencyCode: currency }, { projection: { m2: 1 }, sort: { turn: -1 }, limit: 1 })
      .toArray();
    const m2 = latest[0]?.m2;
    const target = Math.round(Math.max(pool.targetCashLocal ?? 0, rollover) * 100) / 100;
    const cash = Math.round(Math.max(pool.cashLocal ?? 0, target) * 100) / 100;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (target > (pool.targetCashLocal ?? 0)) set.targetCashLocal = target;
    if (cash > (pool.cashLocal ?? 0)) set.cashLocal = cash;
    if (Number.isFinite(m2) && m2! > 0) set.m2Local = m2;
    if (Object.keys(set).length === 1) continue;
    notes.push(
      `${currency}: target ${(pool.targetCashLocal ?? 0).toLocaleString("en-US")} -> ${target.toLocaleString("en-US")}, cash ${(pool.cashLocal ?? 0).toLocaleString("en-US")} -> ${cash.toLocaleString("en-US")}`
    );
    if (!ctx.dryRun) {
      await db
        .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
        .updateOne({ _id: pool._id }, { $set: set });
    }
    updated++;
  }
  return {
    notes: [`${ctx.dryRun ? "would top up" : "topped up"} ${updated} pools`, ...notes],
    documentsScanned: pools.length,
    documentsUpdated: ctx.dryRun ? 0 : updated,
  };
}

export const migration: Migration = {
  id: "2026-09-03-bond-market-pool-working-balance",
  description:
    "Raise each bond market pool to one quarter of maturing sovereign face so it can fund the rollover before maturities pay it back.",
  idempotent: true,
  execute: topUpWorkingBalance,
};
