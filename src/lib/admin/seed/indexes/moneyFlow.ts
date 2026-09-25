import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the crash-safe money-flow receipts (issue #1672,
 * `nonAtomicMoneyFlowReceipts`). Absorbs the missing registration the
 * primitive's header comment called out: one small receipt document is
 * written per keyed flow, so without a TTL the collection grows without
 * bound.
 *
 * Expire only terminal receipts, 30 days after their last status update.
 * An in-progress receipt may be the only durable record of a partially
 * applied flow. Deleting it before recovery would turn a retry into a new
 * attempt and could strand or duplicate money.
 */
export async function seedMoneyFlowIndexes(db: Db, log: (msg: string) => void) {
  log("Money-flow receipt indexes:");

  await ensureIndex(
    db,
    "nonAtomicMoneyFlowReceipts",
    { updatedAt: 1 },
    {
      name: "nonAtomicMoneyFlowReceipts_terminal_updatedAt_ttl",
      expireAfterSeconds: 30 * 24 * 60 * 60,
      partialFilterExpression: { status: { $in: ["completed", "failed", "compensated"] } },
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
