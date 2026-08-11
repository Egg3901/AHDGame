/**
 * Deploy migration for ticket #1014 — ensure Eastern-bloc / USSR command
 * countries have one SOE (with plants capacity) per sector type, then drain
 * phantom unowned headroom pools.
 *
 * Usage:
 *   npx tsx scripts/migrations/reconcileCommandEconomyUnowned.ts
 *   npx tsx scripts/migrations/reconcileCommandEconomyUnowned.ts --dry-run
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { reconcileCommandEconomyUnowned } from "../../src/lib/admin/seed/reconcileCommandEconomyUnowned";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";

export async function runReconcileCommandEconomyUnowned(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> = { dryRun: false }
): Promise<MigrationResult> {
  const result = await reconcileCommandEconomyUnowned(db, {
    dryRun: opts.dryRun,
    log: (msg) => console.log(msg),
  });
  return {
    documentsScanned: result.sectorsUpserted,
    documentsInserted: result.soesCreated,
    documentsUpdated: result.soesReused,
    documentsDeleted: result.unownedDeleted,
    notes: [
      `commandCountries=${result.commandCountries.join(",") || "(none)"}`,
      `soesCreated=${result.soesCreated}`,
      `soesReused=${result.soesReused}`,
      `sectorsUpserted=${result.sectorsUpserted}`,
      `unownedDeleted=${result.unownedDeleted}`,
    ],
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const result = await runReconcileCommandEconomyUnowned(db, { dryRun });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
