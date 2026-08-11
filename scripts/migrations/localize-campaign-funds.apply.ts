/**
 * Migrate the campaign treasury from anchor (₳) to local currency.
 *
 * For every campaign, multiply `funds`, `totalFundsGenerated`, `totalFundsSpent`,
 * and each `donationLog[].amount` by the campaign's country FX rate
 * (local = anchor × rate), then stamp `treasuryCurrency` + `treasuryLocalizedAt`
 * so re-runs are no-ops (idempotent).
 *
 * DEPLOY ORDERING: run this ONLY after the branch that reads the treasury as
 * local is deployed. Running it against the anchor code would desync balances.
 *
 * Run from the worktree (this branch has campaignCurrency). `.env.local` is
 * resolved by walking up parent directories.
 *
 * Usage:
 *   npx tsx scripts/migrations/localize-campaign-funds.apply.ts            # dry-run
 *   npx tsx scripts/migrations/localize-campaign-funds.apply.ts --apply    # performs the migration
 *   ... --db=local
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { Campaign, Election } from "../../src/lib/db/types";
import { loadCampaignFxRate } from "../../src/lib/campaigns/campaignCurrency";

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
const envPath = loadEnv();
const APPLY = process.argv.includes("--apply");
const useLocal = process.argv.includes("--db=local");
const uri = useLocal ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error(`${useLocal ? "MONGODB_URI" : "MONGODB_URI_LIVE"} not set (env: ${envPath})`);
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const campaigns = await db.collection<Campaign>("campaigns").find({}).toArray();
  const elections = await db
    .collection<Election>("elections")
    .find({ _id: { $in: campaigns.map((c) => c.electionId) } })
    .toArray();
  const countryByElection = new Map(elections.map((e) => [e._id.toString(), e.countryId ?? "US"]));
  const rateCache = new Map<string, number>();

  let migrated = 0;
  let skipped = 0;
  const sample: string[] = [];
  for (const c of campaigns) {
    if ((c as { treasuryLocalizedAt?: Date }).treasuryLocalizedAt) {
      skipped++;
      continue;
    }
    const countryId = countryByElection.get(c.electionId.toString()) ?? "US";
    let rate = rateCache.get(countryId);
    let currencyCode = "USD";
    if (rate === undefined) {
      const r = await loadCampaignFxRate(db, countryId);
      rate = r.rate;
      currencyCode = r.currencyCode;
      rateCache.set(countryId, rate);
    } else {
      const r = await loadCampaignFxRate(db, countryId);
      currencyCode = r.currencyCode;
    }

    const fundsNew = Math.round((c.funds ?? 0) * rate);
    const genNew = Math.round((c.totalFundsGenerated ?? 0) * rate);
    const spentNew = Math.round((c.totalFundsSpent ?? 0) * rate);
    const donationLog = Array.isArray(c.donationLog)
      ? c.donationLog.map((d) => ({ ...d, amount: Math.round((d.amount ?? 0) * rate!) }))
      : c.donationLog;
    const activityHistory = Array.isArray(c.activityHistory)
      ? c.activityHistory.map((a) => ({ ...a, costFunds: Math.round((a.costFunds ?? 0) * rate!) }))
      : c.activityHistory;

    if (sample.length < 6 && (c.funds ?? 0) > 0) {
      sample.push(
        `${c._id} ${countryId} ${c.funds}→${fundsNew} ${currencyCode} (rate ${rate.toFixed(4)})`
      );
    }

    if (APPLY) {
      await db.collection<Campaign>("campaigns").updateOne(
        { _id: c._id },
        {
          $set: {
            funds: fundsNew,
            totalFundsGenerated: genNew,
            totalFundsSpent: spentNew,
            donationLog,
            activityHistory,
            treasuryCurrency: currencyCode,
            treasuryLocalizedAt: new Date(),
          },
        }
      );
    }
    migrated++;
  }

  console.log(`[localize-campaign-funds] target=${useLocal ? "LOCAL" : "LIVE"} APPLY=${APPLY}`);
  console.log(`  campaigns to migrate: ${migrated}  already-migrated(skipped): ${skipped}`);
  console.log(`  sample conversions:`);
  for (const s of sample) console.log(`    ${s}`);
  if (!APPLY) console.log("\nDRY-RUN — no writes. Re-run with --apply AFTER the branch deploys.");

  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
