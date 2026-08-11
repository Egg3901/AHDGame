import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the moderator/admin watchlist (forensics v2, Wave 2
 * "watchlist + alerts"). `watchlist` is a small pinned-accounts collection;
 * these indexes cover: preventing an account being pinned twice, "who
 * pinned this" lookups, and the default createdAt-desc listing order.
 */
export async function seedWatchlistIndexes(db: Db, log: (msg: string) => void) {
  log("Watchlist indexes:");

  await ensureIndex(
    db,
    "watchlist",
    { userId: 1 },
    { name: "watchlist_userId_unique", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "watchlist",
    { addedBy: 1 },
    { name: "watchlist_addedBy", background: true },
    log
  );

  await ensureIndex(
    db,
    "watchlist",
    { createdAt: -1 },
    { name: "watchlist_createdAt_desc", background: true },
    log
  );

  log("Watchlist indexes ensured");
}
