import type { Db } from "mongodb";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { EquityMarketPool } from "@/lib/db/types";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { EQUITY_POOL_M2_SHARE } from "@/lib/equities/marketPool";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/** Seed the real cash counterpart to existing corporation public-float inventory. */
async function seedEquityMarketPools(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const [rateRows, corporationCurrencies, latestSnapshot] = await Promise.all([
    db
      .collection<{ currencyCode?: string }>("exchangeRates")
      .find({}, { projection: { currencyCode: 1 } })
      .toArray(),
    db
      .collection<{ liquidCurrencyCode?: string }>("corporations")
      .aggregate<{ _id: string | null }>([
        { $match: { isPrivate: { $ne: true }, hiddenFromExchange: { $ne: true } } },
        { $group: { _id: "$liquidCurrencyCode" } },
      ])
      .toArray(),
    db
      .collection<{ turn: number }>("moneySupplySnapshots")
      .find({}, { projection: { turn: 1 }, sort: { turn: -1 }, limit: 1 })
      .toArray(),
  ]);
  const currencies = new Set<string>(["USD"]);
  for (const row of rateRows) if (row.currencyCode) currencies.add(row.currencyCode);
  for (const row of corporationCurrencies) if (row._id) currencies.add(row._id);

  const m2ByCurrency = new Map<string, number>();
  const snapshotTurn = latestSnapshot[0]?.turn;
  if (snapshotTurn != null) {
    const rows = await db
      .collection<{ currencyCode: string; m2?: number }>("moneySupplySnapshots")
      .find({ turn: snapshotTurn }, { projection: { currencyCode: 1, m2: 1 } })
      .toArray();
    for (const row of rows) {
      if (Number.isFinite(row.m2) && row.m2! > 0) m2ByCurrency.set(row.currencyCode, row.m2!);
    }
  }

  const existing = new Set(
    (
      await db
        .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
        .find({}, { projection: { _id: 1 } })
        .toArray()
    ).map((pool) => String(pool._id))
  );
  const now = new Date();
  const docs: EquityMarketPool[] = [];
  const notes: string[] = [];
  for (const currency of [...currencies].sort()) {
    if (existing.has(currency)) continue;
    const target = Math.round((m2ByCurrency.get(currency) ?? 0) * EQUITY_POOL_M2_SHARE * 100) / 100;
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
      documentsScanned: currencies.size,
      documentsInserted: 0,
      notes: [`would seed ${docs.length} equity market pools`, ...notes],
    };
  }
  if (docs.length > 0) {
    await db.collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION).insertMany(docs);
  }
  return {
    documentsScanned: currencies.size,
    documentsInserted: docs.length,
    notes: [`seeded ${docs.length} equity market pools`, ...notes],
  };
}

export const migration: Migration = {
  id: "2026-09-03-equity-market-pools",
  description:
    "Seed one finite equity market pool per currency as the cash side of corporation public float.",
  idempotent: true,
  execute: seedEquityMarketPools,
};
