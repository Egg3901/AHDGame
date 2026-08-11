/**
 * Seed NG's mid-term incumbent roster + resolved last-general election at the
 * current game year, keeping status coming-soon. President/Senate/House via
 * seedFromSeats aggregates (governors already seeded); resolved cycle-N election
 * records set prevCycle so the next NG general lands on the correct future cycle.
 *
 * DRY RUN default; --apply mutates; --live = MONGODB_URI_LIVE. Idempotent.
 * Run: npx tsx scripts/migrations/2026-06-30-ng-current-state-seed.ts --live [--apply]
 */
import { MongoClient, ObjectId } from "mongodb";
import type { Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import { buildNGCurrentRoster } from "../../src/lib/seeds/ng/ngCurrentStateRoster";
import { seedFromSeats } from "../../src/lib/npp/seedHistorical";
import { NG_REGIONAL_COUNCIL_SEATS } from "../../src/lib/constants/states";
import {
  NG_REGION_VOTE_SHARES_1991,
  NG_REGION_VOTE_SHARES_2019,
} from "../../src/lib/seeds/ng/ngRegionVoteShares";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });
const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");
const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"}`);
  process.exit(1);
}

const NG_GENERAL_ANCHOR_TURN = 144; // end of 1993 (1991-default)
const CYCLE_TURNS = 192;

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db() as unknown as Db;
  console.log(`Target: ${useLive ? "LIVE" : "local"} db "${db.databaseName}"`);

  const gs = await db
    .collection<{ _id: string; preset?: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" });
  const preset = gs?.preset ?? "1991-default";
  const currentTurn = gs?.currentTurn ?? 0;
  const startingYear = preset === "2019-default" ? 2019 : 1991;

  // Last-completed concurrent cycle from currentTurn.
  const cycle = Math.max(1, Math.floor((currentTurn - NG_GENERAL_ANCHOR_TURN) / CYCLE_TURNS) + 1);
  const anchorYear = preset === "2019-default" ? 2023 : 1993;
  const electionYear = anchorYear + (cycle - 1) * 4;
  console.log(
    `preset=${preset} currentTurn=${currentTurn} → last-completed cycle=${cycle}, year=${electionYear}`
  );

  const states = await db
    .collection<{
      _id: string;
      population?: number;
      houseDistricts?: number;
      stateSenateSeats?: number;
    }>("states")
    .find({ countryId: "NG" })
    .toArray();
  const pop: Record<string, number> = {},
    house: Record<string, number> = {},
    senate: Record<string, number> = {};
  for (const s of states) {
    pop[s._id] = s.population ?? 0;
    house[s._id] = s.houseDistricts ?? 0;
    senate[s._id] = s.stateSenateSeats ?? 0;
  }
  const voteShares =
    preset === "2019-default" ? NG_REGION_VOTE_SHARES_2019 : NG_REGION_VOTE_SHARES_1991;

  const roster = buildNGCurrentRoster({
    voteShares,
    zonePopulations: pop,
    houseSeatsByZone: house,
    senateSeatsByZone: senate,
    regionalCouncilSeatsByZone: NG_REGIONAL_COUNCIL_SEATS,
    cycle,
    electionYear,
    ctx: { startingYear, preset },
  });

  // Idempotency guards.
  const existingHouse = await db
    .collection("electedOfficials")
    .countDocuments({ countryId: "NG", officeType: "house" });
  const existingElections = await db
    .collection("elections")
    .countDocuments({ countryId: "NG", cycle });

  console.log(`\nPlan:`);
  console.log(`  president: ${roster.presidentSlug}`);
  console.log(`  historicalSeats: ${roster.historicalSeats.length} (house+senate+president)`);
  console.log(`  senate seatsHeld updates: ${roster.senateSeatsHeld.length}`);
  console.log(`  resolved elections (cycle ${cycle}): ${roster.resolvedElections.length}`);
  console.log(
    `  existing NG house officials: ${existingHouse}; NG cycle-${cycle} elections: ${existingElections}`
  );

  if (!apply) {
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"}). Re-run with --apply.`);
    await client.close();
    return;
  }

  console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"})...`);
  const log = (m: string) => console.log("    " + m);
  if (existingHouse === 0) {
    const res = await seedFromSeats(db, roster.historicalSeats);
    console.log(`  seedFromSeats: ${res.nppsCreated} NPPs, ${res.officialsCreated} officials`);
    // Set seatsHeld on the freshly-seeded NG senate officials (seedFromSeats skips it for senate).
    for (const s of roster.senateSeatsHeld) {
      const party = await db
        .collection<{ _id: ObjectId; sequentialId: number; name: string }>("politicalParties")
        .findOne({
          countryId: "NG",
          name: s.slug === "ng_sdp" ? "Social Democratic Party" : "National Republican Convention",
        });
      if (party) {
        const filter = {
          countryId: "NG",
          officeType: "senate",
          state: s.zone,
          party: String(party.sequentialId),
        };
        await db
          .collection("electedOfficials")
          .updateMany(filter, { $set: { seatsHeld: s.seats } });
      }
    }
    log(`set seatsHeld on senate officials`);
  } else {
    console.log(`  skip officials — ${existingHouse} NG house officials already exist`);
  }

  if (existingElections === 0) {
    const now = new Date();
    const docs = roster.resolvedElections.map((e) => ({
      _id: new ObjectId(),
      countryId: "NG",
      electionType: e.electionType,
      state: e.state,
      cycle: e.cycle,
      electionYear: e.electionYear,
      status: "resolved",
      startTurn: e.startTurn,
      endTurn: e.endTurn,
      primaryEndTurn: e.primaryEndTurn,
      winningParty: e.winningPartySlug,
      createdAt: now,
      updatedAt: now,
    }));
    await db.collection("elections").insertMany(docs as never);
    console.log(`  inserted ${docs.length} resolved cycle-${cycle} elections`);
  } else {
    console.log(
      `  skip elections — ${existingElections} NG cycle-${cycle} elections already exist`
    );
  }

  console.log("Done.");
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
