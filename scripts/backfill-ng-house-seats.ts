/**
 * #901 backfill — size live Nigeria House elections to their zone seat counts.
 *
 * The perpetual-election spawner (ensureNGElections) previously created each NG
 * zone House election with totalSeats=1, so the chamber projected/resolved as 6
 * single-winner races instead of 360 seats. The code fix sizes new cycles from
 * each zone's houseDistricts, but elections already active/upcoming still carry
 * totalSeats=1 until they resolve+respawn. This one-off corrects those in place.
 *
 * Dry-run by default (prints before/after). Pass --apply to write.
 *
 *   cd .
 *   node_modules/.bin/tsx ./scripts/backfill-ng-house-seats.ts          # dry run
 *   node_modules/.bin/tsx ./scripts/backfill-ng-house-seats.ts --apply  # write
 */
import path from "path";
import { MongoClient, type ObjectId } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Fallback zone seat table (matches src/lib/seeds/ng/ngRegions.ts) used only if
// a state doc is missing houseDistricts. The DB value is preferred.
const NG_SEATS_FALLBACK: Record<string, number> = {
  NORTH_WEST: 95,
  NORTH_EAST: 50,
  NORTH_CENTRAL: 53,
  SOUTH_WEST: 72,
  SOUTH_SOUTH: 47,
  SOUTH_EAST: 43,
};

function directUri(uri: string): string {
  return uri.includes("directConnection=") ? uri : `${uri}&directConnection=true`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set (expected in .env.local)");

  const client = new MongoClient(directUri(uri));
  await client.connect();
  const db = client.db();

  // NG state docs use string _ids (zone keys like NORTH_WEST).
  const states = await db
    .collection<{ _id: string; houseDistricts?: number }>("states")
    .find({ countryId: "NG" }, { projection: { _id: 1, houseDistricts: 1 } })
    .toArray();
  const seatsByRegion = new Map<string, number>(
    states.map((s) => [s._id, s.houseDistricts ?? NG_SEATS_FALLBACK[s._id] ?? 1])
  );

  const elections = await db
    .collection("elections")
    .find({ countryId: "NG", electionType: "house", status: { $in: ["active", "upcoming"] } })
    .toArray();

  console.log(`Found ${elections.length} live NG House election(s).`);
  let toFix = 0;
  const ops: { id: ObjectId; from: number; to: number; state: string }[] = [];
  for (const e of elections) {
    const target = seatsByRegion.get(e.state as string) ?? NG_SEATS_FALLBACK[e.state as string];
    const current = (e.totalSeats as number | undefined) ?? undefined;
    if (!target) {
      console.log(`  ! ${e.state}: no target seat count known — SKIP`);
      continue;
    }
    const flag = current === target ? "ok" : "FIX";
    console.log(`  [${flag}] ${e.state}: totalSeats ${current} -> ${target}  (election ${e._id})`);
    if (current !== target) {
      toFix++;
      ops.push({ id: e._id, from: current ?? NaN, to: target, state: e.state as string });
    }
  }

  console.log(
    `\nSum of target seats across live elections: ${[...seatsByRegion.values()].reduce((a, b) => a + b, 0)} (expect 360 across all 6 zones)`
  );
  console.log(`${toFix} election(s) need correction.`);

  if (!apply) {
    console.log("\nDRY RUN — no writes. Re-run with --apply to persist.");
  } else if (ops.length > 0) {
    const result = await db.collection("elections").bulkWrite(
      ops.map((o) => ({
        updateOne: { filter: { _id: o.id }, update: { $set: { totalSeats: o.to } } },
      }))
    );
    console.log(`\nAPPLIED: modified ${result.modifiedCount} election document(s).`);
  } else {
    console.log("\nNothing to apply.");
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
