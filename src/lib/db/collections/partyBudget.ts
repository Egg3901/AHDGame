import { getDb } from "@/lib/mongodb";
import type { PartyBudget } from "../types";

/**
 * Get the partyBudget collection.
 *
 * This collection stores party budgets for GOTV (Get Out The Vote) campaigns,
 * tracking allocations and spending across different demographic groups.
 */
export async function getPartyBudgetCollection() {
  const db = await getDb();
  return db.collection<PartyBudget>("partyBudget");
}
