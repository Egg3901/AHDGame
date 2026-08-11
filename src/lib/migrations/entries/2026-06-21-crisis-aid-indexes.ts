import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

type IndexPlan = {
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
};

const INDEXES: IndexPlan[] = [
  {
    // Prevents duplicate pledges and hardens a double-pledge race condition:
    // only one commitment per (crisis, sending country) can exist.
    collection: "crisisAidCommitments",
    keys: { crisisId: 1, senderCountryId: 1 },
    options: {
      name: "crisisAidCommitments_crisis_sender_unique",
      unique: true,
      background: true,
    },
  },
  {
    // One commitment per bill — enforces the 1:1 bill→commitment relationship.
    collection: "crisisAidCommitments",
    keys: { billId: 1 },
    options: {
      name: "crisisAidCommitments_billId_unique",
      unique: true,
      background: true,
    },
  },
  {
    // Status + penalty-expiry sweep index: used by processCrisisAidResolutions
    // and reverseCrisisAidPenalties to find pending/expired commitments cheaply.
    collection: "crisisAidCommitments",
    keys: { status: 1, approvalPenaltyExpiresTurn: 1 },
    options: {
      name: "crisisAidCommitments_status_penaltyExpiry",
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
  id: "2026-06-21-crisis-aid-indexes",
  description:
    "Unique pledge guard (crisis+sender) and bill-id uniqueness + sweep index for crisisAidCommitments.",
  idempotent: true,
  execute: async (db, ctx) => createPlannedIndexes(db, ctx.dryRun),
};
