import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationLeadership } from "../types/internationalOrganization";

/**
 * Current holder of each org's leadership office (one row per org).
 */
export async function getOrganizationLeadershipCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationLeadership>("organizationLeadership");
}
