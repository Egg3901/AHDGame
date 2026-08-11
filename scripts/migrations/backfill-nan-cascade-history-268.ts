/**
 * Backfill turns 269-275 in every per-turn snapshot collection by flat-copying
 * turn-268 rows (last known good). Each backfilled row is marked
 * `healed: true` with `healedReason: "nan-cascade-turn-269"` so charts can
 * optionally distinguish recovered data.
 *
 * Does NOT touch:
 *   - corporationHistory (already deleted by heal-nan-cascade-turn-269.ts)
 *   - corporationPortfolioHistory (already deleted by the same)
 *   - stateMetrics / national metrics (recomputed automatically next turn)
 *   - upserted per-exchange stockExchangeSnapshots (delete so next turn
 *     regenerates cleanly — they don't have turn-268 rows to copy)
 *
 * This script ALSO backfills the two collections the earlier heal deleted
 * (corporationHistory, corporationPortfolioHistory) so player-facing charts
 * don't show a 7-turn hole.
 *
 * Dry-run by default. Pass `--apply` to write.
 */
import { connectDb, closeDb } from "../utils/db";

const RESTORE_TURN = 268;
const BACKFILL_START = 269;
const BACKFILL_END = 275;
const MIGRATION_ID = "backfill-nan-cascade-history-268";
const HEAL_REASON = "nan-cascade-turn-269";

const PER_TURN_COLLECTIONS = [
  "corporationHistory",
  "corporationPortfolioHistory",
  "marketCapHistory",
  "wealthListHistory",
  "portfolioHistory",
] as const;

const UPSERT_COLLECTIONS = [
  "stockExchangeSnapshots", // _id is exchange name — delete so next turn rewrites
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await connectDb();

  console.log(`[backfill] mode = ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`[backfill] copying turn ${RESTORE_TURN} → turns ${BACKFILL_START}..${BACKFILL_END}`);

  // migrationsRun uses string _ids, not ObjectIds — override the type.
  const migrationsRun = db.collection<{ _id: string }>("migrationsRun");
  const existing = await migrationsRun.findOne({ _id: MIGRATION_ID });
  if (existing) {
    console.log(`[backfill] already stamped: ${JSON.stringify(existing)}`);
    if (apply) {
      console.log(`[backfill] refusing to re-apply`);
      await closeDb();
      return;
    }
  }

  const totals: Record<string, { deleted: number; inserted: number; baseline: number }> = {};

  for (const colName of PER_TURN_COLLECTIONS) {
    const col = db.collection(colName);
    const baseline = await col.find({ turn: RESTORE_TURN }).toArray();
    console.log(`\n[backfill] ${colName}: turn-${RESTORE_TURN} baseline rows = ${baseline.length}`);
    if (baseline.length === 0) {
      console.log(`[backfill] ${colName}: nothing to copy, skipping`);
      totals[colName] = { deleted: 0, inserted: 0, baseline: 0 };
      continue;
    }

    const existingBadCount = await col.countDocuments({
      turn: { $gte: BACKFILL_START, $lte: BACKFILL_END },
    });
    console.log(
      `[backfill] ${colName}: rows in turns ${BACKFILL_START}..${BACKFILL_END} to delete = ${existingBadCount}`
    );

    let deleted = 0;
    let inserted = 0;
    if (apply) {
      if (existingBadCount > 0) {
        const del = await col.deleteMany({
          turn: { $gte: BACKFILL_START, $lte: BACKFILL_END },
        });
        deleted = del.deletedCount;
      }
      const rowsToInsert: unknown[] = [];
      for (let t = BACKFILL_START; t <= BACKFILL_END; t++) {
        for (const src of baseline) {
          // Clone + strip _id so Mongo assigns a fresh one per inserted row.
          const { _id: _drop, ...rest } = src as Record<string, unknown>;
          void _drop;
          rowsToInsert.push({
            ...rest,
            turn: t,
            createdAt: new Date(),
            healed: true,
            healedReason: HEAL_REASON,
          });
        }
      }
      if (rowsToInsert.length > 0) {
        const ins = await col.insertMany(rowsToInsert as never[]);
        inserted = ins.insertedCount;
      }
    } else {
      inserted = baseline.length * (BACKFILL_END - BACKFILL_START + 1);
    }
    console.log(`[backfill] ${colName}: deleted=${deleted} inserted=${inserted}`);
    totals[colName] = { deleted, inserted, baseline: baseline.length };
  }

  // Upserted (per-entity-id) snapshots — delete so next turn regenerates.
  for (const colName of UPSERT_COLLECTIONS) {
    const col = db.collection(colName);
    const count = await col.countDocuments({});
    console.log(
      `\n[backfill] ${colName}: stale upsert rows to delete = ${count} (will regenerate on next turn)`
    );
    let deleted = 0;
    if (apply && count > 0) {
      const del = await col.deleteMany({});
      deleted = del.deletedCount;
    }
    console.log(`[backfill] ${colName}: deleted=${deleted}`);
    totals[colName] = { deleted, inserted: 0, baseline: 0 };
  }

  if (apply) {
    await migrationsRun.updateOne(
      { _id: MIGRATION_ID },
      {
        $set: {
          _id: MIGRATION_ID,
          completedAt: new Date(),
          totals,
        },
      },
      { upsert: true }
    );
    console.log(`\n[backfill] migration stamped as ${MIGRATION_ID}`);
  }

  await closeDb();
}

main().catch((e) => {
  console.error("[backfill] failed:", e);
  process.exit(1);
});
