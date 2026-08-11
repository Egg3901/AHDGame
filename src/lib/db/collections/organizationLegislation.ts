import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationLegislation } from "../types/internationalOrganization";

/**
 * Org-level legislation (currently: free-trade agreements). Active rows zero
 * tariffs between the named parties; consulted from the tariff override layer.
 */
export async function getOrganizationLegislationCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationLegislation>("organizationLegislation");
}
