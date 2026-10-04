import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";

const INDEXES = [
  {
    collection: "corporateSectors",
    keys: { corporationId: 1, stateId: 1, sectorType: 1, industryModel: 1 },
    options: {
      name: "corporateSectors_corporationId_stateId_sectorType_industryModel",
      unique: true,
      background: true,
    },
    legacyName: "corporateSectors_corporationId_stateId_sectorType",
  },
  {
    collection: "unownedSectors",
    keys: { stateId: 1, sectorType: 1, industryModel: 1 },
    options: { name: "unowned_state_type_model_unique", unique: true, background: true },
    legacyName: "stateId_1_sectorType_1",
  },
  {
    collection: "unions",
    keys: { countryId: 1, sectorType: 1, industryModel: 1 },
    options: {
      name: "unions_country_type_model_seeded_unique",
      unique: true,
      background: true,
      partialFilterExpression: { foundedByCharacterId: { $type: "null" } },
    },
    legacyName: "unions_country_sectorType_seeded_unique",
  },
] as const;

/**
 * Add model identity to market uniqueness before any 1991 seed conversion can
 * create both generic manufacturing and vehicle markets. Existing documents
 * remain untouched. New indexes are built first, then the equivalent old
 * uniqueness guards are removed so the schema transition never has an
 * unguarded interval.
 */
async function run(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const coll = db.collection(plan.collection);
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
    } else {
      await coll.createIndex(plan.keys, plan.options);
      notes.push(`created/verified ${label}`);
    }
  }
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.legacyName}`;
    if (dryRun) {
      notes.push(`would drop ${label} if present`);
      continue;
    }
    try {
      await db.collection(plan.collection).dropIndex(plan.legacyName);
      notes.push(`dropped ${label}`);
    } catch (error) {
      const code = error as { code?: unknown; codeName?: unknown };
      if (code.code === 27 || code.codeName === "IndexNotFound") {
        notes.push(`${label} not present`);
      } else {
        throw error;
      }
    }
  }
  return { documentsScanned: INDEXES.length, documentsUpdated: dryRun ? 0 : INDEXES.length, notes };
}

export const migration: Migration = {
  id: "2026-10-04-industry-model-market-indexes",
  description: "Include industry model in unique unowned market and seeded union keys.",
  idempotent: true,
  execute: async (db, ctx) => run(db, ctx.dryRun),
};
