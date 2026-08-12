import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

/**
 * A4: indexes for the two reads the index-fund turn phase does most.
 *
 * `bonds.holders.fundId` had NO index at all. `listFundBondHoldings` filters
 * `{ matured, defaulted, holders: { $elemMatch: { fundId } } }`, and the
 * existing bonds indexes lead with `holders.characterId`, `issuerType` or
 * `corporationId`, none of which help. That query runs FOUR times per fund per
 * turn (pass-1 NAV, again after bond deployment, in the drift rebalance, and in
 * pass 3), so every active fund was collection-scanning `bonds` four times a
 * turn. This is the same class of miss #2817 found for the nationalization
 * path, in the phase that was already the slowest in the turn.
 *
 * `shareOrders.placerFundId` had no index either. The rebalance reads a fund's
 * open bids twice per turn, once before cancelling stale ones and once after.
 */
type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "bonds",
    // Leading with the array field is what makes the $elemMatch selective; the
    // two flags then cut the matured/defaulted rows without fetching them.
    keys: { "holders.fundId": 1, matured: 1, defaulted: 1 },
    options: { name: "bonds_holders_fundId_active", sparse: true, background: true },
  },
  {
    collection: "shareOrders",
    keys: { placerFundId: 1, type: 1, status: 1 },
    options: { name: "share_orders_fund_open_bids", sparse: true, background: true },
  },
];

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }
    await db.collection(plan.collection).createIndex(plan.keys, plan.options);
    notes.push(`created/verified ${label}`);
  }
  return {
    documentsScanned: INDEXES.length,
    documentsUpdated: dryRun ? 0 : INDEXES.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-08-10-index-fund-phase-indexes",
  description:
    "Indexes for the index-fund phase hot reads: bond holdings by fund, and a fund's open share bids.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
