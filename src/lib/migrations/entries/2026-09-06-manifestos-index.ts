import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // `manifestos` shipped with no index beyond _id. Every read is on this
    // exact triple — the point lookup behind save/lock (getManifesto) and the
    // `$in` batch behind the elections page (getManifestosForElections) — so
    // all of them were collection scans, one per contested Commons race.
    // Not unique: the upsert filter already keys on this triple, and adding a
    // uniqueness constraint to live data is a separate decision.
    collection: "manifestos",
    keys: { countryId: 1, electionId: 1, party: 1 },
    options: { name: "manifestos_country_election_party", background: true },
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
  id: "2026-09-06-manifestos-index",
  description:
    "Compound manifestos index (countryId, electionId, party) — the collection had only _id, so every manifesto read on the elections page was a collection scan.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
