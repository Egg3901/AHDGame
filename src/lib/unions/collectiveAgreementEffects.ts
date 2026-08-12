import type { Db } from "mongodb";
import type { CollectiveAgreement } from "@/lib/db/types";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { activeCollectiveAgreementFilter } from "./bargaining";

export interface CollectiveAgreementEffects {
  wageFloorBySectorId: Map<string, number>;
  noStrikeProtectedSectorIds: Set<string>;
}

/**
 * Load the enforceable part of active agreements once for the corporation
 * turn. Defensive max selection makes overlapping legacy rows deterministic.
 */
export async function loadCollectiveAgreementEffects(
  db: Db,
  currentTurn: number
): Promise<CollectiveAgreementEffects> {
  const agreements = await db
    .collection<CollectiveAgreement>("collectiveAgreements")
    .find(
      {
        ...activeCollectiveAgreementFilter(currentTurn),
      },
      { projection: { sectorIds: 1, wageLevel: 1, noStrikeUntilTurn: 1 } }
    )
    .toArray();

  const wageFloorBySectorId = new Map<string, number>();
  const noStrikeProtectedSectorIds = new Set<string>();
  for (const agreement of agreements) {
    const wageFloor = clampWageLevel(agreement.wageLevel);
    for (const sectorId of agreement.sectorIds) {
      const key = sectorId.toString();
      wageFloorBySectorId.set(key, Math.max(wageFloorBySectorId.get(key) ?? 0, wageFloor));
      if (currentTurn < agreement.noStrikeUntilTurn) noStrikeProtectedSectorIds.add(key);
    }
  }
  return { wageFloorBySectorId, noStrikeProtectedSectorIds };
}
