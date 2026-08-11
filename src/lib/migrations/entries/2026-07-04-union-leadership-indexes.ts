import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    collection: "unionLeaderVotes",
    keys: { unionId: 1, voterCharacterId: 1 },
    options: {
      name: "unique_union_leader_vote_per_organizer",
      unique: true,
      background: true,
    },
  },
  {
    collection: "unionOrganizers",
    keys: { unionId: 1, characterId: 1 },
    options: {
      name: "unique_union_organizer_per_character",
      unique: true,
      background: true,
    },
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
  id: "2026-07-04-union-leadership-indexes",
  description: "Unique indexes for union organizer and leadership-vote collections.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
