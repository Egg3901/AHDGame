import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { OrganizationPosture } from "../types/organizationPosture";

/** Current alliance alert posture per security organization (member-voted). */
export async function getOrganizationPosturesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<OrganizationPosture>("organizationPostures");
}
