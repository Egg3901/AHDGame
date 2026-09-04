import { ObjectId, type Db } from "mongodb";
import type { Migration, MigrationContext, MigrationResult } from "../types";
import { BOND_FUND_DEFINITIONS } from "@/lib/indexFunds/fundDefinitions";
import {
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
} from "@/lib/indexFunds/unitAccounting";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types";

/**
 * Seed the bond index funds (one home-sovereign fund per broad-fund country,
 * four global ones), on the same footing as the equity funds: initial NAV,
 * a reserve position, and seed cash the fund cron deploys into bonds from
 * the market pool. Insert-missing by slug; existing funds are left alone.
 */
async function seedBondFunds(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const now = new Date();
  const coll = db.collection<IndexFund>("indexFunds");
  const positions = db.collection<IndexFundPosition>("indexFundPositions");
  const existing = new Set(
    (
      await coll
        .find(
          { slug: { $in: BOND_FUND_DEFINITIONS.map((d) => d.slug) } },
          { projection: { slug: 1 } }
        )
        .toArray()
    ).map((f) => f.slug)
  );
  const missing = BOND_FUND_DEFINITIONS.filter((d) => !existing.has(d.slug));

  if (ctx.dryRun) {
    return {
      notes: [`would seed ${missing.length} bond funds`, ...missing.map((d) => d.slug)],
      documentsScanned: BOND_FUND_DEFINITIONS.length,
      documentsInserted: 0,
    };
  }

  for (const def of missing) {
    const fundId = new ObjectId();
    await coll.insertOne({
      _id: fundId,
      slug: def.slug,
      name: def.name,
      tickerSymbol: def.ticker,
      scope: def.scope,
      kind: def.kind,
      ...(def.countryId ? { countryId: def.countryId } : {}),
      anchorCurrencyCode: def.anchorCurrencyCode,
      status: "active",
      quotedNav: INDEX_FUND_INITIAL_NAV,
      unitSupply: INDEX_FUND_SEED_RESERVE_UNITS,
      reserveUnits: INDEX_FUND_SEED_RESERVE_UNITS,
      cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
      targetConstituents: [],
      holdings: [],
      createdAt: now,
      updatedAt: now,
    } as IndexFund);
    await positions.updateOne(
      { fundId, holderKind: "fund_reserve" },
      {
        $setOnInsert: { fundId, holderKind: "fund_reserve", createdAt: now },
        $set: {
          units: INDEX_FUND_SEED_RESERVE_UNITS,
          avgNavAnchor: INDEX_FUND_INITIAL_NAV,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  }

  return {
    notes: [`seeded ${missing.length} bond funds`, ...missing.map((d) => d.slug)],
    documentsScanned: BOND_FUND_DEFINITIONS.length,
    documentsInserted: missing.length,
  };
}

export const migration: Migration = {
  id: "2026-09-03-bond-fund-seed",
  description:
    "Seed the bond index funds: home sovereign per fund country plus four global bond funds.",
  idempotent: true,
  execute: seedBondFunds,
};
