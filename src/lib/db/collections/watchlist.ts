import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { WatchlistEntry } from "../types/watchlist";

/**
 * Typed `watchlist` collection. Pass `db` when already connected to avoid
 * an extra `getDb()` await.
 *
 * Written via `POST`/`DELETE /api/admin/watchlist` (both mods and admins,
 * `requireModerator`). See `src/lib/db/types/watchlist.ts` for the entry
 * shape and `src/lib/admin/seed/indexes/watchlist.ts` for the index set.
 */
export async function getWatchlistCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<WatchlistEntry>("watchlist");
}
