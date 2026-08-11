/**
 * Backfill `enactedBy: { kind: "bill", id }` on existing `statePolicies` docs
 * that still only have the legacy `enactedByBillId` field. Once every doc has
 * `enactedBy`, the legacy field can be dropped in a follow-up.
 *
 * Run locally: `npx tsx scripts/migrations/renameStatePolicyEnactedBy.ts`
 * Per feedback_migrations_local_only.md, this commit stays local until reviewed.
 */
import { getDb } from "../../src/lib/mongodb";

async function main() {
  const db = await getDb();
  const cursor = db
    .collection("statePolicies")
    .find({ enactedByBillId: { $exists: true }, enactedBy: { $exists: false } });
  let migrated = 0;
  for await (const doc of cursor) {
    await db
      .collection("statePolicies")
      .updateOne(
        { _id: doc._id },
        { $set: { enactedBy: { kind: "bill", id: doc.enactedByBillId } } }
      );
    migrated++;
  }
  console.log(`Migrated ${migrated} statePolicies docs to enactedBy.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
