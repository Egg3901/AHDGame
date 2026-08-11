import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationFund } from "../types/organizationFund";

/** Pooled treasuries for international organizations (dues in, aid out). */
export async function getOrganizationFundsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationFund>("organizationFunds");
}
