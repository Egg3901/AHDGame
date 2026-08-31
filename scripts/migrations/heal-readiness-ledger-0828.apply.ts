/**
 * APPLY — Repair readiness values corrupted by the applyOutcome write.
 *
 * See heal-readiness-ledger-0828.dry-run.ts for the diagnosis. In short: `applyOutcome`
 * stored `u.readiness - r.readiness` while `UnitResult.readiness` is the LEVEL a battle
 * left, so every formation that fought was written back at the size of its own drop. The
 * true level is unrecoverable, so affected units are reset to the nominal baseline for
 * their posture and allowed to drift to their real target from there.
 *
 * SCOPE: only units sitting below HALF their posture baseline. That predicate catches
 * exactly the formations that have been through the broken write (in practice the three
 * belligerents of war_us_dd_415) and leaves every nation that has never fought alone,
 * whose spread of 49-92 is genuine drift state and must not be flattened.
 *
 * Symmetric by construction: all three belligerents are repaired in the same pass, so
 * none of them gains an advantage over the others from the reset.
 *
 * Writes a full backup of every touched unit to `militaryUnits_readiness_backup_0828`
 * and REFUSES to run if that collection already exists.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-readiness-ledger-0828.apply.ts --yes            # live
 *   npx tsx scripts/migrations/heal-readiness-ledger-0828.apply.ts --yes --db=local
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { readinessBaselineOf } from "../../src/lib/military/readinessDrift";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const BACKUP = "militaryUnits_readiness_backup_0828";

function uriFor(local: boolean): string {
  let u = (local ? process.env.MONGODB_URI : process.env.MONGODB_URI_LIVE) as string;
  if (!u) throw new Error(local ? "MONGODB_URI unset" : "MONGODB_URI_LIVE unset");
  if (!local && !/directConnection=/.test(u))
    u += (u.includes("?") ? "&" : "?") + "directConnection=true";
  return u;
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to write without --yes. Run the .dry-run.ts first.");
    process.exit(1);
  }
  const local = process.argv.includes("--db=local");
  const client = new MongoClient(uriFor(local));
  await client.connect();
  try {
    const db = client.db();
    console.log(`target: ${local ? "MONGODB_URI (local/testing)" : "MONGODB_URI_LIVE"}`);

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    if (names.includes(BACKUP)) {
      console.error(`Backup collection "${BACKUP}" already exists. Refusing to run twice.`);
      process.exit(1);
    }

    const units = await db.collection("militaryUnits").find({}).toArray();
    const affected = units
      .map((u) => ({ u, target: readinessBaselineOf(String(u.posture)) }))
      .filter(({ u, target }) => Number(u.readiness ?? 0) < target / 2);

    if (affected.length === 0) {
      console.log("Nothing to repair.");
      return;
    }

    await db.collection(BACKUP).insertMany(
      affected.map(({ u, target }) => ({
        unitId: u._id,
        countryId: u.countryId,
        name: u.name,
        posture: u.posture,
        readinessBefore: u.readiness,
        readinessAfter: target,
        healedAt: new Date().toISOString(),
      }))
    );
    console.log(`backed up ${affected.length} units to ${BACKUP}`);

    const res = await db.collection("militaryUnits").bulkWrite(
      affected.map(({ u, target }) => ({
        updateOne: { filter: { _id: u._id }, update: { $set: { readiness: target } } },
      }))
    );
    console.log(`modified ${res.modifiedCount} units`);

    const byCountry = new Map<string, number>();
    for (const { u } of affected)
      byCountry.set(String(u.countryId), (byCountry.get(String(u.countryId)) ?? 0) + 1);
    console.log("\nrepaired by country:");
    for (const [c, n] of [...byCountry.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${c.padEnd(6)} ${n}`);

    const after = await db
      .collection("militaryUnits")
      .find({ _id: { $in: affected.map(({ u }) => u._id) } })
      .toArray();
    const bad = after.filter(
      (u) => Number(u.readiness) < readinessBaselineOf(String(u.posture)) / 2
    );
    console.log(
      `\nverification: ${bad.length} of ${after.length} still below half baseline (expect 0)`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
