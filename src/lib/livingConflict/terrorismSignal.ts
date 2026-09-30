/**
 * Counterterrorism budgets and political boards read the same standing national
 * powers and military commitments. Disabled or unopened worlds incur no cost.
 */
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { LivingConflictState } from "./types";
import { TERRORISM_KEY, type TerrorismSignal } from "./rules/transnationalTerrorism";

export async function loadTerrorismSignal(
  db: Db,
  enabled?: boolean
): Promise<TerrorismSignal | null> {
  const game =
    enabled === undefined
      ? await db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { livingConflictsEnabled: 1 } })
      : null;
  if (!(enabled ?? game?.livingConflictsEnabled)) return null;
  return db
    .collection<LivingConflictState>("livingConflicts")
    .findOne(
      { defKey: TERRORISM_KEY },
      {
        projection: {
          hasOpened: 1,
          status: 1,
          phaseLevel: 1,
          tracks: 1,
          "campaign.countryMemory": 1,
        },
      }
    );
}
