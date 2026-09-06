import type { Db } from "mongodb";
import type { Migration, MigrationResult } from "../types";

const COLLECTION = "clientSimulationStatistics";
const INDEX_NAME = "clientSimulationStatistics_expiresAt_ttl";

/** Ensure anonymous client aggregates expire at their stored expiresAt instant. */
async function ensureClientStatisticsTtlIndex(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const collection = db.collection(COLLECTION);
  const indexes = await collection.indexes().catch(() => []);
  const existing = indexes.find((index) => index.name === INDEX_NAME);
  if (existing) {
    return { notes: [`${INDEX_NAME} already present`] };
  }
  if (dryRun) {
    return { notes: [`dry run: would create ${INDEX_NAME}`] };
  }
  await collection.createIndex({ expiresAt: 1 }, { name: INDEX_NAME, expireAfterSeconds: 0 });
  return { notes: [`created ${INDEX_NAME}`] };
}

export const migration: Migration = {
  id: "2026-09-06-client-statistics-ttl-index",
  description: "Create the TTL index for anonymous client simulation statistics",
  idempotent: true,
  execute: (db, ctx) => ensureClientStatisticsTtlIndex(db, ctx.dryRun),
};
