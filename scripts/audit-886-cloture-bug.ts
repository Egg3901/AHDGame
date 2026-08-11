/**
 * READ-ONLY audit for ticket #886.
 *
 * The 3/5 Senate cloture (and 2/3 veto-override) thresholds counted senate/house
 * official DOCUMENTS across ALL countries instead of seat-summing within the
 * bill's country. This inflated the bar and could fail bills that actually had
 * passing margins. This script:
 *   1. Dumps the reported bill (6a43ef6dd32eb0ac7beebf50).
 *   2. Finds every status="failed" senate bill with a filibuster that PASSES
 *      cloture under the corrected (country-scoped, seat-summed) denominator but
 *      FAILED under the buggy (all-country document-count) denominator.
 *
 * NO WRITES. Run: npx tsx scripts/audit-886-cloture-bug.ts
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const TARGET_BILL_ID = "6a43ef6dd32eb0ac7beebf50";

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
  const officials = db.collection("electedOfficials");

  // Buggy denominator: senate official DOCUMENTS across all countries.
  const buggySenateDocs = await officials.countDocuments({ officeType: "senate" });

  // Correct denominator: sum seatsHeld per country for the senate.
  const seatAgg = await officials
    .aggregate([
      { $match: { officeType: "senate" } },
      { $group: { _id: "$countryId", seats: { $sum: { $ifNull: ["$seatsHeld", 1] } } } },
    ])
    .toArray();
  const seatsByCountry: Record<string, number> = {};
  for (const r of seatAgg) seatsByCountry[String(r._id)] = r.seats;

  console.log("=== Senate denominators ===");
  console.log("BUGGY (all-country senate documents):", buggySenateDocs);
  console.log("CORRECT (seats summed per country):", seatsByCountry);
  const clot = (seats: number) => Math.ceil((3 / 5) * seats);
  console.log("Buggy cloture bar (3/5 of doc count):", clot(buggySenateDocs));

  // 1) The reported bill
  console.log("\n=== Reported bill", TARGET_BILL_ID, "===");
  let target: any = null;
  if (ObjectId.isValid(TARGET_BILL_ID)) {
    target = await bills.findOne({ _id: new ObjectId(TARGET_BILL_ID) });
  }
  if (!target) target = await bills.findOne({ _id: TARGET_BILL_ID as any });
  if (!target) {
    console.log("NOT FOUND by _id. Trying sequentialId / other id fields…");
    target = await bills.findOne({ sequentialId: TARGET_BILL_ID as any });
  }
  if (target) {
    const cid = target.countryId ?? "US";
    const correctSeats = seatsByCountry[cid] ?? 0;
    console.log({
      _id: String(target._id),
      title: target.title,
      status: target.status,
      countryId: cid,
      originChamber: target.originChamber,
      currentChamber: target.currentChamber,
      votesFor: target.votesFor,
      votesAgainst: target.votesAgainst,
      votesAbstain: target.votesAbstain,
      filibusterInvocations: (target.filibusterInvocations ?? []).length,
      failedAt: target.failedAt,
      provisionsCount: (target.provisions ?? []).length,
    });
    console.log("  correct cloture bar (3/5 of", correctSeats, "seats) =", clot(correctSeats));
    console.log(
      "  votesFor >= correct bar?",
      (target.votesFor ?? 0) >= clot(correctSeats),
      "| votesFor >= buggy bar?",
      (target.votesFor ?? 0) >= clot(buggySenateDocs)
    );
  }

  // 2) All failed filibustered senate bills mis-killed by the buggy denominator
  console.log("\n=== Failed filibustered senate bills that SHOULD have passed cloture ===");
  const failed = await bills
    .find({
      status: "failed",
      filibusterInvocations: { $exists: true, $ne: [] },
    })
    .project({
      title: 1,
      countryId: 1,
      currentChamber: 1,
      originChamber: 1,
      votesFor: 1,
      votesAgainst: 1,
      failedAt: 1,
    })
    .toArray();

  const misKilled: any[] = [];
  for (const b of failed) {
    // Only senate-chamber closes are subject to the cloture denominator.
    const chamber = b.currentChamber === "joint" ? b.originChamber : b.currentChamber;
    if (chamber !== "senate") continue;
    const cid = b.countryId ?? "US";
    const correctBar = clot(seatsByCountry[cid] ?? 0);
    const buggyBar = clot(buggySenateDocs);
    const vf = b.votesFor ?? 0;
    if (vf >= correctBar && vf < buggyBar) {
      misKilled.push({
        _id: String(b._id),
        title: b.title,
        countryId: cid,
        votesFor: vf,
        correctBar,
        buggyBar,
        failedAt: b.failedAt,
      });
    }
  }
  console.log("count:", misKilled.length);
  for (const m of misKilled) console.log(m);

  console.log("\n(Read-only audit complete — no writes performed.)");
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
