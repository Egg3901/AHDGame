import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // Nationalization eligibility (targetEligibility.ts) checks for defaulted,
    // unmatured bonds per corporation on every candidate pass; the bond payoff
    // / restructure / hostile-takeover paths filter the same way. The existing
    // bonds indexes lead with holders.characterId / issuerType, so these
    // lookups collection-scan (#2817).
    collection: "bonds",
    keys: { corporationId: 1, matured: 1, defaulted: 1 },
    options: { name: "bonds_corporation_matured_defaulted", background: true },
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
  id: "2026-07-08-perf-n1-indexes",
  description:
    "Compound bonds index (corporationId, matured, defaulted) for nationalization eligibility and bond payoff paths (#2817).",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
