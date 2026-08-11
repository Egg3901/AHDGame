import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";

export async function getStateResourceCapacityCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<StateResourceCapacity>("stateResourceCapacity");
}
