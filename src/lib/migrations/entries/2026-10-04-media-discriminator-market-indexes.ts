import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";

const INDEXES = [
  {
    collection: "corporateSectors",
    keys: {
      corporationId: 1,
      stateId: 1,
      sectorType: 1,
      industryModel: 1,
      mediaDiscriminator: 1,
    },
    options: {
      name: "corporateSectors_corporation_state_type_models_unique",
      unique: true,
      background: true,
    },
    legacyName: "corporateSectors_corporationId_stateId_sectorType_industryModel",
  },
  {
    collection: "unownedSectors",
    keys: { stateId: 1, sectorType: 1, industryModel: 1, mediaDiscriminator: 1 },
    options: { name: "unowned_state_type_models_unique", unique: true, background: true },
    legacyName: "unowned_state_type_model_unique",
  },
  {
    collection: "unions",
    keys: { countryId: 1, sectorType: 1, industryModel: 1, mediaDiscriminator: 1 },
    options: {
      name: "unions_country_type_models_seeded_unique",
      unique: true,
      background: true,
      partialFilterExpression: { foundedByCharacterId: { $type: "null" } },
    },
    legacyName: "unions_country_type_model_seeded_unique",
  },
] as const;

/**
 * Add media lane identity before any canonical 1991 media seed writes. This
 * migration changes index metadata only; existing world documents are never
 * re-keyed or healed by deployment startup.
 */
async function run(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of INDEXES) {
    const label = `${plan.collection}.${plan.options.name}`;
    if (dryRun) {
      notes.push(`would create ${label}`);
    } else {
      await db.collection(plan.collection).createIndex(plan.keys, plan.options);
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
  return {
    documentsScanned: 0,
    documentsUpdated: 0,
    notes: [`index plans processed: ${INDEXES.length}`, ...notes],
  };
}

export const migration: Migration = {
  id: "2026-10-04-media-discriminator-market-indexes",
  description: "Include media lane identity in sector, unowned market, and seeded union keys.",
  idempotent: true,
  execute: async (db, ctx) => run(db, ctx.dryRun),
};
