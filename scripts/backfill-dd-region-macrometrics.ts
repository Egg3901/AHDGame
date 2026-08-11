/**
 * Backfill: restore the GDR's own economy rows in `macroMetrics`.
 *
 * `seedDEStateMetrics` used to write the modern 16-Land `deStateMetrics` bundle
 * for every preset, including the divided-Germany ones. `macroMetrics` is keyed
 * by the bare region code with no country namespace, so West Germany's rows for
 * BB, MV, SN, ST and TH landed on top of East Germany's and won. DD kept only
 * BEO and dd_national; its other five regions ran West German income, growth and
 * a flat West German urbanization default.
 *
 * The seeder is fixed, but a fix to the seeder does not repair a world that has
 * already been seeded. This script repairs one in place, without a reseed. It
 * rewrites those five rows from `ddStateMetrics1953` through the same
 * `writeSplitMetrics` path the seeder uses, so the result is identical to what a
 * corrected reseed would produce.
 *
 * Scope is deliberately narrow: it only touches regions whose `states` doc says
 * `countryId: "DD"` while their `macroMetrics` doc says something else. A world
 * that was seeded correctly is a no-op.
 *
 * Operates on the database pointed to by MONGODB_URI in .env.local — point it at
 * the intended environment before running. Dry-run by default; idempotent.
 *
 * Usage:
 *   npx tsx scripts/backfill-dd-region-macrometrics.ts            # dry run
 *   npx tsx scripts/backfill-dd-region-macrometrics.ts --apply    # write changes
 */

import { connectDb, closeDb } from "./utils/db";
import { writeSplitMetrics } from "../src/lib/macroMetrics/split";
import { ddStateMetrics1953 } from "../src/lib/seeds/dd/ddStateMetrics1953";
import type { StateMetrics } from "../src/lib/db/types";

const apply = process.argv.includes("--apply");

async function main() {
  const db = await connectDb();

  const ddStates = await db
    .collection<{ _id: string; name?: string }>("states")
    .find({ countryId: "DD" }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const ddRegionIds = new Set(ddStates.map((s) => String(s._id)));
  console.log(`DD owns ${ddRegionIds.size} regions: ${[...ddRegionIds].join(", ")}`);

  const macroRows = await db
    .collection<{ _id: string; countryId?: string }>("macroMetrics")
    .find({ _id: { $in: [...ddRegionIds] as never[] } }, { projection: { _id: 1, countryId: 1 } })
    .toArray();
  const ownerByRegion = new Map(macroRows.map((r) => [String(r._id), r.countryId]));

  const hijacked = [...ddRegionIds].filter((id) => ownerByRegion.get(id) !== "DD");
  const missing = [...ddRegionIds].filter((id) => !ownerByRegion.has(id));

  if (hijacked.length === 0) {
    console.log("Nothing to do: every DD region already owns its own macroMetrics row.");
    await closeDb();
    return;
  }

  console.log(
    `\n${hijacked.length} DD region(s) have a macroMetrics row owned by another country:`
  );
  for (const id of hijacked) {
    console.log(`  ${id}: macroMetrics.countryId = ${ownerByRegion.get(id) ?? "(absent)"}`);
  }
  if (missing.length > 0)
    console.log(`  (${missing.length} absent entirely: ${missing.join(", ")})`);

  const authoredById = new Map(ddStateMetrics1953.map((m) => [String(m._id), m]));
  const repairable = hijacked.filter((id) => authoredById.has(id));
  const unauthored = hijacked.filter((id) => !authoredById.has(id));
  if (unauthored.length > 0) {
    console.warn(
      `\n⚠ No authored 1953 metrics for: ${unauthored.join(", ")} — left untouched, seed them first.`
    );
  }

  console.log(`\n${apply ? "Rewriting" : "Would rewrite"} ${repairable.length} row(s):`);
  for (const id of repairable) {
    const authored = authoredById.get(id)!;
    const income = authored.economic?.medianIncome?.value;
    const growth = authored.economic?.gdpGrowth?.value;
    console.log(`  ${id} -> DD (medianIncome ${income}, gdpGrowth ${growth})`);
    if (apply) {
      await writeSplitMetrics(db, { ...authored, countryId: "DD" } as StateMetrics);
    }
  }

  console.log(
    apply
      ? `\nDone. ${repairable.length} region(s) restored to DD.`
      : `\nDry run. Re-run with --apply to write.`
  );
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
