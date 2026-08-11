import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationMembershipProposal } from "../types/internationalOrganization";

/**
 * Pending and resolved membership proposals (a country asking to join an org).
 * Resolved by the international-organizations turn phase when closesOnTurn ≤ current turn.
 */
export async function getOrganizationProposalsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationMembershipProposal>("organizationMembershipProposals");
}
