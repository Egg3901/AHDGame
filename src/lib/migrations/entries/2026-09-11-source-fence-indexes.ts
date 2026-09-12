import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import type { Migration, MigrationResult } from "../types";

const plans: Array<{
  collection: string;
  keys: IndexSpecification;
  options: CreateIndexesOptions & { name: string };
}> = [
  {
    collection: "sourceFenceReceipts",
    keys: { sourceAccountId: 1 },
    options: { name: "source_fence_receipt_account_unique", unique: true },
  },
  {
    collection: "sourceFenceReceipts",
    keys: { enrollmentOperationId: 1 },
    options: { name: "source_fence_receipt_operation_unique", unique: true },
  },
  {
    collection: "sourceFenceReceipts",
    keys: { proofId: 1 },
    options: { name: "source_fence_receipt_proof_unique", unique: true },
  },
];

async function apply(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  for (const plan of plans) {
    const exists = (
      await db
        .collection(plan.collection)
        .indexes()
        .catch(() => [])
    ).some((index) => index.name === plan.options.name);
    if (exists) {
      notes.push(`${plan.options.name} already present`);
    } else if (dryRun) {
      notes.push(`would create ${plan.options.name}`);
    } else {
      await db.collection(plan.collection).createIndex(plan.keys, plan.options);
      notes.push(`created ${plan.options.name}`);
    }
  }
  return {
    documentsScanned: plans.length,
    documentsUpdated: dryRun ? 0 : notes.filter((note) => note.startsWith("created ")).length,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-11-source-fence-indexes",
  description:
    "Unique account, enrollment operation, and proof ownership for immutable source-fence receipts.",
  idempotent: true,
  execute: (db, ctx) => apply(db, ctx.dryRun),
};
