import type { CreateIndexesOptions, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";
import {
  INTELLIGENCE_AGENCIES,
  INTELLIGENCE_COVERAGE,
  INTELLIGENCE_NETWORKS,
  INTELLIGENCE_OP_LOG,
} from "@/lib/db/collections/intelligence";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

/**
 * Indexes for the national intelligence spine, on a live database.
 *
 * `seedIndexes` covers a freshly seeded world; a running world never re-seeds,
 * so the same indexes have to arrive through a migration. Three of them are
 * unique and load-bearing: the agency, network, and coverage read paths assume
 * at most one row per key rather than re-checking, so a live world without them
 * can silently accumulate duplicates that the code then picks between at random.
 *
 * Create-only and idempotent. `createIndex` on an existing identical index is a
 * no-op, so a re-run is safe and a partially applied run resumes cleanly.
 */
const INDEXES: IndexPlan[] = [
  {
    collection: INTELLIGENCE_AGENCIES,
    keys: { countryId: 1 },
    options: { name: "intelligenceAgencies_countryId", unique: true, background: true },
  },
  {
    collection: INTELLIGENCE_NETWORKS,
    keys: { ownerCountryId: 1, targetCountryId: 1 },
    options: { name: "intelligenceNetworks_owner_target", unique: true, background: true },
  },
  {
    collection: INTELLIGENCE_COVERAGE,
    keys: { ownerCountryId: 1, targetCountryId: 1, domain: 1 },
    options: {
      name: "intelligenceCoverage_owner_target_domain",
      unique: true,
      background: true,
    },
  },
  {
    collection: INTELLIGENCE_OP_LOG,
    keys: { targetCountryId: 1, turn: -1 },
    options: { name: "intelligenceOpLog_target_turn", background: true },
  },
  {
    collection: INTELLIGENCE_OP_LOG,
    keys: { ownerCountryId: 1, turn: -1 },
    options: { name: "intelligenceOpLog_owner_turn", background: true },
  },
];

export const migration: Migration = {
  id: "2026-08-31-intelligence-indexes",
  description: "Unique and read-path indexes for the intelligence collections.",
  idempotent: true,
  execute: async (db, ctx): Promise<MigrationResult> => {
    const notes: string[] = [];
    for (const plan of INDEXES) {
      const label = `${plan.collection}.${plan.options.name}`;
      if (ctx.dryRun) {
        notes.push(`would create ${label}`);
        continue;
      }
      await db.collection(plan.collection).createIndex(plan.keys, plan.options);
      notes.push(`created/verified ${label}`);
    }
    return {
      documentsScanned: INDEXES.length,
      documentsUpdated: ctx.dryRun ? 0 : INDEXES.length,
      notes,
    };
  },
};
