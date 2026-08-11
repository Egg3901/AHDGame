/**
 * Bring live NG seed data in line with this branch's NG work (preparedness +
 * activation): correct the era-wrong parties and re-seed the NG-scoped
 * collections via the branch's own seed functions. NG stays coming-soon — this
 * only corrects the not-yet-player-facing seed data so it's right when you flip.
 *
 * What it does (for the live game's active preset, e.g. 1991-default):
 *   1. Delete NG politicalParties whose `validForPresets` excludes the active
 *      preset (live carries the 2019 set APC/PDP/… on a 1991 game — wrong era).
 *   2. seedNGParties        → the era-correct parties (1991 ⇒ SDP/NRC).
 *   3. seedNGStatePartyOrg  (reset) → wipe + reseed NG org for the new parties.
 *   4. seedNGStateMetrics   (reset) → reseed NG region metrics (+1991 presets).
 *   5. seedNGGovernors      (reset) → seed the era-correct governor roster.
 *   6. seedNGWiki           → (re)seed the NG country-guide wiki pages.
 *
 * NOT done here (deliberate):
 *   - NG legislation types: `seedLegislationTypes` drops the WHOLE collection
 *     (all countries), so it's a global deploy/bootstrap step, not an NG-scoped
 *     migration. NG legislation lands on the next full seed.
 *   - NG region NAMES: handled by the sibling 2026-06-30-ng-region-rename.mjs.
 *
 * Caveat surfaced in the dry run: deleting the era-wrong parties can orphan a
 * stale NG npp / governmentFormation that referenced them — reported so you can
 * decide before applying.
 *
 * Guarded: DRY RUN by default; `--apply` mutates; `--live` targets
 * MONGODB_URI_LIVE (else MONGODB_URI / dev).
 *
 * Run: npx tsx scripts/migrations/2026-06-30-ng-reseed-live.ts --live          (dry run)
 *      npx tsx scripts/migrations/2026-06-30-ng-reseed-live.ts --live --apply  (mutate)
 */
import { MongoClient } from "mongodb";
import type { Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  seedNGParties,
  seedNGStatePartyOrg,
  seedNGStateMetrics,
  seedNGGovernors,
} from "../../src/lib/admin/seed/seedNG";
import { seedNGWiki } from "../../src/lib/admin/seed/seedNGWiki";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const log = (m: string) => console.log("    " + m);

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db() as unknown as Db;
  console.log(`Target: ${useLive ? "LIVE" : "local"} db "${db.databaseName}"`);

  const gs = await db
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" });
  const preset = gs?.preset ?? "1991-default";
  console.log(`Active preset: ${preset}\n`);

  // ── Inspect current NG state ──────────────────────────────────────────────
  const parties = await db
    .collection<{
      _id: unknown;
      name: string;
      sequentialId: number;
      validForPresets?: string[];
    }>("politicalParties")
    .find({ countryId: "NG" })
    .toArray();
  const wrongEra = parties.filter((p) => !(p.validForPresets ?? []).includes(preset));
  const keep = parties.filter((p) => (p.validForPresets ?? []).includes(preset));
  const wrongSeqs = wrongEra.map((p) => String(p.sequentialId));

  console.log(`NG politicalParties: ${parties.length}`);
  for (const p of parties) {
    const tag = (p.validForPresets ?? []).includes(preset) ? "keep" : "DELETE (wrong era)";
    console.log(`  [${tag}] ${p.name} (seq ${p.sequentialId})`);
  }

  // Orphan-reference check (parties about to be deleted).
  const orphanNpps = wrongSeqs.length
    ? await db.collection("npps").countDocuments({ countryId: "NG", party: { $in: wrongSeqs } })
    : 0;
  const orphanGov = wrongSeqs.length
    ? await db
        .collection("governmentFormations")
        .countDocuments({ countryId: "NG", rulingPartyId: { $in: wrongSeqs } })
    : 0;
  if (orphanNpps || orphanGov) {
    console.log(
      `  ⚠ ${orphanNpps} npp + ${orphanGov} governmentFormation doc(s) reference a to-be-deleted party — review before applying.`
    );
  }

  console.log(
    `\nPlan for preset "${preset}":\n` +
      `  - delete ${wrongEra.length} wrong-era part(y/ies); keep ${keep.length}\n` +
      `  - seedNGParties → era-correct parties\n` +
      `  - seedNGStatePartyOrg (reset) → reseed NG org\n` +
      `  - seedNGStateMetrics (reset) → reseed NG metrics${preset === "1991-default" ? " (+1991 presets)" : ""}\n` +
      `  - seedNGGovernors (reset) → seed governor roster\n` +
      `  - seedNGWiki → (re)seed NG wiki pages`
  );

  if (!apply) {
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"}). Re-run with --apply to mutate.`);
    await client.close();
    return;
  }

  console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"})...`);
  if (wrongEra.length) {
    const del = await db
      .collection("politicalParties")
      .deleteMany({ _id: { $in: wrongEra.map((p) => p._id) } as never });
    console.log(`    deleted ${del.deletedCount} wrong-era NG part(y/ies)`);
  }
  await seedNGParties(db, log, preset);
  await seedNGStatePartyOrg(db, true, log, preset);
  await seedNGStateMetrics(db, true, log, preset);
  await seedNGGovernors(db, true, log, preset);
  await seedNGWiki(db);
  console.log("Done. NG seed data re-aligned to the branch.");

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
