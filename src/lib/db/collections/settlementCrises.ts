import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SettlementCrisisDoc } from "../types/settlementCrisis";

/** Standing contests over a nation's constitutional settlement. */
export async function getSettlementCrisesCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SettlementCrisisDoc>("settlementCrises");
}
