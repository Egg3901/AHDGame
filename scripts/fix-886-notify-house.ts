/**
 * Ticket #886 — notify US House members that voting on the reopened bill is now
 * open. Mirrors notifyChambersVoteOpen() but scoped to the bill's country (the
 * app helper is unscoped; a US bill shouldn't ping other countries' houses).
 *
 * Dry-run by default. Pass --commit to write. Idempotent-ish: guarded on the
 * bill being active in the House.
 *
 * Run: npx tsx scripts/fix-886-notify-house.ts [--commit]
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BILL_ID = "6a43ef6dd32eb0ac7beebf50";
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

  const bill: any = await db.collection("bills").findOne({ _id: new ObjectId(BILL_ID) });
  if (!bill) throw new Error("bill not found");
  if (bill.status !== "active_other" || bill.currentChamber !== "house") {
    throw new Error(
      `Bill is status="${bill.status}" chamber="${bill.currentChamber}" — expected active_other/house. Aborting.`
    );
  }
  const countryId = bill.countryId ?? "US";

  // Human (non-NPP) house members in the bill's country.
  const officials = await db
    .collection("electedOfficials")
    .find({ officeType: "house", countryId, characterId: { $ne: null }, isNPP: { $ne: true } })
    .project({ characterId: 1 })
    .toArray();
  const charIds = officials
    .map((o: any) => o.characterId)
    .filter((id: any) => id instanceof ObjectId);

  const chars = await db
    .collection("characters")
    .find({ _id: { $in: charIds } }, { projection: { _id: 1, userId: 1 } })
    .toArray();
  const recipients = chars.filter((c: any) => c.userId);

  console.log(
    `Bill: "${bill.title}" (${countryId} House, ends turn ${bill.otherChamberVotingEndsOnTurn})`
  );
  console.log(
    `House officials: ${officials.length} | with characters+userId: ${recipients.length}`
  );

  const now = new Date();
  const docs = recipients.map((c: any) => ({
    userId: c.userId,
    type: "bill_vote_open",
    title: "Vote Now Open",
    message: `Voting on "${bill.title}" is now open in the House.`,
    read: false,
    metadata: { billId: bill._id.toString(), recipientCharacterId: c._id.toString() },
    createdAt: now,
  }));

  if (!COMMIT) {
    console.log(`\n[DRY RUN] Would insert ${docs.length} notifications. Sample:`);
    console.log(docs[0]);
    console.log("Re-run with --commit to send.");
    await client.close();
    return;
  }

  if (docs.length === 0) {
    console.log("No recipients — nothing to send.");
    await client.close();
    return;
  }
  const res = await db.collection("notifications").insertMany(docs);
  console.log(`\nInserted ${res.insertedCount} notifications.`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
