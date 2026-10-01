import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { MoneyFlowReceipt } from "../nonAtomicMoneyFlow";

/**
 * Typed `nonAtomicMoneyFlowReceipts` collection (issue #1672 idempotency
 * receipts). Pass `db` when already connected to avoid an extra `getDb()`
 * await.
 */
export async function getMoneyFlowReceiptsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<MoneyFlowReceipt>("nonAtomicMoneyFlowReceipts");
}
