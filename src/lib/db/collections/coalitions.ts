import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Coalition } from "../types/coalition";

/**
 * Typed `coalitions` collection. Pass `db` when already connected to avoid
 * an extra `getDb()` await (e.g. turn processing).
 */
export async function getCoalitionsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<Coalition>("coalitions");
}
