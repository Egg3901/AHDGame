/**
 * #901 data repair — rebuild the Nigeria House seated composition.
 *
 * The cycle-5 NG House elections resolved while totalSeats was still the buggy 1,
 * so each zone seated a single rep and the chamber collapsed from ~360 to 6.
 * This re-allocates each zone's latest resolved election from its real stored
 * vote tally at the CORRECT zone seat count (houseDistricts) and rebuilds the
 * NG House electedOfficials — the same logic as /api/admin/heal/multi-seat-elections
 * but scoped to NG only, and (unlike that endpoint) it stamps countryId:"NG" on
 * the rebuilt officials so they don't leak cross-country (#898 class).
 *
 *   cd .
 *   node_modules/.bin/tsx ./scripts/repair-ng-house-composition.ts          # dry run
 *   node_modules/.bin/tsx ./scripts/repair-ng-house-composition.ts --apply  # write
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

  // Authoritative per-zone seat counts.
  // NG state docs use string _ids (zone keys like NORTH_WEST).
  const states = await db
    .collection<{ _id: string; houseDistricts?: number }>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const seatsByZone = new Map<string, number>(states.map((s) => [s._id, s.houseDistricts ?? 0]));

  // Latest resolved house election per zone (the one that set the current chamber).
  const resolved = await db
    .collection("elections")
    .find({ countryId: "NG", electionType: "house", status: "resolved" })
    .sort({ cycle: -1 })
    .toArray();
  const latestByZone = new Map<string, (typeof resolved)[number]>();
  for (const e of resolved)
    if (!latestByZone.has(e.state as string)) latestByZone.set(e.state as string, e);

  let created = 0,
    removed = 0,
    healedSeats = 0;
  for (const [zone, election] of latestByZone) {
    const target = seatsByZone.get(zone) ?? 0;
    if (!target) {
      console.log(`  ${zone}: no houseDistricts target — SKIP`);
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

    const { winners } = allocateSeats("house", zone, target, ranked, totalVotesCast);
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
      `  ${zone} cyc${election.cycle}: totalSeats 1→${target}  →  ${alloc.map((w) => `${w.c!.party}:${w.seats}`).join("  ")}  (sum ${sum})`
    );
    healedSeats += sum;

    if (apply) {
      await db
        .collection("elections")
        .updateOne({ _id: election._id }, { $set: { totalSeats: target, updatedAt: now } });
      const del = await db
        .collection("electedOfficials")
        .deleteMany({ countryId: "NG", officeType: "house", state: zone });
      removed += del.deletedCount;
      for (const { c, seats } of alloc) {
        const cand = c!;
        await db.collection("electedOfficials").insertOne({
          _id: new ObjectId(),
          countryId: "NG",
          officeType: "house",
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
        const office = { type: "house", state: zone, seatsHeld: seats };
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

  console.log(`\nTotal seats across zones: ${healedSeats} (expect ~360)`);
  console.log(
    apply
      ? `APPLIED: removed ${removed} old officials, created ${created} new.`
      : `DRY RUN — re-run with --apply.`
  );
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
