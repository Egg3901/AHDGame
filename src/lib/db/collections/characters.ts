import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character } from "../types";

/**
 * Typed `characters` collection. Pass `db` when already connected to avoid an extra
 * `getDb()` await (e.g. turn processing).
 */
export async function getCharactersCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<Character>("characters");
}
