/**
 * D13 ROLLBACK DRILL — restore every corporate sector's nameplate `revenue`
 * from its `legacyRevenueShadow` capital-mode restore point.
 *
 * SKELETON. NOT RUN. This is the escape hatch for one specific emergency:
 * plants ships, misbehaves, and `marketSystemMode` has to be flipped back down
 * to "capital". That flip alone is NOT a rollback — under plants the turn
 * processor restates `revenue` from plant output instead of compounding it, so
 * capital mode would resume compounding from a plants-derived number and
 * silently rebase every corp's income forever. `sectorTurn` writes
 * `legacyRevenueShadow` every plants turn precisely so this script can exist;
 * see `src/lib/corporations/capitalModeRollback.ts` for the decision logic,
 * which is pure and unit-tested separately from this IO wrapper.
 *
 * ORDER OF OPERATIONS in a real rollback:
 *   1. Pause turns.
 *   2. Run this with --dry-run and read the `noShadow` count. Those sectors
 *      have no restore point (created after the flip, or never ran a plants
 *      turn) and are left alone — a human decides what they should be.
 *   3. Flip `marketSystemMode` down to "capital".
 *   4. Run this for real.
 *   5. Resume turns.
 *
 * Running it while `marketSystemMode` is still >= "plants" is pointless: the
 * next turn overwrites `revenue` from plant output again. The script refuses
 * unless --force is passed, so a mistimed run cannot half-apply.
 *
 * Idempotent: `restoreCapitalModeFromShadow` unsets the shadow it consumed, so
 * a second run reports every sector as `noShadow` and writes nothing.
 *
 * ── THE DRILL (D13) ─────────────────────────────────────────────────────────
 *
 * A rollback you have never rehearsed is not a rollback, it is a hope. Run the
 * drill on a schedule while the world is soaking, NOT for the first time
 * during the incident that needs it. The drill is entirely read-only and safe
 * to run against prod at any time, mid-turn included.
 *
 *   Step 1 — PROVE THE RESTORE POINTS EXIST.
 *
 *     npx tsx scripts/migrations/restoreCapitalModeFromShadow.ts --verify
 *
 *     This writes nothing and does not care what mode the world is in. It
 *     answers two separate questions that are easy to confuse:
 *
 *       (a) Is the rollback LOSSLESS? — i.e. does every sector have a finite,
 *           non-negative `legacyRevenueShadow` to go back to. A sector without
 *           one cannot be rolled back at all: its revenue stays at the
 *           plants-derived value and capital mode compounds forward from there,
 *           permanently rebasing that corp's income. Any such sector is a
 *           human decision, and the drill exists to find them EARLY, while
 *           there is time to decide, rather than at 3am with turns paused.
 *
 *       (b) What would the rollback COST? — every sector whose live revenue has
 *           moved away from its shadow has diverged because it built (or lost)
 *           real capacity while in plants. Rolling back DISCARDS that. This is
 *           expected — it is what a rollback means — but the operator has to
 *           see the magnitude before they agree to it. The verify report gives
 *           the aggregate, the net, the worst sectors, and the per-sector
 *           percentage.
 *
 *     Read `lossless: true` as "every sector CAN be restored", never as "the
 *     rollback is free".
 *
 *   Step 2 — REHEARSE THE WRITE.  `--dry-run` (see below). Confirms the
 *     mutation set matches what --verify predicted.
 *
 *   Step 3 — For a real rollback, follow the ORDER OF OPERATIONS above:
 *     pause turns → verify → flip mode down to "capital" → apply → resume.
 *
 * A drill that reports a growing `withoutRestorePoint` count over successive
 * runs means new sectors are being created without ever taking a plants turn,
 * or the shadow write is failing for some cohort. Investigate before it grows.
 *
 * Usage:
 *   MONGODB_URI=...&directConnection=true npx tsx scripts/migrations/restoreCapitalModeFromShadow.ts --verify
 *   ... --dry-run     # rehearse the write, no mutation
 *   ... (no flag)     # apply
 *   ... --force       # apply even while the world is still in plants mode
 *
 * Exit code is 1 when --verify finds sectors with no restore point, so the
 * drill can be wired into a scheduled check.
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import {
  restoreCapitalModeFromShadow,
  CAPITAL_MODE_ROLLBACK_UNSET_FIELDS,
} from "../../src/lib/corporations/capitalModeRollback";
import { getMarketSystemModeForDb, marketAtLeast } from "../../src/lib/market/featureFlag";
import type { CorporateSector } from "../../src/lib/db/types/corporation";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";
import {
  verifyPlantsRollback,
  type PlantsRollbackVerifyReport,
  type PlantsRollbackVerifySectorInput,
} from "../../src/lib/market/plantsTransition";
import { streamAnchoredSectors } from "../ops/plantsDbReaders";

const MARKER_ID = "2026-08-01-restore-capital-mode-from-shadow";
const BATCH_SIZE = 500;

export async function runRestoreCapitalModeFromShadow(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> & { force?: boolean } = { dryRun: false }
): Promise<MigrationResult> {
  const { dryRun, force = false } = opts;

  // Guard: a rollback applied while plants is still authoritative is undone by
  // the very next turn. The switch lives in `gameConfig` under `{_id:"default"}`
  // — NOT in `gameState`, which has no such field. Reading the wrong collection
  // resolved `mode` to the default on every world, so this refusal (the only
  // interlock against a mistimed, half-applied rollback) never fired and the
  // operator note below printed a mode the world was not in. Compared with
  // `marketAtLeast` rather than `===` so any future tier ABOVE plants — which
  // also restates `revenue` from plant output — trips the same guard.
  const mode = await getMarketSystemModeForDb(db);
  if (marketAtLeast(mode, "plants") && !force) {
    throw new Error(
      `[${MARKER_ID}] marketSystemMode is still "${mode}" — flip it down to "capital" first, or pass --force. ` +
        `Restoring now would be overwritten by the next turn.`
    );
  }

  const cursor = db
    .collection<CorporateSector>("corporateSectors")
    .find({ legacyRevenueShadow: { $exists: true } });

  let scanned = 0;
  let restored = 0;
  let noShadow = 0;
  let alreadyEqual = 0;
  // The whole `$set`, not just `revenue`: a rollback also puts back the growth
  // rates plants zeroed (see CapitalModeRollbackMutation).
  let batch: { id: CorporateSector["_id"]; set: Record<string, number> }[] = [];

  const unsetDoc = Object.fromEntries(CAPITAL_MODE_ROLLBACK_UNSET_FIELDS.map((f) => [f, ""]));

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await Promise.all(
        batch.map(({ id, set }) =>
          db
            .collection("corporateSectors")
            .updateOne({ _id: id }, { $set: { ...set, updatedAt: new Date() }, $unset: unsetDoc })
        )
      );
    }
    restored += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    scanned++;
    const { mutation, skipReason } = restoreCapitalModeFromShadow(doc);
    if (!mutation) {
      if (skipReason === "no-shadow") noShadow++;
      else alreadyEqual++;
      continue;
    }
    batch.push({ id: doc._id, set: mutation.set });
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  // Sectors with no shadow at all never matched the cursor filter; count them
  // separately so the operator sees the real size of the manual-decision set.
  const withoutShadow = await db
    .collection<CorporateSector>("corporateSectors")
    .countDocuments({ legacyRevenueShadow: { $exists: false } });

  const notes = [
    `marketSystemMode at run time: "${mode}"${force ? " (--force)" : ""}`,
    `${scanned} sectors with a restore point scanned`,
    `${restored} ${dryRun ? "would be restored" : "restored"} to legacyRevenueShadow`,
    `${alreadyEqual} already equal to their shadow (no write needed)`,
    `${noShadow} had a corrupt/absent shadow on a matched doc`,
    `${withoutShadow} sectors have NO restore point at all — left untouched, need a human decision`,
  ];

  return {
    documentsScanned: scanned + withoutShadow,
    documentsUpdated: dryRun ? 0 : restored,
    notes,
  };
}

/**
 * D13 --verify: prove, without writing, what a rollback would and would not
 * recover.
 *
 * Deliberately does NOT check `marketSystemMode`. The refusal guard on the
 * apply path exists because a mistimed WRITE is destructive; a read is not,
 * and the whole value of the drill is being able to run it on the live plants
 * world, repeatedly, while it soaks. Refusing to verify while in plants would
 * mean the drill could only be run when it was no longer useful.
 *
 * The FX conversion matters here: `revenue` and `legacyRevenueShadow` are both
 * stored in the sector's host currency, so comparing them needs no conversion
 * at all — but reporting the AGGREGATE across a multi-currency world does.
 * Divergence totals are therefore accumulated in ₳.
 */
async function runVerify(db: Db): Promise<PlantsRollbackVerifyReport> {
  const rows: PlantsRollbackVerifySectorInput[] = [];
  await streamAnchoredSectors(db, (row) => {
    rows.push({
      id: row.id,
      corporationId: row.corporationId,
      revenueAnchor: row.revenueAnchor,
      legacyRevenueShadowAnchor: row.legacyRevenueShadowAnchor,
      capitalStock: row.capitalStock,
      plantsStartTurn: row.plantsStartTurn,
    });
  });
  return verifyPlantsRollback(rows);
}

function printVerify(report: PlantsRollbackVerifyReport, mode: string): void {
  const rule = "─".repeat(78);
  console.log(rule);
  console.log(`D13 ROLLBACK VERIFY — read only. World mode: "${mode}".`);
  console.log(rule);
  console.log(`LOSSLESS: ${report.lossless ? "YES" : "NO"}`);
  console.log(`  sectors scanned            ${report.scanned}`);
  console.log(`  with a restore point       ${report.withRestorePoint}`);
  console.log(`  WITHOUT a restore point    ${report.withoutRestorePoint}`);
  console.log(`  never took a plants turn   ${report.neverMigrated}`);
  console.log("");
  console.log("WHAT A ROLLBACK WOULD DISCARD (divergence from the shadow)");
  console.log(`  diverged sectors           ${report.divergence.sectors}`);
  console.log(`  gross divergence           ₳${report.divergence.totalAbsAnchor.toFixed(2)}`);
  console.log(`  net divergence             ₳${report.divergence.netAnchor.toFixed(2)}`);
  console.log(`  largest single sector      ₳${report.divergence.maxAbsAnchor.toFixed(2)}`);

  if (report.divergence.worst.length > 0) {
    console.log("");
    console.log("  worst divergences:");
    for (const d of report.divergence.worst) {
      console.log(
        `    ${d.id}  corp=${d.corporationId ?? "-"}  ` +
          `₳${d.revenueAnchor.toFixed(2)} vs shadow ₳${(d.shadowAnchor ?? 0).toFixed(2)}  ` +
          `(${(d.divergencePct * 100).toFixed(1)}%)`
      );
    }
  }

  if (report.unrecoverable.length > 0) {
    console.log("");
    console.log("  sectors with NO restore point (a human must decide each):");
    for (const u of report.unrecoverable) {
      console.log(
        `    ${u.id}  corp=${u.corporationId ?? "-"}  revenue ₳${u.revenueAnchor.toFixed(2)}`
      );
    }
  }

  console.log("");
  for (const note of report.notes) console.log(`  · ${note}`);
  console.log(rule);
}

async function main() {
  const force = process.argv.includes("--force");
  const dryRun = process.argv.includes("--dry-run");
  const verify = process.argv.includes("--verify");

  if (verify) {
    const db = await connectDb();
    try {
      const mode = await getMarketSystemModeForDb(db);
      const report = await runVerify(db);
      printVerify(report, mode);
      process.exitCode = report.lossless ? 0 : 1;
    } finally {
      await closeDb();
    }
    return;
  }

  const db = await connectDb();
  try {
    const result = await runRestoreCapitalModeFromShadow(db, { dryRun, force });
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
