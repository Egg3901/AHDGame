import type { Db } from "mongodb";
import { migration as repairOrphanIndexFundState } from "./entries/2026-09-03-repair-orphan-index-fund-state";
import { runMigrations, type RunSummary } from "./runner";
import type { Migration } from "./types";

/**
 * Small, audited allowlist of migrations that must accompany application boot.
 *
 * The full registry contains historical and operational migrations that are
 * intentionally run through `npm run migrate`; importing that registry here
 * would turn every web restart into an unreviewed full migration pass. Keep
 * this list limited to idempotent repairs whose code and data change cannot be
 * safely separated during a deploy.
 */
export const REQUIRED_STARTUP_MIGRATIONS: readonly Migration[] = [repairOrphanIndexFundState];

export async function runRequiredStartupMigrations(db: Db): Promise<RunSummary> {
  const unsafe = REQUIRED_STARTUP_MIGRATIONS.find((migration) => !migration.idempotent);
  if (unsafe) {
    throw new Error(`Startup migration must be idempotent: ${unsafe.id}`);
  }

  return runMigrations(db, {
    migrations: [...REQUIRED_STARTUP_MIGRATIONS],
    dryRun: false,
  });
}
