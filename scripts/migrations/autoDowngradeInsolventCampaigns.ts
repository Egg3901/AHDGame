/**
 * Migration: Retroactively auto-downgrade campaigns that went insolvent under
 * the old turn processor (which deducted maintenance via $inc with no floor).
 *
 * Reads the same `computeAutoDowngrade` policy the fixed turn processor uses,
 * applies it to every campaign with `funds < 0`, and persists the demoted
 * Ground Game / Media Spending levels. Pushes a `downgrade` activity entry
 * flagged `reason: "migration"` for audit. Does NOT heal the negative balance —
 * the campaign still owes what it overspent; it just stops bleeding further
 * from the next turn onward.
 *
 * Run with:
 *   npx tsx scripts/migrations/autoDowngradeInsolventCampaigns.ts           # dry-run vs MONGODB_URI
 *   npx tsx scripts/migrations/autoDowngradeInsolventCampaigns.ts --live    # dry-run vs MONGODB_URI_LIVE
 *   npx tsx scripts/migrations/autoDowngradeInsolventCampaigns.ts --live --apply  # apply against live
 */

import { MongoClient, ObjectId, type AnyBulkWriteOperation } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { computeAutoDowngrade } from "../../src/lib/campaigns/autoDowngrade";
import { calculateCampaignIncome } from "../../src/lib/campaigns/income";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

interface CampaignRow {
  _id: ObjectId;
  candidateId: ObjectId;
  funds: number;
  fundraisingLevel: number;
  groundGameLevel: number;
  mediaSpendingLevel: number;
  party?: string;
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

    // Current turn for the activity entry timestamp.
    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    const turnNumber = gameState?.currentTurn ?? 0;

    const insolvent = await db
      .collection<CampaignRow>("campaigns")
      .find({ funds: { $lt: 0 } })
      .toArray();

    console.log(`Found ${insolvent.length} insolvent campaign(s) (funds < 0).\n`);
    if (insolvent.length === 0) {
      console.log("Nothing to migrate.");
      return;
    }

    const ops: AnyBulkWriteOperation<CampaignRow>[] = [];
    let totalDemotions = 0;
    const now = new Date();

    for (const campaign of insolvent) {
      const income = calculateCampaignIncome({
        fundraisingLevel: campaign.fundraisingLevel,
      } as never);
      const result = computeAutoDowngrade(campaign as never, {
        funds: campaign.funds,
        income,
      });

      console.log(
        `  ${campaign._id.toString()} (candidate ${campaign.candidateId.toString()}, party ${campaign.party ?? "?"})`
      );
      console.log(
        `    funds=${campaign.funds} income=${income} demotions=${result.downgrades.length} (${result.downgrades
          .map((d) => `${d.category}${d.branch ? `.${d.branch}` : ""}→L${d.toLevel}`)
          .join(", ")})`
      );

      if (result.downgrades.length === 0) continue;

      totalDemotions += result.downgrades.length;

      const activityEntries = result.downgrades.map((d) => ({
        type: "downgrade" as const,
        category: d.category,
        ...(d.branch ? { branch: d.branch } : {}),
        newLevel: d.toLevel,
        costFunds: 0,
        costActions: 0,
        reason: "migration" as const,
        timestamp: now,
        turnNumber,
      }));

      ops.push({
        updateOne: {
          filter: { _id: campaign._id },
          update: {
            $set: {
              ...result.setFields,
              updatedAt: now,
            },
            $push: {
              activityHistory: {
                $each: activityEntries,
                $slice: -20,
              },
            },
          },
        },
      });
    }

    console.log(`\nTotal demotions queued: ${totalDemotions} across ${ops.length} campaign(s).`);

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
