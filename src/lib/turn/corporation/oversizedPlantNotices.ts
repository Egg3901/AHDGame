import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import {
  IDLE_RETIRE_GLUT_FILL,
  IDLE_RETIRE_STRUCTURAL_GRACE_TURNS,
  IDLE_RETIRE_STRUCTURAL_THROTTLE,
} from "./rules/idleCapacityRetirement";

/**
 * Warn a player CEO the first turn one of their plants counts as oversized:
 * it sells what it makes, but the demand throttle holds it far below its size
 * (rules/idleCapacityRetirement, structural case). Unused capacity starts to
 * retire after IDLE_RETIRE_STRUCTURAL_GRACE_TURNS, so the warning gives the
 * owner that long to park capacity they want to keep or wait for demand.
 *
 * Runs after the corporation turn has written this turn's sector state. One
 * notice per plant per oversized spell: it fires on streak 1 only.
 */
export async function notifyOversizedPlants(db: Db, turn: number): Promise<void> {
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      {
        mothballed: { $ne: true },
        demandIdleTurns: 1,
        demandThrottleFactor: { $gt: 0, $lt: IDLE_RETIRE_STRUCTURAL_THROTTLE },
        soldFraction: { $gte: IDLE_RETIRE_GLUT_FILL },
      },
      {
        projection: {
          _id: 1,
          corporationId: 1,
          stateId: 1,
          sectorType: 1,
          demandThrottleFactor: 1,
        },
      }
    )
    .toArray();
  if (sectors.length === 0) return;

  const corps = await db
    .collection<Corporation>("corporations")
    .find(
      {
        _id: { $in: [...new Set(sectors.map((s) => s.corporationId))] },
        ceoType: { $ne: "npp" },
        countryOwnerId: { $exists: false },
        userId: { $exists: true, $ne: null },
      },
      { projection: { _id: 1, userId: 1, name: 1, sequentialId: 1 } }
    )
    .toArray();
  const corpById = new Map(corps.map((c) => [String(c._id), c]));

  const notifications: NotificationInput[] = [];
  for (const sector of sectors) {
    const corp = corpById.get(String(sector.corporationId));
    if (!corp?.userId) continue;
    const runPct = Math.round(100 * (sector.demandThrottleFactor ?? 0));
    notifications.push({
      userId: corp.userId,
      type: "corp_plant_oversized",
      title: "A plant is much bigger than its market",
      message:
        `${corp.name}'s ${sector.sectorType} plant in ${sector.stateId} is running at about ` +
        `${runPct}% of its capacity because that is all its buyers take. If that lasts ` +
        `${IDLE_RETIRE_STRUCTURAL_GRACE_TURNS} turns, unused capacity starts to retire a little ` +
        `each turn. Park capacity you want to keep, or leave it if you expect demand to grow.`,
      metadata: {
        corporationId: corp._id.toString(),
        sequentialId: corp.sequentialId,
        sectorId: sector._id.toString(),
        turn,
      },
    });
  }
  await createNotifications(notifications);
}
