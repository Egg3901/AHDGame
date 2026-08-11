import type { Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: {
    name: string;
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    partialFilterExpression?: Record<string, unknown>;
  };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "indexFunds",
    keys: { slug: 1 },
    options: { name: "idx_indexFunds_slug_unique", unique: true, background: true },
  },
  {
    collection: "indexFunds",
    keys: { tickerSymbol: 1 },
    options: { name: "idx_indexFunds_ticker_unique", unique: true, background: true },
  },
  {
    collection: "indexFunds",
    keys: { status: 1, scope: 1, countryId: 1, kind: 1 },
    options: { name: "idx_indexFunds_listing", background: true },
  },
  {
    collection: "indexFundPositions",
    keys: { fundId: 1, holderKind: 1, characterId: 1 },
    options: {
      name: "idx_indexFundPositions_character_unique",
      unique: true,
      background: true,
      partialFilterExpression: { characterId: { $exists: true } },
    },
  },
  {
    collection: "indexFundPositions",
    keys: { fundId: 1, holderKind: 1, imperialCharacterId: 1 },
    options: {
      name: "idx_indexFundPositions_imperial_unique",
      unique: true,
      background: true,
      partialFilterExpression: { imperialCharacterId: { $exists: true } },
    },
  },
  {
    collection: "indexFundPositions",
    keys: { fundId: 1, holderKind: 1, nppId: 1 },
    options: {
      name: "idx_indexFundPositions_npp_unique",
      unique: true,
      background: true,
      partialFilterExpression: { nppId: { $exists: true } },
    },
  },
  {
    collection: "indexFundPositions",
    keys: { fundId: 1, holderKind: 1 },
    options: {
      name: "idx_indexFundPositions_reserve_unique",
      unique: true,
      background: true,
      partialFilterExpression: { holderKind: "fund_reserve" },
    },
  },
  {
    collection: "indexFundTransactions",
    keys: { fundId: 1, createdAt: -1 },
    options: { name: "idx_indexFundTransactions_fund_created", background: true },
  },
  {
    collection: "indexFundTransactions",
    keys: { characterId: 1, createdAt: -1 },
    options: {
      name: "idx_indexFundTransactions_character_created",
      sparse: true,
      background: true,
    },
  },
  {
    collection: "indexFundRedemptionQueue",
    keys: { fundId: 1, status: 1, createdAt: 1 },
    options: { name: "idx_indexFundRedemptionQueue_fifo", background: true },
  },
  {
    collection: "indexFundSnapshots",
    keys: { fundId: 1, turn: 1 },
    options: { name: "idx_indexFundSnapshots_fund_turn_unique", unique: true, background: true },
  },
  {
    collection: "corporations",
    keys: { "shareholders.fundId": 1 },
    options: { name: "idx_corporations_shareholders_fundId", sparse: true, background: true },
  },
];

/** Stable key-spec comparison (field order matters for compound indexes). */
function sameKeySpec(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/**
 * Reconcile one planned index against what already exists on the collection.
 *
 * The same logical indexes are also ensured by the seed lane
 * (`seedIndexFundIndexes`), which creates them under different names — e.g.
 * `indexFunds_slug` vs this migration's `idx_indexFunds_slug_unique`. A fresh
 * bootstrap seeds first, so a plain `createIndex` here would throw
 * "Index already exists with a different name" and abort the bootstrap before
 * officials/NPPs are seeded. To stay the source of truth, we drop any existing
 * index with the same key spec but a divergent name/options and recreate the
 * canonical one. An exact match (same name + options) is left untouched.
 */
async function reconcileIndex(
  db: Db,
  plan: IndexPlan
): Promise<"created" | "reconciled" | "verified"> {
  const coll = db.collection(plan.collection);
  // A not-yet-created collection has no indexes to reconcile; introspecting it
  // can throw (NamespaceNotFound) depending on driver version, so treat a failed
  // lookup as "no existing indexes" — createIndex below implicitly creates the
  // collection, matching the pre-reconcile behavior.
  const currentIndexes = await coll.indexes().catch(() => []);
  const existing = currentIndexes.find((ix) => sameKeySpec(ix.key, plan.keys));

  if (existing) {
    const matches =
      existing.name === plan.options.name &&
      !!existing.unique === !!plan.options.unique &&
      !!existing.sparse === !!plan.options.sparse &&
      sameKeySpec(existing.partialFilterExpression, plan.options.partialFilterExpression);
    if (matches) return "verified";

    // Divergent index on the same keys (e.g. the seed's name/options) — drop it
    // so the canonical definition below can take over.
    if (existing.name) await coll.dropIndex(existing.name);
    await coll.createIndex(plan.keys, plan.options);
    return "reconciled";
  }

  await coll.createIndex(plan.keys, plan.options);
  return "created";
}

async function createPlannedIndexes(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
      continue;
    }
    const outcome = await reconcileIndex(db, plan);
    notes.push(`${outcome} ${label}`);
  }

  return {
    documentsScanned: INDEXES.length,
    documentsUpdated: dryRun ? 0 : INDEXES.length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-06-01-index-fund-foundation",
  description: "Create index-fund collection indexes and fund-owned shareholder lookup index.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
