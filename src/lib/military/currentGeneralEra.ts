import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { CUR_ERA_YEAR } from "./generalsTree";

/**
 * The game year gating general trait training (a decade year, e.g. 1979) — a
 * 1979 game cannot train 2000s trait nodes. Falls back to CUR_ERA_YEAR when the
 * game year cannot be resolved.
 */
export async function resolveGeneralEra(db: Db): Promise<number> {
  const col = await getGameStateCollection(db);
  const gs = await col.findOne(
    { _id: "current" },
    { projection: { currentYear: 1, currentTurn: 1, startingYear: 1 } }
  );
  return (gs ? resolveGameYear(gs) : null) ?? CUR_ERA_YEAR;
}
