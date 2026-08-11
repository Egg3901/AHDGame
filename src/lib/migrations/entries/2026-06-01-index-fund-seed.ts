import { ObjectId, type Db } from "mongodb";
import type { Migration, MigrationContext, MigrationResult } from "../types";
import { getAllFundDefinitions } from "@/lib/indexFunds/fundDefinitions";
import {
  INDEX_FUND_INITIAL_NAV,
  INDEX_FUND_SEED_CASH_ANCHOR,
  INDEX_FUND_SEED_RESERVE_UNITS,
} from "@/lib/indexFunds/unitAccounting";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types";

/**
 * Upsert all index-fund definition documents into the indexFunds collection.
 * Idempotent — re-runs update existing docs to match current definitions.
 */
async function seedFundDefinitions(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const definitions = getAllFundDefinitions();
  const now = new Date();

  if (ctx.dryRun) {
    return {
      notes: [`would upsert ${definitions.length} fund definitions`],
      documentsScanned: 0,
      documentsUpdated: 0,
      documentsInserted: 0,
    };
  }

  let upserted = 0;
  const coll = db.collection<IndexFund>("indexFunds");
  const positions = db.collection<IndexFundPosition>("indexFundPositions");

  for (const def of definitions) {
    const filter = { slug: def.slug };
    const nowFields = {
      slug: def.slug,
      name: def.name,
      tickerSymbol: def.ticker,
      scope: def.scope,
      kind: def.kind,
      countryId: def.countryId,
      sectorType: def.sectorType,
      anchorCurrencyCode: def.anchorCurrencyCode,
      status: "active" as const,
      updatedAt: now,
    };
    const insertFields = {
      quotedNav: INDEX_FUND_INITIAL_NAV,
      unitSupply: INDEX_FUND_SEED_RESERVE_UNITS,
      reserveUnits: INDEX_FUND_SEED_RESERVE_UNITS,
      cashAnchor: INDEX_FUND_SEED_CASH_ANCHOR,
      targetConstituents: [],
      holdings: [],
      createdAt: now,
    };

    await coll.updateOne(
      filter,
      {
        $set: nowFields,
        $setOnInsert: { ...insertFields, _id: new ObjectId() },
      },
      { upsert: true }
    );

    const fundDoc = await coll.findOne(filter, { projection: { _id: 1 } });
    if (fundDoc) {
      await positions.updateOne(
        { fundId: fundDoc._id, holderKind: "fund_reserve" },
        {
          $setOnInsert: {
            fundId: fundDoc._id,
            holderKind: "fund_reserve",
            createdAt: now,
          },
          $set: {
            units: INDEX_FUND_SEED_RESERVE_UNITS,
            avgNavAnchor: INDEX_FUND_INITIAL_NAV,
            updatedAt: now,
          },
        },
        { upsert: true }
      );
    }
    upserted++;
  }

  return {
    notes: [`upserted ${upserted} fund definitions`],
    documentsScanned: definitions.length,
    documentsUpdated: upserted,
    documentsInserted: 0,
  };
}

export const migration: Migration = {
  id: "2026-06-01-index-fund-seed",
  description:
    "Upsert index-fund definition documents (32 funds, active, with seed cash/reserves).",
  idempotent: true,
  execute: seedFundDefinitions,
};
