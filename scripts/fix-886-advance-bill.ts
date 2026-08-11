/**
 * Ticket #886 remediation — advance the mis-killed bill to the House.
 *
 * "Ivanka Trump Education Reform Act" (6a43ef6dd32eb0ac7beebf50) failed its
 * Senate cloture only because the buggy denominator counted senators from every
 * country (bar 84 vs the correct US bar 60; it had 77 For). Under the fixed
 * logic cloture succeeds, so the bill advances to the House with a fresh 24h
 * voting window — exactly what processBillLifecycle's passed-origin branch does.
 *
 * Dry-run by default. Pass --commit to write. Guarded on status="failed" so it
 * is a no-op if already advanced.
 *
 * Run: npx tsx scripts/fix-886-advance-bill.ts [--commit]
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BILL_ID = "6a43ef6dd32eb0ac7beebf50";
const VOTING_DURATION_HOURS = 24;
const COMMIT = process.argv.includes("--commit");

function directUri(uri: string): string {
  return uri.includes("directConnection=") ? uri : `${uri}&directConnection=true`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(directUri(uri));
  await client.connect();
  const db = client.db();
  const bills = db.collection("bills");

  const _id = new ObjectId(BILL_ID);
  const bill: any = await bills.findOne({ _id });
  if (!bill) throw new Error("bill not found");

  console.log("BEFORE:", {
    _id: String(bill._id),
    title: bill.title,
    status: bill.status,
    currentChamber: bill.currentChamber,
    originChamber: bill.originChamber,
    votesFor: bill.votesFor,
    votesAgainst: bill.votesAgainst,
    votesAbstain: bill.votesAbstain,
    failedAt: bill.failedAt,
  });

  if (bill.status !== "failed") {
    console.log(`\nStatus is "${bill.status}", not "failed" — nothing to do (idempotent).`);
    await client.close();
    return;
  }
  if (bill.originChamber !== "senate") {
    throw new Error(`Unexpected originChamber "${bill.originChamber}" — aborting.`);
  }

  const gameState: any = await db
    .collection<{ _id: string }>("gameState")
    .findOne({ _id: "current" });
  const currentTurn: number = gameState?.currentTurn ?? 0;
  console.log("\ncurrentTurn:", currentTurn);

  const now = new Date();
  const otherEndsAt = new Date(now.getTime() + VOTING_DURATION_HOURS * 60 * 60 * 1000);
  const otherEndsOnTurn = currentTurn + VOTING_DURATION_HOURS;

  const update = {
    $set: {
      status: "active_other",
      currentChamber: "house",
      // origin (Senate) totals are preserved as-is (77/17/1).
      passedOriginAt: now,
      sentToOtherChamberAt: now,
      otherChamberVotingStartedAt: now,
      otherChamberVotingEndsAt: otherEndsAt,
      otherChamberVotingEndsOnTurn: otherEndsOnTurn,
      otherChamberVotesFor: 0,
      otherChamberVotesAgainst: 0,
      otherChamberVotesAbstain: 0,
      otherChamberVotes: {},
      updatedAt: now,
    },
    $unset: { failedAt: "" as const },
  };

  console.log("\nPLANNED UPDATE:", JSON.stringify(update, null, 2));

  if (!COMMIT) {
    console.log("\n[DRY RUN] No write performed. Re-run with --commit to apply.");
    await client.close();
    return;
  }

  const res = await bills.updateOne({ _id, status: "failed" }, update);
  console.log("\nUPDATE RESULT:", { matched: res.matchedCount, modified: res.modifiedCount });

  const after: any = await bills.findOne({ _id });
  console.log("AFTER:", {
    status: after.status,
    currentChamber: after.currentChamber,
    otherChamberVotingEndsAt: after.otherChamberVotingEndsAt,
    otherChamberVotingEndsOnTurn: after.otherChamberVotingEndsOnTurn,
    failedAt: after.failedAt,
  });
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
