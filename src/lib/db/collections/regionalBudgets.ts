import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { RegionalBudget } from "../types/regionalBudget";

/**
 * Typed `regionalBudgets` collection (keyed by regionId, e.g. "LON").
 * Pass `db` when already connected to avoid an extra `getDb()` await.
 */
export async function getRegionalBudgetsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<RegionalBudget>("regionalBudgets");
}
