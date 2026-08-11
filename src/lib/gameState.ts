import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";

/** Pass `db` when already connected to avoid an extra collection-resolution round trip. */
export async function getGameState(db?: Db): Promise<GameState | null> {
  const collection = await getGameStateCollection(db);
  return collection.findOne({ _id: "current" });
}

/** Compatibility no-op while callers still expect an explicit invalidation hook. */
export function invalidateGameStateCache(): void {
  // GameState reads are intentionally uncached to preserve immediate visibility after writes.
}
