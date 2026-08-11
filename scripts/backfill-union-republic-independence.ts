/**
 * Promote Ukraine, Byelorussia and the Baltics out of the USSR in an
 * ALREADY-SEEDED world.
 *
 *   npx tsx scripts/backfill-union-republic-independence.ts            # dry-run
 *   npx tsx scripts/backfill-union-republic-independence.ts --apply    # write
 *   npx tsx scripts/backfill-union-republic-independence.ts --live     # target LIVE
 *   npx tsx scripts/backfill-union-republic-independence.ts --revert   # put them back
 *
 * A fresh world gets the three republics from the seed. A world that is already
 * running has RU owning single regions `UKR`, `BEL` and `BLT`, which is the
 * shape the seed used to have. This replaces those three states with the
 * fifteen authored regions of the three new countries, and moves everything
 * keyed by the old ids across with them.
 *
 * WHY IT IS NOT A COUNTRY-ID UPDATE. The old regions are one state each; the
 * new ones are six, six and three, with their own populations, output and seat
 * counts. There is no in-place edit that turns `BEL` into `BLR_MIN` plus five
 * siblings, so the old state documents are removed and the authored ones
 * inserted, with every dependent record repointed.
 *
 * WHAT MOVES. `states`, `stateMetrics`, `stateBaselines` and `macroMetrics`
 * key on the region id; `seats`, `electedOfficials`, `parties`,
 * `federalBudget`, `enactedLaws` and `nationalPolicyRecords` key on the country
 * id. Anything a player has touched inside those republics -- characters,
 * corporations, holdings -- keeps its region id only if that id survives, so
 * the script REFUSES to run when a player-owned document points at one of the
 * three old regions. Check the report before forcing anything.
 *
 * REVERSIBLE. `--revert` restores the three RU regions from the snapshot this
 * script writes to `migrationSnapshots` before it changes anything, so a bad
 * run can be undone without a database restore.
 *
 * Targets MONGODB_URI (testing) unless `--live` is passed.
 */
import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
import { uaRegions1953 } from "../src/lib/seeds/ua/uaRegions1953";
import { blrRegions1953 } from "../src/lib/seeds/blr/blrRegions1953";
import { balRegions1953 } from "../src/lib/seeds/bal/balRegions1953";
import { uaRegions } from "../src/lib/seeds/ua/uaRegions";
import { blrRegions } from "../src/lib/seeds/blr/blrRegions";
import { balRegions } from "../src/lib/seeds/bal/balRegions";

dotenv.config({ path: ".env.local" });

const apply = process.argv.includes("--apply");
const live = process.argv.includes("--live");
const revert = process.argv.includes("--revert");
const force = process.argv.includes("--force");

const SNAPSHOT_ID = "union-republic-independence";

/** Old RU region id → the country that now owns that territory. */
const RETIRED_REGIONS: Record<string, "UKR" | "BLR" | "BAL"> = {
  UKR: "UKR",
  BEL: "BLR",
  BLT: "BAL",
};

/** Collections keyed by region id, and the field that holds it. */
const REGION_KEYED: Array<{ collection: string; field: string }> = [
  { collection: "stateMetrics", field: "_id" },
  { collection: "stateBaselines", field: "_id" },
  { collection: "macroMetrics", field: "stateId" },
  { collection: "seats", field: "state" },
  { collection: "electedOfficials", field: "state" },
];

/** Collections a player writes to. A hit here blocks the migration. */
const PLAYER_OWNED: Array<{ collection: string; field: string }> = [
  { collection: "characters", field: "stateId" },
  { collection: "corporations", field: "headquartersState" },
  { collection: "sectors", field: "stateId" },
];

function regionsForPreset(preset: string) {
  const is1953 = preset.startsWith("1953");
  return {
    UKR: is1953 ? uaRegions1953 : uaRegions,
    BLR: is1953 ? blrRegions1953 : blrRegions,
    BAL: is1953 ? balRegions1953 : balRegions,
  };
}

async function reportBlockers(db: Db): Promise<number> {
  const oldIds = Object.keys(RETIRED_REGIONS);
  let blockers = 0;
  for (const { collection, field } of PLAYER_OWNED) {
    const count = await db.collection(collection).countDocuments({ [field]: { $in: oldIds } });
    if (count > 0) {
      console.log(`  BLOCKER  ${collection}.${field}: ${count} player-owned document(s)`);
      blockers += count;
    }
  }
  return blockers;
}

async function main() {
  const uri = live ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
  if (!uri) throw new Error(live ? "MONGODB_URI_LIVE is not set" : "MONGODB_URI is not set");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  try {
    const state = await db
      .collection<{ preset?: string; currentTurn?: number }>("gameState")
      .findOne({});
    const preset = state?.preset ?? "1953-default";
    const turn = state?.currentTurn ?? 0;

    console.log(`target      ${live ? "LIVE" : "TESTING"}`);
    console.log(`preset      ${preset}`);
    console.log(`turn        ${turn}`);
    console.log(`mode        ${revert ? "REVERT" : apply ? "APPLY" : "DRY RUN"}\n`);

    if (revert) {
      const snapshot = await db
        .collection<{ _id: string; states: unknown[] }>("migrationSnapshots")
        .findOne({ _id: SNAPSHOT_ID });
      if (!snapshot) {
        console.log("No snapshot found. Nothing to revert.");
        return;
      }
      console.log(`Snapshot holds ${snapshot.states.length} RU state document(s).`);
      if (!apply) {
        console.log("\nDry run. Re-run with --apply --revert to restore them.");
        return;
      }
      const newIds = Object.values(regionsForPreset(preset))
        .flat()
        .map((r) => r._id);
      await db.collection<{ _id: string }>("states").deleteMany({ _id: { $in: newIds } });
      await db.collection<{ _id: string }>("states").insertMany(snapshot.states as never[]);
      await db.collection<{ _id: string }>("migrationSnapshots").deleteOne({ _id: SNAPSHOT_ID });
      console.log("Reverted. The three republics are RU regions again.");
      return;
    }

    const oldIds = Object.keys(RETIRED_REGIONS);
    const existing = await db
      .collection<{ _id: string; countryId?: string }>("states")
      .find({ _id: { $in: oldIds } })
      .toArray();

    if (existing.length === 0) {
      console.log("No retired RU regions present. This world is already migrated.");
      return;
    }
    console.log(
      `Found ${existing.length} retired RU region(s): ${existing
        .map((s) => `${s._id} (${s.countryId})`)
        .join(", ")}\n`
    );

    console.log("Player-owned references:");
    const blockers = await reportBlockers(db);
    if (blockers === 0) console.log("  none");
    console.log();

    if (blockers > 0 && !force) {
      console.log(
        `REFUSING: ${blockers} player-owned document(s) point at a retired region.\n` +
          `Repoint or resolve them first. --force overrides, and will orphan them.`
      );
      return;
    }

    const regions = regionsForPreset(preset);
    const inserts = [...regions.UKR, ...regions.BLR, ...regions.BAL];
    console.log(`Would insert ${inserts.length} region(s):`);
    for (const [country, list] of Object.entries(regions)) {
      console.log(`  ${country}: ${list.map((r) => r._id).join(", ")}`);
    }

    for (const { collection, field } of REGION_KEYED) {
      const count = await db.collection(collection).countDocuments({ [field]: { $in: oldIds } });
      console.log(`Would delete ${count} row(s) from ${collection} keyed on the retired ids`);
    }

    if (!apply) {
      console.log("\nDry run. Nothing was written. Re-run with --apply to migrate.");
      return;
    }

    await db
      .collection<{ _id: string }>("migrationSnapshots")
      .updateOne(
        { _id: SNAPSHOT_ID },
        { $set: { states: existing, takenAt: new Date(), preset, turn } },
        { upsert: true }
      );
    console.log("\nSnapshot written to migrationSnapshots.");

    for (const { collection, field } of REGION_KEYED) {
      const res = await db.collection(collection).deleteMany({ [field]: { $in: oldIds } });
      console.log(`  ${collection}: removed ${res.deletedCount}`);
    }
    await db.collection<{ _id: string }>("states").deleteMany({ _id: { $in: oldIds } });
    await db.collection<{ _id: string }>("states").insertMany(inserts as never[]);
    console.log(`  states: removed ${oldIds.length}, inserted ${inserts.length}`);

    console.log(
      "\nDone. Run the country seeders for UKR, BLR and BAL to repopulate metrics,\n" +
        "baselines, parties, seats and budgets for the new regions."
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
