import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // The repair queue: every banking money movement that started and did not
    // finish. It is the operator's only view of a hole in the books, and it
    // reads oldest-first, so without this it is a growing collection scan and
    // the tool gets slower every turn the world runs.
    collection: "bankMoneyMoves",
    keys: { status: 1, kind: 1, createdAt: 1 },
    options: { name: "bankMoneyMoves_status_kind_createdAt", background: true },
  },
  {
    // "What did this turn move" is the first question after a turn that
    // reports a conservation warning.
    collection: "bankMoneyMoves",
    keys: { turn: -1 },
    options: { name: "bankMoneyMoves_turn_desc", background: true },
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
  id: "2026-08-18-bank-money-move-indexes",
  description:
    "Indexes for the banking money-movement claim records and their repair queue. The seed module covers a fresh bootstrap; this covers a world that is already running.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
