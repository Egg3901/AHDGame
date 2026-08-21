import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { SettlementPlayDoc } from "../types/settlementPlay";

/** Queued and resolved plays against a settlement crisis. */
export async function getSettlementPlaysCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<SettlementPlayDoc>("settlementPlays");
}
