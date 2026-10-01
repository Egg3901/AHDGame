import type { Migration, MigrationResult } from "../types";
import { FINANCIAL_TX_LOG_COUNTERPARTY_INDEX } from "@/lib/admin/seed/indexes/financialTxLog";

/**
 * `financialTxLog` counterparty index on a live database (#2693).
 *
 * `stampEntityDeleted` marks every ledger row naming a deleted corporation or
 * character. The subject side has an index; the counterparty side did not, so
 * each deletion scanned the whole log. In an aged 1991 sandbox that was 4.2M
 * rows and about 9 s per deleted corporation, inside the corporation turn.
 *
 * Registry only, not the startup allowlist: building over millions of rows at
 * boot could delay a deployment. Create-only and idempotent.
 */
export const migration: Migration = {
  id: "2026-09-30-financial-tx-log-counterparty-index",
  description: "Counterparty index for financialTxLog deletion stamping.",
  idempotent: true,
  execute: async (db, ctx): Promise<MigrationResult> => {
    const { keys, options } = FINANCIAL_TX_LOG_COUNTERPARTY_INDEX;
    const label = `financialTxLog.${options.name}`;
    if (ctx.dryRun)
      return { documentsScanned: 1, documentsUpdated: 0, notes: [`would create ${label}`] };
    await db.collection("financialTxLog").createIndex({ ...keys }, { ...options });
    return { documentsScanned: 1, documentsUpdated: 1, notes: [`created/verified ${label}`] };
  },
};
