/**
 * DRY RUN (read-only) — Repair readiness values corrupted by the applyOutcome write.
 *
 * `applyOutcome` persisted `u.readiness - r.readiness`, but `UnitResult.readiness` is
 * the LEVEL a battle left, not the amount it took. Every formation that has fought was
 * therefore written back at the SIZE OF ITS OWN DROP. The stored numbers are not low
 * readiness values; they are not readiness values at all, and the true level is
 * unrecoverable from them.
 *
 * The repair sets each unit to the NOMINAL baseline for its posture
 * (`readinessBaselineOf(posture)`, arrears and tier deliberately excluded). The turn
 * processor's own drift moves in BOTH directions at 4/turn, so any country actually in
 * arrears or running a reduced tier is pulled back down to its real target within a few
 * turns. Seeding at the nominal baseline therefore needs no per-country fiscal lookup and
 * cannot leave a force permanently above where the live rules would hold it.
 *
 * Verifies, WITHOUT writing anything:
 *   (A) Every unit has a recognised posture, so no unit is skipped silently.
 *   (B) How many units are actually corrupt (below the floor a real level would sit at).
 *   (C) The backup collection does not already exist, so an apply cannot clobber one.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-readiness-ledger-0828.dry-run.ts            # live
 *   npx tsx scripts/migrations/heal-readiness-ledger-0828.dry-run.ts --db=local
 *
 * Defaults to MONGODB_URI_LIVE. Pass --db=local to use MONGODB_URI.
 */
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import {
  readinessBaselineOf,
  POSTURE_READINESS_BASELINE,
} from "../../src/lib/military/readinessDrift";

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
  const local = process.argv.includes("--db=local");
  const client = new MongoClient(uriFor(local));
  await client.connect();
  try {
    const db = client.db();
    console.log(`target: ${local ? "MONGODB_URI (local/testing)" : "MONGODB_URI_LIVE"}`);

    const names = (await db.listCollections().toArray()).map((c) => c.name);
    console.log(
      `\n(C) backup collection "${BACKUP}" present? ${names.includes(BACKUP) ? "YES - apply would refuse" : "no"}`
    );

    const units = await db.collection("militaryUnits").find({}).toArray();
    console.log(`\nmilitaryUnits: ${units.length}`);

    const known = new Set(Object.keys(POSTURE_READINESS_BASELINE));
    const unknown = units.filter((u) => !known.has(String(u.posture)));
    console.log(`(A) units with an unrecognised posture: ${unknown.length}`);
    for (const u of unknown.slice(0, 5))
      console.log(`      ${u.countryId} ${u.name} posture=${JSON.stringify(u.posture)}`);

    // A real readiness level sits near its posture baseline; a drop magnitude does not.
    const byCountry = new Map<
      string,
      { n: number; sum: number; min: number; max: number; below: number }
    >();
    let totalBelowHalf = 0;
    for (const u of units) {
      const target = readinessBaselineOf(String(u.posture));
      const r = Number(u.readiness ?? 0);
      const e = byCountry.get(String(u.countryId)) ?? {
        n: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        below: 0,
      };
      e.n++;
      e.sum += r;
      e.min = Math.min(e.min, r);
      e.max = Math.max(e.max, r);
      if (r < target / 2) {
        e.below++;
        totalBelowHalf++;
      }
      byCountry.set(String(u.countryId), e);
    }
    console.log(
      `(B) units below HALF their posture baseline: ${totalBelowHalf} of ${units.length}`
    );

    console.log(
      "\ncountry   units   avg readiness   min   max   below half baseline   -> would become"
    );
    const rows = [...byCountry.entries()].sort((a, b) => b[1].n - a[1].n);
    for (const [c, e] of rows) {
      const sample = units.find((u) => String(u.countryId) === c)!;
      const target = readinessBaselineOf(String(sample.posture));
      console.log(
        `${c.padEnd(9)} ${String(e.n).padStart(5)}   ${(e.sum / e.n).toFixed(1).padStart(13)}   ${String(e.min).padStart(3)}   ${String(e.max).padStart(3)}` +
          `   ${String(e.below).padStart(19)}   ${String(target).padStart(13)} (posture of first unit: ${sample.posture})`
      );
    }

    const postures = new Map<string, number>();
    for (const u of units)
      postures.set(String(u.posture), (postures.get(String(u.posture)) ?? 0) + 1);
    console.log("\nposture distribution and the level each would be set to:");
    for (const [p, n] of postures)
      console.log(`  ${p.padEnd(10)} ${String(n).padStart(4)} units -> ${readinessBaselineOf(p)}`);

    console.log("\nNo writes performed.");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
