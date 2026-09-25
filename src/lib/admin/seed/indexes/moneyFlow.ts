import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the crash-safe money-flow receipts (issue #1672,
 * `nonAtomicMoneyFlowReceipts`). Absorbs the missing registration the
 * primitive's header comment called out: one small receipt document is
 * written per keyed flow, so without a TTL the collection grows without
 * bound.
 *
 * The TTL expires receipts `createdAt + 30 days`. That bounds growth while
 * keeping every realistic client-retry and crash-recovery window covered:
 * the key guard on the account documents (`appliedMoneyFlowKeys`, capped at
 * 100 entries) ages out on a similar horizon, so a receipt and its legs
 * expire together rather than one outliving the other.
 */
export async function seedMoneyFlowIndexes(db: Db, log: (msg: string) => void) {
  log("Money-flow receipt indexes:");

  await ensureIndex(
    db,
    "nonAtomicMoneyFlowReceipts",
    { createdAt: 1 },
    {
      name: "nonAtomicMoneyFlowReceipts_createdAt_ttl",
      expireAfterSeconds: 30 * 24 * 60 * 60,
      background: true,
    },
    log
  );

  await ensureIndex(
    db,
    "nonAtomicMoneyFlowReceipts",
    { status: 1, updatedAt: 1 },
    { name: "nonAtomicMoneyFlowReceipts_status_updatedAt", background: true },
    log
  );
}
