import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CustomInternationalOrganization } from "../types/customInternationalOrganization";

/**
 * Player-created international organizations. One row per org. The `id` field
 * is the slug used as `organizationId` in the membership / proposal /
 * legislation / leadership collections; backed by a unique index.
 */
export async function getCustomInternationalOrganizationsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<CustomInternationalOrganization>("customInternationalOrganizations");
}
