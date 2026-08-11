/**
 * Seed NG's State House of Assembly (regionalCouncil) incumbents per zone at the
 * current game year, plus resolved last-cycle assembly elections. Parity with the
 * 2026-06-30 House/Senate/Governor seed. DRY RUN default; --apply mutates; --live.
 * Idempotent: skips when NG regionalCouncil officials already exist.
 * Run: npx tsx scripts/migrations/2026-07-01-ng-regional-council-seed.ts --live [--apply]
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
const NG_GENERAL_ANCHOR_TURN = 144;
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
  const cycle = Math.max(1, Math.floor((currentTurn - NG_GENERAL_ANCHOR_TURN) / CYCLE_TURNS) + 1);
  const anchorYear = preset === "2019-default" ? 2023 : 1993;
  const electionYear = anchorYear + (cycle - 1) * 4;

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
  const rcSeats = roster.historicalSeats.filter((s) => s.officeType === "regionalCouncil");
  const rcElections = roster.resolvedElections.filter((e) => e.electionType === "regionalCouncil");

  const existing = await db
    .collection("electedOfficials")
    .countDocuments({ countryId: "NG", officeType: "regionalCouncil" });

  console.log(`preset=${preset} turn=${currentTurn} cycle=${cycle}/${electionYear}`);
  console.log(
    `  regionalCouncil historicalSeats: ${rcSeats.length}; resolved elections: ${rcElections.length}`
  );
  console.log(`  existing NG regionalCouncil officials: ${existing}`);

  if (!apply) {
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"}). Re-run with --apply.`);
    await client.close();
    return;
  }

  if (existing === 0) {
    const res = await seedFromSeats(db, rcSeats);
    console.log(`  seedFromSeats: ${res.nppsCreated} NPPs, ${res.officialsCreated} officials`);
    const now = new Date();
    const docs = rcElections.map((e) => ({
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
    console.log(`  inserted ${docs.length} resolved cycle-${cycle} regionalCouncil elections`);
  } else {
    console.log(`  skip — ${existing} NG regionalCouncil officials already exist`);
  }
  console.log("Done.");
  await client.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
