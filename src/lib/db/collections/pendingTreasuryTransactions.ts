import { getDb } from "@/lib/mongodb";
import type { PendingTreasuryTransaction } from "../types";

/**
 * Get the `pendingTreasuryTransactions` collection.
 *
 * Holds in-flight two-person-approval rows for Send to Member and
 * Transfer to State Party actions when a party's
 * `transactionApprovalMode === "double"`. See
 * `docs/plans/archive/2026-05/2026-05-22-treasury-two-person-approval.md`.
 */
export async function getPendingTreasuryTransactionsCollection() {
  const db = await getDb();
  return db.collection<PendingTreasuryTransaction>("pendingTreasuryTransactions");
}
