import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationLeadershipElection } from "../types/internationalOrganization";

/**
 * Open and historical leadership elections (Secretary-General etc.).
 */
export async function getOrganizationLeadershipElectionsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationLeadershipElection>("organizationLeadershipElections");
}
