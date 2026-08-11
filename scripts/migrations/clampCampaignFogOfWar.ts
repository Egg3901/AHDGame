/**
 * Migration: Clamp campaign fog-of-war levels to each category's actual max.
 *
 * Bug: `applyFog` added ±variance without clamping, so opponent-view fog could
 * land at levels above the true cap (e.g. 8 for categories capped at 5) or go
 * negative. The owner's view (real data) stayed within the cap, so the two
 * candidates appeared to have mismatched caps in the Campaign Manager tab.
 *
 * The code fix in src/lib/campaigns/fogOfWar.ts clamps going forward, but the
 * existing `publicFogOfWar` / `partyFogOfWar` embedded docs hold stale values
 * until the next hourly turn overwrites them. This script fixes them immediately
 * so opponent views render correctly before the next fog update.
 *
 * Run with:
 *   npx tsx scripts/migrations/clampCampaignFogOfWar.ts           # dry-run vs MONGODB_URI
 *   npx tsx scripts/migrations/clampCampaignFogOfWar.ts --live    # dry-run vs MONGODB_URI_LIVE
 *   npx tsx scripts/migrations/clampCampaignFogOfWar.ts --live --apply  # apply against live
 */

import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { getMaxLevel, type UpgradeCategory } from "../../src/lib/campaigns/upgradeCosts";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

interface FogSub {
  fundraisingLevel?: number;
  oppositionResearchLevel?: number;
  groundGameLevel?: number;
  mediaSpendingLevel?: number;
  lastUpdated?: Date;
}

interface CampaignRow {
  _id: ObjectId;
  publicFogOfWar?: FogSub;
  partyFogOfWar?: FogSub;
}

const FIELD_BY_CATEGORY: Record<UpgradeCategory, keyof FogSub> = {
  fundraising: "fundraisingLevel",
  oppositionResearch: "oppositionResearchLevel",
  groundGame: "groundGameLevel",
  mediaSpending: "mediaSpendingLevel",
};

function clampFog(fog: FogSub | undefined): { clamped: FogSub; changed: boolean } {
  const out: FogSub = { ...(fog ?? {}) };
  let changed = false;
  for (const category of Object.keys(FIELD_BY_CATEGORY) as UpgradeCategory[]) {
    const field = FIELD_BY_CATEGORY[category];
    const max = getMaxLevel(category);
    const raw = fog?.[field];
    if (typeof raw !== "number") continue;
    const clamped = Math.max(0, Math.min(max, raw));
    if (clamped !== raw) {
      (out as Record<string, unknown>)[field] = clamped;
      changed = true;
    }
  }
  return { clamped: out, changed };
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
    `Mode: ${apply ? "APPLY (will update)" : "DRY-RUN (no changes)"} — target: ${uriKey}\n`
  );

  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const campaigns = await db.collection<CampaignRow>("campaigns").find({}).toArray();

    let publicChangedCount = 0;
    let partyChangedCount = 0;
    const examples: string[] = [];

    const ops = [];
    for (const campaign of campaigns) {
      const publicRes = clampFog(campaign.publicFogOfWar);
      const partyRes = clampFog(campaign.partyFogOfWar);
      if (!publicRes.changed && !partyRes.changed) continue;

      if (publicRes.changed) publicChangedCount++;
      if (partyRes.changed) partyChangedCount++;

      if (examples.length < 5) {
        const summary: string[] = [];
        if (publicRes.changed) {
          summary.push(
            `public: ${JSON.stringify(campaign.publicFogOfWar)} -> ${JSON.stringify(publicRes.clamped)}`
          );
        }
        if (partyRes.changed) {
          summary.push(
            `party: ${JSON.stringify(campaign.partyFogOfWar)} -> ${JSON.stringify(partyRes.clamped)}`
          );
        }
        examples.push(`  ${campaign._id.toString()} — ${summary.join(" | ")}`);
      }

      const set: Record<string, FogSub> = {};
      if (publicRes.changed) set.publicFogOfWar = publicRes.clamped;
      if (partyRes.changed) set.partyFogOfWar = partyRes.clamped;

      ops.push({
        updateOne: {
          filter: { _id: campaign._id },
          update: { $set: set },
        },
      });
    }

    console.log(`Scanned ${campaigns.length} campaign(s).`);
    console.log(`  publicFogOfWar docs to clamp: ${publicChangedCount}`);
    console.log(`  partyFogOfWar docs to clamp:  ${partyChangedCount}`);
    if (examples.length > 0) {
      console.log("\nSample changes:");
      for (const line of examples) console.log(line);
    }

    if (!apply) {
      console.log("\nDry-run complete. Re-run with --apply to persist these changes.");
      return;
    }

    if (ops.length === 0) {
      console.log("\nNothing to update.");
      return;
    }

    const result = await db.collection<CampaignRow>("campaigns").bulkWrite(ops);
    console.log(`\nApplied ${result.modifiedCount} update(s).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
