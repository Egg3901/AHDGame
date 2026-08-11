/**
 * Remove the 7 `correction` rows that reverseCorp16MysteryTrades.ts wrote
 * during the refund migration. Per operator direction, Corp 16's Share
 * History should start empty (no backfill, moving forward only).
 *
 * Fingerprint:
 *   - corporationId matches Corp 16.
 *   - kind === "correction".
 *   - note starts with "Reverse mystery trade on Corp 16".
 *
 * Usage:
 *   npx tsx scripts/migrations/purgeCorp16CorrectionHistory.ts          # dry-run
 *   npx tsx scripts/migrations/purgeCorp16CorrectionHistory.ts --apply  # writes
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const apply = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE missing — set it in .env.local");
  process.exit(1);
}

const CORP_SEQUENTIAL_ID = 16;
const NOTE_PREFIX = "Reverse mystery trade on Corp 16";

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");
  console.log(`Connected. Mode = ${apply ? "APPLY (deletes)" : "DRY-RUN"}`);

  const corp = await db.collection("corporations").findOne({ sequentialId: CORP_SEQUENTIAL_ID });
  if (!corp) {
    console.error(`No corporation with sequentialId ${CORP_SEQUENTIAL_ID}`);
    process.exit(1);
  }

  const filter = {
    corporationId: corp._id,
    kind: "correction",
    note: { $regex: `^${NOTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` },
  };

  const matches = await db.collection("shareTradeHistory").find(filter).toArray();
  console.log(`\nMatched ${matches.length} row(s) to delete:`);
  for (const row of matches) {
    console.log(
      `  _id=${row._id.toString()} shares=${row.shares} from=${row.from?.name ?? "(float)"} → to=${row.to?.name ?? "(float)"}`
    );
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to delete.");
    await client.close();
    return;
  }

  const res = await db.collection("shareTradeHistory").deleteMany(filter);
  console.log(`\nDeleted ${res.deletedCount} row(s).`);

  const remaining = await db
    .collection("shareTradeHistory")
    .countDocuments({ corporationId: corp._id });
  console.log(`Corp 16 shareTradeHistory remaining row count: ${remaining}`);

  await client.close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
