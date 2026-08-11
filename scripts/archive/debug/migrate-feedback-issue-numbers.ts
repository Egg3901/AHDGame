/**
 * One-time migration: add issueNumber to existing feedback documents that don't have it.
 * Run: npx tsx scripts/migrate-feedback-issue-numbers.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/a-house-divided";

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const feedback = db.collection("feedback");
  const counters = db.collection("counters");

  const withoutNumber = await feedback
    .find({ issueNumber: { $exists: false } })
    .sort({ createdAt: 1 })
    .toArray();
  if (withoutNumber.length === 0) {
    console.log("No feedback documents need migration.");
    await client.close();
    return;
  }

  const maxExisting = await feedback.findOne(
    { issueNumber: { $exists: true } },
    { sort: { issueNumber: -1 } }
  );
  let seq = maxExisting?.issueNumber ?? 0;

  for (const doc of withoutNumber) {
    seq++;
    await feedback.updateOne({ _id: doc._id }, { $set: { issueNumber: seq } });
    console.log(`  #${seq} ${doc.title?.slice(0, 50)}...`);
  }

  await counters.updateOne(
    { _id: "feedback" as unknown as object },
    { $set: { seq } },
    { upsert: true }
  );

  console.log(`Migrated ${withoutNumber.length} documents. Counter set to ${seq}.`);
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
