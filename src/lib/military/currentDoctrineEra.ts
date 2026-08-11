import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { doctrineEraForYear, latestEraIndex } from "./doctrineTree";

/**
 * The doctrine era gating adoption — the world's current decade (from the game
 * year), independent of whether the era system is enabled. Falls back to the
 * latest era when the game year cannot be resolved.
 */
export async function resolveDoctrineEra(db: Db): Promise<number> {
  const col = await getGameStateCollection(db);
  const gs = await col.findOne(
    { _id: "current" },
    { projection: { currentYear: 1, currentTurn: 1, startingYear: 1 } }
  );
  const year = gs ? resolveGameYear(gs) : null;
  return year != null ? doctrineEraForYear(year) : latestEraIndex();
}
