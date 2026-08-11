/**
 * One-off backfill: seed the 1953 iron-curtain trade lanes into an ALREADY
 * RUNNING era world (seedTradeLanes otherwise only runs at world seed time).
 * Idempotent — reruns insert nothing. Rollback:
 *
 *   db.tradeEmbargoes.deleteMany({ origin: "organization",
 *     createdBy: ObjectId("000000000000000000000000") })
 *
 *   npx tsx scripts/backfill-trade-lanes-1953.ts            # dry-run report
 *   npx tsx scripts/backfill-trade-lanes-1953.ts --apply    # write
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { MongoClient } from "mongodb";
import { seedTradeLanes } from "@/lib/admin/seed/seedTradeLanes";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await MongoClient.connect(process.env.MONGODB_URI!, { directConnection: true });
  const db = client.db();
  const preset = await loadWorldPreset(db as never);
  const existing = await db.collection("tradeEmbargoes").countDocuments({});
  console.log(`world preset: ${preset}; existing tradeEmbargoes: ${existing}`);
  if (!apply) {
    console.log("dry-run only — pass --apply to write");
  } else {
    const res = await seedTradeLanes(db as never, console.log, preset);
    console.log(`inserted ${res.inserted} lanes`);
  }
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
