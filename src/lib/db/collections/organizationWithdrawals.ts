import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationWithdrawal } from "../types/internationalOrganization";

/**
 * Tombstones for deliberate organization withdrawals.
 * One row per (organizationId, countryId) that has left. Backed by a unique
 * compound index defined in the indexer. Consulted by the founding-member
 * self-heal so a member that withdrew is not re-added on reseed/view load.
 */
export async function getOrganizationWithdrawalsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationWithdrawal>("organizationWithdrawals");
}
