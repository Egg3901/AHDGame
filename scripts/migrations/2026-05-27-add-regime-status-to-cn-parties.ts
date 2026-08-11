/**
 * Migration: Backfill `regimeStatus` on CN political parties.
 *
 * Phase 1 of the one-party-state refactor introduces a per-party
 * `regimeStatus` field. Fresh seeds (via `seedCN.ts` / `ensureDefaultParties.ts`)
 * carry the field; this migration backfills existing CN parties on
 * already-seeded databases.
 *
 * Mapping (by sequentialId, set in `src/lib/seeds/cn/cnParties.ts`):
 *   1 -> "ruling"    (CCP)
 *   2 -> "approved"  (CDL)
 *   3 -> "approved"  (CNDCA)
 *
 * Non-CN parties are not touched (query is scoped). CN parties already
 * carrying any non-null `regimeStatus` (admin overrides, future custom
 * rollouts) are skipped. CN parties with unrecognised sequentialIds are
 * also skipped — operator can inspect manually rather than guessing.
 *
 * Usage: npx tsx scripts/migrations/2026-05-27-add-regime-status-to-cn-parties.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

type RegimeStatus = "ruling" | "approved" | "banned";

const CN_REGIME_MAPPING: Record<number, RegimeStatus> = {
  1: "ruling",
  2: "approved",
  3: "approved",
};

export interface BackfillResult {
  scanned: number;
  modified: number;
  skipped: number;
}

interface CnPartyDoc {
  _id: unknown;
  sequentialId: number;
  regimeStatus?: RegimeStatus | null;
}

/**
 * Pure migration logic. Exported so the test suite can drive it against a
 * MockDb without parsing CLI args or touching env vars.
 */
export async function applyRegimeStatusBackfill(db: Db): Promise<BackfillResult> {
  let scanned = 0;
  let modified = 0;
  let skipped = 0;

  const cnParties = await db
    .collection<CnPartyDoc>("politicalParties")
    .find({ countryId: "CN" })
    .toArray();

  for (const party of cnParties) {
    scanned++;

    // Skip parties that already have a non-null regimeStatus.
    if (party.regimeStatus != null) {
      skipped++;
      continue;
    }

    const targetStatus = CN_REGIME_MAPPING[party.sequentialId];
    if (!targetStatus) {
      // CN party with an unrecognised sequentialId — leave alone rather
      // than guessing. Operator can inspect manually.
      skipped++;
      continue;
    }

    await db
      .collection("politicalParties")
      .updateOne(
        { _id: party._id },
        { $set: { regimeStatus: targetStatus, updatedAt: new Date() } }
      );
    modified++;
  }

  return { scanned, modified, skipped };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  if (dryRun) {
    const cnParties = await db
      .collection<CnPartyDoc>("politicalParties")
      .find({ countryId: "CN" })
      .toArray();
    const needsUpdate = cnParties.filter((p) => p.regimeStatus == null);
    console.log(
      `[DRY RUN] Found ${cnParties.length} CN parties; ${needsUpdate.length} need update:`
    );
    for (const p of needsUpdate) {
      const target = CN_REGIME_MAPPING[p.sequentialId];
      console.log(`  - seq=${p.sequentialId} -> ${target ?? "SKIP (unrecognised sequentialId)"}`);
    }
    await closeDb();
    return;
  }

  const result = await applyRegimeStatusBackfill(db);
  console.log(
    `Done. scanned=${result.scanned}, modified=${result.modified}, skipped=${result.skipped}`
  );
  await closeDb();
}

// Only run main when invoked directly via `npx tsx ...`; the test suite
// imports `applyRegimeStatusBackfill` without triggering this block.
if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
