import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationMembership } from "../types/internationalOrganization";

/**
 * Active memberships in international organizations.
 * One row per (organizationId, countryId). Backed by a unique compound index
 * defined in the indexer to prevent duplicate memberships.
 */
export async function getOrganizationMembershipsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationMembership>("organizationMemberships");
}
