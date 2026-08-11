// src/lib/turn/vicePresidentActionReset.ts
import type { AnyBulkWriteOperation } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import { getCalendarDayInTimezone, shouldApplyDailyReset } from "@/lib/time/dailyReset";
import { VP_ACTION_CAP } from "@/lib/constants/vicePresidentActions";

/**
 * Refill every seated vice-president's self-serve action pool to the cap once
 * per Eastern-time calendar day (player suggestion #67).
 *
 * Mirrors the ministerial-action refill in `processMinisterialOrders`
 * (section 6): a per-turn sweep gated by the daily boundary, so a VP gets
 * `VP_ACTION_CAP` actions each day rather than every turn. Runs for all
 * countries; NPP-held VP seats are refilled harmlessly (they never spend).
 */
export async function resetVicePresidentActions(db: Db): Promise<{ vpActionsRegenerated: number }> {
  const todayEastern = getCalendarDayInTimezone(new Date());
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ officeType: "vicePresident" })
    .project<Pick<ElectedOfficial, "_id" | "lastVpActionResetDay">>({
      _id: 1,
      lastVpActionResetDay: 1,
    })
    .toArray();

  const bulkOps: AnyBulkWriteOperation<ElectedOfficial>[] = [];
  for (const official of officials) {
    if (!shouldApplyDailyReset(official.lastVpActionResetDay)) continue;
    bulkOps.push({
      updateOne: {
        filter: { _id: official._id },
        update: {
          $set: {
            vpActionsRemaining: VP_ACTION_CAP,
            lastVpActionResetDay: todayEastern,
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection<ElectedOfficial>("electedOfficials").bulkWrite(bulkOps);
  }

  return { vpActionsRegenerated: bulkOps.length };
}
