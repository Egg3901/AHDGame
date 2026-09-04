import type { Db } from "mongodb";
import { seedCoreIndexes } from "./indexes/core";
import { seedActivityIndexes } from "./indexes/activity";
import { seedCabinetIndexes } from "./indexes/cabinet";
import { seedPerfIndexes } from "./indexes/performance";
import { seedSlowQueryIndexes } from "./indexes/slowQuery";
import { seedSearchIndexes } from "./indexes/search";
import { seedInternationalOrganizationIndexes } from "./indexes/internationalOrganizations";
import { seedWriteGuardIndexes } from "./indexes/writeGuards";
import { seedPartyNppReworkIndexes } from "./indexes/partyNppRework";
import { seedSovereignDefaultIndexes } from "./indexes/sovereignDefault";
import { seedObservabilityIndexes } from "./indexes/observability";
import { seedFinancialTxLogIndexes } from "./indexes/financialTxLog";
import { seedLedgerIndexes } from "./indexes/ledger";
import { seedCommodityPriceIndexes } from "./indexes/commodityPrices";
import { seedIndexFundIndexes } from "./indexes/indexFunds";
import { seedApiAccessIndexes } from "./indexes/apiAccess";
import { seedCrisisInteractionIndexes } from "./indexes/crisisInteractions";
import { seedCrisisIndexes } from "./indexes/crises";
import { seedActionAuditLogIndexes } from "./indexes/actionAuditLog";
import { seedAltDetectionIndexes } from "./indexes/altDetection";
import { seedAuditAnomaliesIndexes } from "./indexes/auditAnomalies";
import { seedWatchlistIndexes } from "./indexes/watchlist";
import { seedConflictIndexes } from "./indexes/conflicts";
import { seedNavairIndexes } from "./indexes/navair";
import { seedBankingIndexes } from "./indexes/banking";
import { seedSettlementIndexes } from "./indexes/settlement";
import { seedIntelligenceIndexes } from "./indexes/intelligence";
import { INDEX_TARGETS, type IndexTargetId, type IndexTargetMeta } from "./indexTargets";

export { INDEX_TARGETS, INDEX_TARGET_IDS } from "./indexTargets";
export type { IndexTargetId, IndexTargetMeta } from "./indexTargets";

// Barrel that runs every index module in sequence. Bootstrap calls this directly;
// the admin seeder route dispatches the individual module targets so admins can
// re-run a single group from the Universal Seeder UI.
//
// Phase 4 of the reset/seed cleanup absorbed the standalone `add-*-indexes.ts`
// migration scripts into the modules below. The legacy scripts still work but
// become no-ops once these have run from bootstrap.
type IndexModule = (db: Db, log: (msg: string) => void) => Promise<unknown>;

/**
 * Target id → the function that builds those indexes.
 *
 * A `Record` over `IndexTargetId`, deliberately: registering a target in
 * `indexTargets.ts` without wiring its runner here is a COMPILE ERROR, not a
 * module that silently never runs. That is the whole fix for the drift
 * documented in that file.
 */
const INDEX_RUNNERS: Record<IndexTargetId, IndexModule> = {
  indexesCore: seedCoreIndexes,
  indexesActivity: seedActivityIndexes,
  indexesCabinet: seedCabinetIndexes,
  indexesPerf: seedPerfIndexes,
  indexesSlowQuery: seedSlowQueryIndexes,
  indexesSearch: seedSearchIndexes,
  indexesInternationalOrganizations: seedInternationalOrganizationIndexes,
  indexesWriteGuards: seedWriteGuardIndexes,
  indexesPartyNppRework: seedPartyNppReworkIndexes,
  indexesSovereignDefault: seedSovereignDefaultIndexes,
  indexesObservability: seedObservabilityIndexes,
  indexesFinancialTxLog: seedFinancialTxLogIndexes,
  indexesLedger: seedLedgerIndexes,
  indexesCommodityPrices: seedCommodityPriceIndexes,
  indexesIndexFunds: seedIndexFundIndexes,
  indexesApiAccess: seedApiAccessIndexes,
  indexesCrisisInteractions: seedCrisisInteractionIndexes,
  indexesCrises: seedCrisisIndexes,
  indexesActionAuditLog: seedActionAuditLogIndexes,
  indexesAltDetection: seedAltDetectionIndexes,
  indexesAuditAnomalies: seedAuditAnomaliesIndexes,
  indexesWatchlist: seedWatchlistIndexes,
  indexesConflict: seedConflictIndexes,
  indexesNavair: seedNavairIndexes,
  indexesBanking: seedBankingIndexes,
  indexesSettlement: seedSettlementIndexes,
  indexesIntelligence: seedIntelligenceIndexes,
};

export interface IndexModuleEntry extends Omit<IndexTargetMeta, "id"> {
  /** Narrowed to the literal union, so callers can use it as a seed target. */
  id: IndexTargetId;
  run: IndexModule;
}

/**
 * The registry both server consumers read: the client-safe metadata joined to
 * its runner. Declaration order is the order log lines are emitted, NOT the
 * order they execute — see {@link seedIndexes}.
 */
export const INDEX_MODULE_REGISTRY: readonly IndexModuleEntry[] = INDEX_TARGETS.map((t) => ({
  ...t,
  run: INDEX_RUNNERS[t.id],
}));

const INDEX_MODULES: readonly IndexModule[] = INDEX_MODULE_REGISTRY.map((m) => m.run);

export async function seedIndexes(db: Db, log: (msg: string) => void) {
  // The modules run concurrently. Running them in sequence meant ~275 round
  // trips serialised at network latency; the drop sweep already establishes
  // this pattern (Promise.all over 208 collections).
  //
  // Safe because every index is a distinct (collection, name) pair and
  // `createIndex` is idempotent. Modules DO share collections — core and
  // performance both index `corporateSectors` — but concurrent builds of
  // differently-named indexes on one collection are fine. The one module doing
  // more than DDL is seedCoreIndexes, which merges duplicate `corporateSectors`
  // rows to satisfy their unique identity index; no other module writes that
  // collection, so nothing races it. Adding data repair to another module, or a
  // second declaration of an existing index name, would break both properties.
  //
  // Two properties are deliberately preserved:
  //  - This stays a BARRIER. Every index must exist before the seeders' upsert
  //    loops run, or those loops go back to collection scans — which is what
  //    made hoisting the indexes above the loops (C2) a precondition for
  //    batching them (C1).
  //  - Log output stays deterministic. Each module writes into its own buffer,
  //    flushed in declaration order afterwards, so interleaved concurrent
  //    writes cannot scramble the seed log that the op-profiler parses for
  //    phase gaps and repeated passes.
  const buffers: string[][] = INDEX_MODULES.map(() => []);
  await Promise.all(INDEX_MODULES.map((run, i) => run(db, (msg) => buffers[i].push(msg))));
  for (const buffer of buffers) for (const line of buffer) log(line);
  log("All indexes ensured");
}

export {
  seedCoreIndexes,
  seedActivityIndexes,
  seedCabinetIndexes,
  seedPerfIndexes,
  seedSlowQueryIndexes,
  seedSearchIndexes,
  seedInternationalOrganizationIndexes,
  seedWriteGuardIndexes,
  seedPartyNppReworkIndexes,
  seedSovereignDefaultIndexes,
  seedObservabilityIndexes,
  seedFinancialTxLogIndexes,
  seedLedgerIndexes,
  seedCommodityPriceIndexes,
  seedIndexFundIndexes,
  seedApiAccessIndexes,
  seedCrisisInteractionIndexes,
  seedCrisisIndexes,
  seedActionAuditLogIndexes,
  seedAltDetectionIndexes,
  seedAuditAnomaliesIndexes,
  seedWatchlistIndexes,
  seedConflictIndexes,
  seedBankingIndexes,
  seedSettlementIndexes,
};
