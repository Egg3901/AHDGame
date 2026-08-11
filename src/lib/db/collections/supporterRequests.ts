import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SupporterRequest } from "@/lib/db/types/supporterRequests";

export async function getSupporterRequestsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SupporterRequest>("supporterRequests");
}
