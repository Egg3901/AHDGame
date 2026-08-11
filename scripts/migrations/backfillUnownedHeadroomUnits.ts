/**
 * One-time migration: backfill `unownedSectors.headroomUnits` — the derived
 * units-of-unmet-demand implied by each unowned sector's `revenue`.
 *
 * P1 of the "buildable sectors" plan (see ops-knowledge design doc). Unowned
 * sectors currently hold one economic field, `revenue` (₳-native — unlike
 * CorporateSector.revenue, which is host-local; unowned sectors have no
 * owning corp so there is no host-currency relationship to preserve). A
 * later phase reinterprets unowned sectors as demand-side "market headroom"
 * measured in commodity units instead of ₳ revenue. This migration only
 * populates the derived field — TELEMETRY/GROUNDWORK ONLY. No runtime system
 * reads `headroomUnits` yet, and this migration changes no behavior.
 *
 * Conversion: headroomUnits = Σ_c revenue × supplyRate_c / basePrice_c, using
 * the sector type's DEFAULT strategy ("standard") supply mix from
 * SECTOR_STRATEGIES (src/lib/constants/sectorStrategies.ts) and
 * COMMODITY_BASE_PRICES (src/lib/constants/commodities.ts). This is exactly
 * `computeUnownedHeadroomUnits` (src/lib/market/unownedHeadroom.ts), which
 * itself reuses `impliedOutputUnits` (src/lib/market/capital.ts) so the unit
 * basis matches corp-side capacity units exactly.
 *
 * Idempotent: skips any doc where `headroomUnits` is already a finite number,
 * unless `--force` is passed (recompute and overwrite all docs). Safe to
 * re-run — every row's target value is a pure function of `revenue` and
 * `sectorType`, so re-running without `--force` is a no-op, and re-running
 * WITH `--force` simply recomputes the same deterministic value (unless
 * `revenue` changed between runs, which is expected and fine — this backfill
 * is not meant to be re-run against a live, actively-turning world; take the
 * same "pause turns" precaution as sectorToHostCurrency.ts).
 *
 * Usage:
 *   MONGODB_URI=...&directConnection=true npx tsx scripts/migrations/backfillUnownedHeadroomUnits.ts
 *   ... --dry-run     # report counts only, no writes
 *   ... --force       # recompute/overwrite docs that already have headroomUnits
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { computeUnownedHeadroomUnits } from "../../src/lib/market/unownedHeadroom";
import { loadWorldEraUnitScale } from "../../src/lib/currency/gdpAnchorRate";
import type { UnownedSector } from "../../src/lib/db/types/unownedSector";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";

const MARKER_ID = "backfill-unowned-headroom-units";
const BATCH_SIZE = 500;

export async function runBackfillUnownedHeadroomUnits(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> & { force?: boolean } = { dryRun: false }
): Promise<MigrationResult> {
  const { dryRun, force = false } = opts;

  const filter = force ? {} : { headroomUnits: { $exists: false } };
  const cursor = db.collection<UnownedSector>("unownedSectors").find(filter);

  const eraUnitScale = await loadWorldEraUnitScale(db);
  let scanned = 0;
  let updated = 0;
  let skippedZeroOrInvalid = 0;
  let batch: { id: UnownedSector["_id"]; headroomUnits: number }[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await Promise.all(
        batch.map(({ id, headroomUnits }) =>
          db.collection("unownedSectors").updateOne({ _id: id }, { $set: { headroomUnits } })
        )
      );
    }
    updated += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    scanned++;
    const headroomUnits = computeUnownedHeadroomUnits(doc.sectorType, doc.revenue, eraUnitScale);
    if (!(headroomUnits > 0)) {
      skippedZeroOrInvalid++;
      continue;
    }
    batch.push({ id: doc._id, headroomUnits: Math.round(headroomUnits * 100) / 100 });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  const notes = [
    `${scanned} unowned sectors scanned (filter: ${force ? "all docs (--force)" : "missing headroomUnits only"})`,
    `${updated} ${dryRun ? "would be updated" : "updated"}`,
    `${skippedZeroOrInvalid} skipped (zero/invalid revenue or unresolved strategy)`,
  ];

  return {
    documentsScanned: scanned,
    documentsUpdated: dryRun ? 0 : updated,
    notes,
  };
}

async function main() {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");

  const db = await connectDb();
  try {
    if (!force) {
      const marker = await db
        .collection<{ _id: string; completedAt: Date }>("migrationsRun")
        .findOne({ _id: MARKER_ID });
      if (marker) {
        console.log(`[${MARKER_ID}] already ran at ${marker.completedAt}. Exiting.`);
        return;
      }
    }

    const result = await runBackfillUnownedHeadroomUnits(db, { dryRun, force });
    console.log(`[${MARKER_ID}] ${dryRun ? "DRY RUN " : ""}complete:`);
    for (const note of result.notes ?? []) console.log(`  · ${note}`);

    if (!dryRun) {
      await db
        .collection<{ _id: string; completedAt: Date; result: MigrationResult }>("migrationsRun")
        .updateOne(
          { _id: MARKER_ID },
          { $set: { _id: MARKER_ID, completedAt: new Date(), result } },
          { upsert: true }
        );
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
