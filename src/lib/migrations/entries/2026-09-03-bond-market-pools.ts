import type { Db } from "mongodb";
import type { Migration, MigrationContext, MigrationResult } from "../types";
import type { BondMarketPool } from "@/lib/db/types";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { BOND_POOL_M2_SHARE } from "@/lib/bonds/marketPool";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Opening balance sheet for the bond market pools.
 *
 * Every unit sitting in `Bond.publicFloat` becomes the pool's inventory as it
 * stands (that paper was never paid for by anyone, so there is nothing to
 * unwind). The cash side is seeded at a share of the currency's latest broad
 * money so the pool can buy back what players sell from day one. Insert-only:
 * a pool that already exists is left alone, so re-running is safe.
 */
async function seedBondMarketPools(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const [exchangeRateRows, bondCurrencyRows, latestSnapshot] = await Promise.all([
    db
      .collection<{ currencyCode?: string }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1 } })
      .toArray(),
    db
      .collection<{ currencyCode?: string }>("bonds")
      .aggregate<{ _id: string | null }>([
        { $match: { matured: { $ne: true } } },
        { $group: { _id: "$currencyCode" } },
      ])
      .toArray(),
    db
      .collection<{ turn: number }>("moneySupplySnapshots")
      .find({}, { projection: { turn: 1 }, sort: { turn: -1 }, limit: 1 })
      .toArray(),
  ]);

  const currencies = new Set<string>();
  for (const row of exchangeRateRows) if (row.currencyCode) currencies.add(row.currencyCode);
  for (const row of bondCurrencyRows) if (row._id) currencies.add(row._id);

  const snapshotTurn = latestSnapshot[0]?.turn;
  const m2ByCurrency = new Map<string, number>();
  if (snapshotTurn != null) {
    const rows = await db
      .collection<{ currencyCode: string; m2?: number }>("moneySupplySnapshots")
      .find({ turn: snapshotTurn }, { projection: { currencyCode: 1, m2: 1 } })
      .toArray();
    for (const row of rows)
      if (Number.isFinite(row.m2) && row.m2! > 0) m2ByCurrency.set(row.currencyCode, row.m2!);
  }

  const existing = new Set(
    (
      await db
        .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
        .find({}, { projection: { _id: 1 } })
        .toArray()
    ).map((pool) => String(pool._id))
  );

  const notes: string[] = [];
  const now = new Date();
  const docs: BondMarketPool[] = [];
  for (const currency of [...currencies].sort()) {
    if (existing.has(currency)) continue;
    const target = Math.round((m2ByCurrency.get(currency) ?? 0) * BOND_POOL_M2_SHARE * 100) / 100;
    docs.push({
      _id: currency as CurrencyCode,
      cashLocal: target,
      targetCashLocal: target,
      lifetime: {},
      createdAt: now,
      updatedAt: now,
    });
    notes.push(
      `${currency}: seed cash ${target.toLocaleString("en-US")}${
        m2ByCurrency.has(currency) ? "" : " (no money-supply snapshot, starts empty)"
      }`
    );
  }

  if (ctx.dryRun) {
    return {
      notes: [`would seed ${docs.length} bond market pools`, ...notes],
      documentsScanned: currencies.size,
      documentsInserted: 0,
    };
  }
  if (docs.length > 0) {
    await db.collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION).insertMany(docs);
  }
  return {
    notes: [`seeded ${docs.length} bond market pools`, ...notes],
    documentsScanned: currencies.size,
    documentsInserted: docs.length,
  };
}

export const migration: Migration = {
  id: "2026-09-03-bond-market-pools",
  description:
    "Seed one bond market pool per currency: float becomes pool inventory, cash starts at a share of M2.",
  idempotent: true,
  execute: seedBondMarketPools,
};
