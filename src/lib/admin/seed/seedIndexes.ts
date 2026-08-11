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

// Barrel that runs every index module in sequence. Bootstrap calls this directly;
// the admin seeder route dispatches the individual module targets so admins can
// re-run a single group from the Universal Seeder UI.
//
// Phase 4 of the reset/seed cleanup absorbed the standalone `add-*-indexes.ts`
// migration scripts into the modules below. The legacy scripts still work but
// become no-ops once these have run from bootstrap.
type IndexModule = (db: Db, log: (msg: string) => void) => Promise<unknown>;

/**
 * Declaration order is the order their log lines are emitted, NOT the order
 * they execute — see {@link seedIndexes}.
 */
const INDEX_MODULES: readonly IndexModule[] = [
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
];

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
};
