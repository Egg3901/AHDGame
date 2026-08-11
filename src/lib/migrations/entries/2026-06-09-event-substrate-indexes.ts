import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "eventInstances",
    keys: { scope: 1, scopeId: 1, status: 1 },
    options: { name: "eventInstances_scope_scopeId_status", background: true },
  },
  {
    collection: "eventInstances",
    keys: { status: 1, expiresAtRealtimeMs: 1 },
    options: { name: "eventInstances_status_expiresAtRealtimeMs", background: true },
  },
  {
    collection: "eventDefinitions",
    keys: { status: 1, kind: 1 },
    options: { name: "eventDefinitions_status_kind", background: true },
  },
  {
    collection: "eventCooldownLedger",
    keys: { scope: 1, scopeId: 1 },
    options: { name: "eventCooldownLedger_scope_scopeId", background: true },
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
  id: "2026-06-09-event-substrate-indexes",
  description: "Indexes for eventInstances, eventDefinitions, and eventCooldownLedger.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
