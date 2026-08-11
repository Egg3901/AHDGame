/**
 * Migration: Drop non-US-presidential Campaign docs
 *
 * Bug: `POST /api/elections/[id]/enter` used to call createInitialCampaign
 * for every race — JP shugiin, UK commons, US senate/house/governor, etc.
 * Only US presidential races are covered by the Campaign Manager system, so
 * those stray Campaign docs:
 *  - Drained player character.funds through donations UI
 *  - Drove "My Campaign" navbar links to pages with meaningless balances
 *  - Accrued negative funds from ground-game / media maintenance without a
 *    real fundraising loop
 *
 * This script deletes every Campaign whose referenced election is not eligible
 * per `isCampaignEligibleElection` (electionType === "president" AND the
 * election's country forms its executive by direct election).
 *
 * Run with:
 *   npx tsx scripts/migrations/dropNonPresidentialCampaigns.ts          # dry-run
 *   npx tsx scripts/migrations/dropNonPresidentialCampaigns.ts --apply  # execute
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { isCampaignEligibleElection } from "../../src/lib/campaigns/isCampaignEligible";
import type { CountryId } from "../../src/lib/constants/countries";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

interface CampaignRow {
  _id: ObjectId;
  electionId: ObjectId;
  candidateId: ObjectId;
  funds: number;
}

interface ElectionRow {
  _id: ObjectId;
  countryId?: CountryId;
  electionType?: string;
  state?: string;
  status?: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uriKey = process.argv.includes("--live") ? "MONGODB_URI_LIVE" : "MONGODB_URI";
  const mongoUri = process.env[uriKey];
  if (!mongoUri) {
    console.error(`${uriKey} not found in environment`);
    process.exit(1);
  }

  console.log(
    `Mode: ${apply ? "APPLY (will delete)" : "DRY-RUN (no changes)"} — target: ${uriKey}\n`
  );

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db("a-house-divided");

  const campaigns = await db
    .collection<CampaignRow>("campaigns")
    .find({}, { projection: { _id: 1, electionId: 1, candidateId: 1, funds: 1 } })
    .toArray();

  if (campaigns.length === 0) {
    console.log("No campaigns found. Nothing to do.");
    await client.close();
    return;
  }

  const electionIds = [...new Set(campaigns.map((c) => c.electionId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const elections = await db
    .collection<ElectionRow>("elections")
    .find(
      { _id: { $in: electionIds } },
      { projection: { _id: 1, countryId: 1, electionType: 1, state: 1, status: 1 } }
    )
    .toArray();
  const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));

  const toDelete: ObjectId[] = [];
  const orphan: ObjectId[] = [];
  const byBucket = new Map<string, number>();

  for (const camp of campaigns) {
    const election = electionMap.get(camp.electionId.toString());
    if (!election) {
      orphan.push(camp._id);
      continue;
    }
    if (isCampaignEligibleElection(election)) continue;
    const key = `${election.countryId ?? "??"}/${election.electionType ?? "??"}`;
    byBucket.set(key, (byBucket.get(key) ?? 0) + 1);
    toDelete.push(camp._id);
  }

  console.log(`Scanned ${campaigns.length} campaigns.`);
  console.log(
    `  Eligible (US presidential, kept): ${campaigns.length - toDelete.length - orphan.length}`
  );
  console.log(`  Ineligible (to delete):           ${toDelete.length}`);
  console.log(`  Orphaned (election missing):      ${orphan.length}`);
  if (byBucket.size > 0) {
    console.log("\n  Breakdown of ineligible by election type:");
    for (const [bucket, count] of [...byBucket.entries()].sort()) {
      console.log(`    ${bucket}: ${count}`);
    }
  }

  const deletionTargets = [...toDelete, ...orphan];
  if (deletionTargets.length === 0) {
    console.log("\nNo campaigns to delete. Done.");
    await client.close();
    return;
  }

  if (!apply) {
    console.log("\nDry-run complete. Re-run with --apply to delete.");
    await client.close();
    return;
  }

  const res = await db.collection("campaigns").deleteMany({ _id: { $in: deletionTargets } });
  console.log(`\nDeleted ${res.deletedCount} campaign doc(s).`);

  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
