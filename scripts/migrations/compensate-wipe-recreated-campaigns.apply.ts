/**
 * Compensation for the campaigns wiped on 2026-06-01 and recreated by the
 * backfill (marked `wipeRecreated: true`, the 42-campaign cluster): grant each
 * a $500k USD treasury and set Fundraising to level 1.
 *
 * DEPLOY ORDERING: run AFTER the branch deploys AND after
 * `localize-campaign-funds.apply.ts --apply` (so the treasury is already local;
 * 500000 is then a true local-currency $500k, not anchor). All 42 are US/USD —
 * the script asserts that before writing.
 *
 * Usage:
 *   npx tsx scripts/migrations/compensate-wipe-recreated-campaigns.apply.ts           # dry-run
 *   npx tsx scripts/migrations/compensate-wipe-recreated-campaigns.apply.ts --apply   # applies
 *   ... --db=local
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { Campaign, Election } from "../../src/lib/db/types";
import { getCampaignCurrency } from "../../src/lib/campaigns/campaignCurrency";

const COMPENSATION_LOCAL = 500_000; // $500k in the campaign's local currency
const FUNDRAISING_LEVEL = 1;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const c = path.join(dir, ".env.local");
    if (fs.existsSync(c)) return (dotenv.config({ path: c }), c);
    const p = path.dirname(dir);
    if (p === dir) break;
    dir = p;
  }
  return null;
}
loadEnv();
const APPLY = process.argv.includes("--apply");
const useLocal = process.argv.includes("--db=local");
const uri = useLocal ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error(`${useLocal ? "MONGODB_URI" : "MONGODB_URI_LIVE"} not set`);
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const targets = await db
    .collection<Campaign>("campaigns")
    .find({ wipeRecreated: true })
    .toArray();
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: targets.map((c) => c.electionId) } })
    .toArray();
  const ccyByElection = new Map(
    elections.map((e) => [e._id.toString(), getCampaignCurrency(e.countryId ?? "US")])
  );

  const nonUsd = targets.filter((c) => ccyByElection.get(c.electionId.toString()) !== "USD");
  console.log(`[compensate] target=${useLocal ? "LOCAL" : "LIVE"} APPLY=${APPLY}`);
  console.log(`  wipeRecreated campaigns: ${targets.length}`);
  console.log(`  non-USD among them: ${nonUsd.length}`);
  if (nonUsd.length > 0) {
    console.error(
      "  ABORT: some targets are not USD — $500k USD assumption invalid. Resolve manually."
    );
    await client.close();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(
      `  would set funds=${COMPENSATION_LOCAL} and fundraisingLevel=${FUNDRAISING_LEVEL} on ${targets.length} campaign(s).`
    );
    console.log("\nDRY-RUN — no writes. Run with --apply AFTER deploy + localize-campaign-funds.");
    await client.close();
    return;
  }

  const res = await db.collection<Campaign>("campaigns").updateMany(
    { wipeRecreated: true },
    {
      $set: {
        funds: COMPENSATION_LOCAL,
        fundraisingLevel: FUNDRAISING_LEVEL,
        compensationGrantedAt: new Date(),
        updatedAt: new Date(),
      },
    }
  );
  console.log(`  APPLIED — set funds + fundraisingLevel on ${res.modifiedCount} campaign(s).`);

  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
