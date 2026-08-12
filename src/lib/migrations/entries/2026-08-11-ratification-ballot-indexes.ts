import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // The turn sweep selects every vote due to close, so it has to be an
    // index scan rather than a collection scan of all campaigns.
    collection: "bargainingCampaigns",
    keys: { "ratification.status": 1, "ratification.closesAtTurn": 1 },
    options: { name: "bargaining_campaigns_ratification_due", background: true },
  },
  {
    // One ballot per organizer per offer. The command upserts on this exact
    // key, so uniqueness here is what stops a double-submit counting twice.
    collection: "bargainingRatificationBallots",
    keys: { campaignId: 1, offerRevision: 1, voterCharacterId: 1 },
    options: { name: "unique_ratification_ballot_per_organizer", unique: true, background: true },
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
  id: "2026-08-11-ratification-ballot-indexes",
  description: "Indexes for settlement ratification votes and their member ballots.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
