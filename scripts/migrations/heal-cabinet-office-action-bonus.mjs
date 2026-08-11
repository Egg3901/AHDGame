/**
 * Bug #0758 — heal: add the cabinet office-action-bonus keys to the live
 * gameConfig.officeActionBonus so sitting cabinet ministers regain their office
 * AP next turn (instead of waiting for a reseed).
 *
 * Cabinet appointment overwrites `currentOffice` with a cabinet office key
 * (parliamentaryCabinet / ukCabinet / usCabinet). The live config never had
 * action-bonus entries for those keys, so resolveOfficeActionBonus computed the
 * cabinet increment as 0. This sets each to 1 (matching the seed); the increment
 * STACKS on the recovered legislative seat, so DE/UK ministers go to seat + 1.
 *
 * READ-ONLY by default. Pass --apply to write.
 *   node scripts/migrations/heal-cabinet-office-action-bonus.mjs            # dry run
 *   node scripts/migrations/heal-cabinet-office-action-bonus.mjs --apply    # write
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env.local lives in the main repo root; when run from a worktree it is several
// levels up. Walk upward until we find it.
let dir = __dirname;
for (let i = 0; i < 8; i++) {
  const candidate = path.join(dir, ".env.local");
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
  dir = path.dirname(dir);
}

const APPLY = process.argv.includes("--apply");
const CABINET_BONUSES = { parliamentaryCabinet: 1, ukCabinet: 1, usCabinet: 1 };

const client = new MongoClient(process.env.MONGODB_URI_LIVE, { serverSelectionTimeoutMS: 20000 });

async function main() {
  await client.connect();
  const db = client.db("a-house-divided");
  const cfg = await db.collection("gameConfig").findOne({ _id: "default" });
  if (!cfg) {
    console.error("No gameConfig 'default' document found — aborting.");
    process.exitCode = 1;
    return;
  }
  const oab = cfg.officeActionBonus ?? {};

  const set = {};
  for (const [key, value] of Object.entries(CABINET_BONUSES)) {
    const current = oab[key];
    if (current === value) {
      console.log(`  ${key}: already ${value} — no change`);
    } else {
      console.log(`  ${key}: ${current ?? "(missing)"} -> ${value}`);
      set[`officeActionBonus.${key}`] = value;
    }
  }

  if (Object.keys(set).length === 0) {
    console.log("\nNothing to change. Live config already healed.");
    return;
  }

  if (!APPLY) {
    console.log(
      `\nDRY RUN — ${Object.keys(set).length} key(s) would be set. Re-run with --apply to write.`
    );
    return;
  }

  const res = await db.collection("gameConfig").updateOne({ _id: "default" }, { $set: set });
  console.log(`\nAPPLIED — matched ${res.matchedCount}, modified ${res.modifiedCount}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.close());
