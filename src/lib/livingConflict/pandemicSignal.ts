/** Read the current disease pressure for ordinary health and population phases. */
import type { Db } from "mongodb";
import type { LivingConflictState } from "./types";
import { PANDEMIC_KEY } from "./rules/pandemic";

export async function loadPandemicSignal(
  db: Db,
  enabled: boolean
): Promise<LivingConflictState | null> {
  if (!enabled) return null;
  return db.collection<LivingConflictState>("livingConflicts").findOne(
    { defKey: PANDEMIC_KEY, hasOpened: true, status: { $ne: "closed" } },
    {
      projection: {
        hasOpened: 1,
        status: 1,
        tracks: 1,
        totalTurns: 1,
        phaseLevel: 1,
        pandemicOriginCountryId: 1,
      },
    }
  );
}
