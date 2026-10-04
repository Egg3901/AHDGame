import { migration as bankFailurePoliticsIndex } from "./entries/2026-10-04-bank-failure-politics-index";
import type { Db } from "mongodb";
import { migration as bankPropForexFeeIndex } from "./entries/2026-10-04-bank-prop-forex-fee-index";
import { migration as repairOrphanIndexFundState } from "./entries/2026-09-03-repair-orphan-index-fund-state";
import { migration as equityMarketPools } from "./entries/2026-09-03-equity-market-pools";
import { migration as providerIdentityIndexes } from "./entries/2026-09-10-provider-identity-indexes";
import { migration as centralBankPricingPhaseIn } from "./entries/2026-09-11-central-bank-pricing-phase-in";
import { migration as longHorizonTelemetryIndexes } from "./entries/2026-09-30-long-horizon-telemetry-indexes";
import { migration as appleProviderIdentityIndex } from "./entries/2026-09-30-apple-provider-identity-index";
import { migration as ukDualMinistryRoleSlot } from "./entries/2026-09-17-uk-dual-ministry-role-slot";
import { migration as politicalMediaOrderIndexes } from "./entries/2026-10-04-political-media-order-indexes";
import { migration as bankTreasuryTradeIndexes } from "./entries/2026-10-04-bank-treasury-trade-indexes";
import { migration as industryModelMarketIndexes } from "./entries/2026-10-04-industry-model-market-indexes";
import { migration as constructionServiceLeaseIndex } from "./entries/2026-10-04-construction-service-lease-index";
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
export const REQUIRED_STARTUP_MIGRATIONS: readonly Migration[] = [
  equityMarketPools,
  repairOrphanIndexFundState,
  providerIdentityIndexes,
  centralBankPricingPhaseIn,
  // #2688: without these, every per-turn telemetry upsert scans its collection,
  // a cost that grows each turn until the index exists.
  longHorizonTelemetryIndexes,
  // Sign in with Apple writes `appleId`; its unique index must exist before
  // the first Apple login can race a duplicate account into existence.
  appleProviderIdentityIndex,
  // #2049 (player ticket 1368): the UK appoint path allows a departmental minister to take
  // a central title, but the legacy one-seat-per-character unique index
  // rejects that insert until this swap runs, so the DPM appointment failed
  // with a spurious conflict error on worlds that never ran it.
  ukDualMinistryRoleSlot,
  // Existing saves need the political journal indexes before current-turn replay reads.
  politicalMediaOrderIndexes,
  bankTreasuryTradeIndexes,
  bankPropForexFeeIndex,
  bankFailurePoliticsIndex,
  // Model-aware unique keys must be in place before a fresh canonical seed can
  // create a vehicles market beside generic manufacturing.
  industryModelMarketIndexes,
  constructionServiceLeaseIndex,
];

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
