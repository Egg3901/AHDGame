/**
 * One-off heal: reactivate index funds stuck with status "paused" and
 * pauseReason "constituent_delisted". Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/heal-paused-index-funds.ts
 *
 * Uses MONGODB_URI from .env.local. Does NOT run automatically — user must
 * explicitly invoke against the target environment.
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");
  const col = db.collection("indexFunds");
  const stuck = await col
    .find({ status: "paused", pauseReason: "constituent_delisted" })
    .project({ name: 1 })
    .toArray();
  console.log(
    `Found ${stuck.length} stuck fund(s):`,
    stuck.map((f) => f.name)
  );
  const res = await col.updateMany(
    { status: "paused", pauseReason: "constituent_delisted" },
    {
      $set: { status: "active", updatedAt: new Date() },
      $unset: { pauseReason: "", pausedAt: "", pausedByUserId: "" },
    }
  );
  console.log(`Reactivated ${res.modifiedCount} fund(s).`);
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
