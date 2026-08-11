import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import {
  SPHERE_MEMBERSHIPS_COLLECTION,
  type PersistedSphereMembership,
} from "@/lib/world/spheres/membershipStore";

export async function getSphereMembershipsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<PersistedSphereMembership>(SPHERE_MEMBERSHIPS_COLLECTION);
}
