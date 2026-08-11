/**
 * NG Senate: backfill live election sizing + rebuild the collapsed composition.
 *
 * Same class of bug as the House (#901): NG Senate elections spawned with
 * totalSeats=1, so each zone seated 1 senator and the chamber collapsed from 109
 * to 6. The Senate additionally needed a code fix (allocateSeats now treats a
 * "senate" race with totalSeats>1 as multi-seat). This script:
 *   1) backfills active/upcoming NG senate elections' totalSeats to the zone's
 *      stateSenateSeats (so the in-flight cycle resolves correctly), and
 *   2) rebuilds the seated composition by re-allocating each zone's latest
 *      resolved senate election from its real vote tally at the correct seat
 *      count — scoped to NG, stamping countryId:"NG".
 *
 * MUST run from the worktree cwd so it uses the fixed multi-seat allocateSeats.
 *   cd <repo root>
 *   node_modules/.bin/tsx scripts/repair-ng-senate.ts          # dry run
 *   node_modules/.bin/tsx scripts/repair-ng-senate.ts --apply  # write
 */
import path from "path";
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import { allocateSeats } from "@/lib/turn/election/seatAllocation";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
const directUri = (u: string) =>
  u.includes("directConnection=") ? u : `${u}&directConnection=true`;

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(directUri(uri));
  await client.connect();
  const db = client.db();
  const now = new Date();

  // NG state docs use string _ids (zone keys like NORTH_WEST).
  const states = await db
    .collection<{ _id: string; stateSenateSeats?: number }>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, stateSenateSeats: 1 } })
    .toArray();
  const seatsByZone = new Map<string, number>(states.map((s) => [s._id, s.stateSenateSeats ?? 0]));

  // 1) Backfill live (active/upcoming) senate elections so the in-flight cycle resolves right.
  const live = await db
    .collection("elections")
    .find({ countryId: "NG", electionType: "senate", status: { $in: ["active", "upcoming"] } })
    .toArray();
  let backfilled = 0;
  for (const e of live) {
    const target = seatsByZone.get(e.state as string) ?? 0;
    if (target > 1 && e.totalSeats !== target) {
      console.log(
        `  backfill live ${e.state} cyc${e.cycle}: totalSeats ${e.totalSeats} -> ${target}`
      );
      if (apply) {
        await db
          .collection("elections")
          .updateOne({ _id: e._id }, { $set: { totalSeats: target, updatedAt: now } });
        backfilled++;
      }
    }
  }

  // 2) Rebuild composition from each zone's latest resolved senate election.
  const resolved = await db
    .collection("elections")
    .find({ countryId: "NG", electionType: "senate", status: "resolved" })
    .sort({ cycle: -1 })
    .toArray();
  const latestByZone = new Map<string, (typeof resolved)[number]>();
  for (const e of resolved)
    if (!latestByZone.has(e.state as string)) latestByZone.set(e.state as string, e);

  let created = 0,
    removed = 0,
    healed = 0;
  for (const [zone, election] of latestByZone) {
    const target = seatsByZone.get(zone) ?? 0;
    if (target < 1) {
      console.log(`  ${zone}: no stateSenateSeats — SKIP`);
      continue;
    }
    const tally = await db.collection("electionVoteTallies").findOne({ electionId: election._id });
    if (!tally?.totalVotes || Object.keys(tally.totalVotes).length === 0) {
      console.log(`  ${zone} cyc${election.cycle}: no tally — SKIP`);
      continue;
    }
    const totalVotesCast = (Object.values(tally.totalVotes) as number[]).reduce((s, v) => s + v, 0);
    if (totalVotesCast === 0) {
      console.log(`  ${zone}: 0 votes — SKIP`);
      continue;
    }
    const ranked = Object.entries(tally.totalVotes)
      .map(([id, votes]) => ({ id, votes: votes as number }))
      .sort((a, b) => b.votes - a.votes);

    const { winners } = allocateSeats("senate", zone, target, ranked, totalVotesCast);
    const cands = await db
      .collection("electionCandidates")
      .find({ electionId: election._id })
      .toArray();
    const candMap = new Map(cands.map((c) => [c._id.toString(), c]));
    const alloc = winners
      .map(([cid, seats]) => ({ c: candMap.get(cid), seats }))
      .filter((w) => w.c && w.seats > 0);
    const sum = alloc.reduce((s, w) => s + w.seats, 0);
    console.log(
      `  ${zone} cyc${election.cycle}: 1→${target}  →  ${alloc.map((w) => `${w.c!.party}:${w.seats}`).join("  ")}  (sum ${sum})`
    );
    healed += sum;

    if (apply) {
      await db
        .collection("elections")
        .updateOne({ _id: election._id }, { $set: { totalSeats: target, updatedAt: now } });
      const del = await db
        .collection("electedOfficials")
        .deleteMany({ countryId: "NG", officeType: "senate", state: zone });
      removed += del.deletedCount;
      for (const { c, seats } of alloc) {
        const cand = c!;
        await db.collection("electedOfficials").insertOne({
          _id: new ObjectId(),
          countryId: "NG",
          officeType: "senate",
          state: zone,
          isAppointment: false,
          seatsHeld: seats,
          characterId: cand.isNPP ? null : cand.characterId,
          characterName: cand.characterName,
          party: cand.party,
          isNPP: cand.isNPP ?? false,
          nppId: cand.nppId ?? undefined,
          electedAt: now,
          createdAt: now,
          updatedAt: now,
        } as never);
        created++;
        const office = { type: "senate", state: zone, seatsHeld: seats };
        if (cand.isNPP && cand.nppId)
          await db
            .collection("npps")
            .updateOne({ _id: cand.nppId }, { $set: { currentOffice: office, updatedAt: now } });
        else if (cand.characterId)
          await db
            .collection("characters")
            .updateOne(
              { _id: cand.characterId },
              { $set: { currentOffice: office, updatedAt: now } }
            );
      }
    }
  }

  console.log(`\nTotal senate seats across zones: ${healed} (expect ~109)`);
  console.log(
    apply
      ? `APPLIED: backfilled ${backfilled} live, removed ${removed} old officials, created ${created} new.`
      : `DRY RUN — re-run with --apply.`
  );
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
