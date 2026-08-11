import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { User } from "../types";

/**
 * Typed `users` collection. Pass `db` when already connected to avoid an extra
 * `getDb()` await (e.g. turn processing, scripts batching work on one handle).
 */
export async function getUsersCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<User>("users");
}
