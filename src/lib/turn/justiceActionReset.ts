// src/lib/turn/justiceActionReset.ts
import type { AnyBulkWriteOperation } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { SupremeCourtSeat } from "@/lib/db/types/scotus";
import { getCalendarDayInTimezone, shouldApplyDailyReset } from "@/lib/time/dailyReset";
import { JUSTICE_ACTION_CAP } from "@/lib/constants/justiceActions";

/**
 * Refill every seated Justice's self-serve action pool to the cap once per
 * Eastern-time calendar day. Mirrors `resetVicePresidentActions` exactly —
 * same daily-boundary gate, same bulk-write shape. Runs for all occupied
 * seats; NPP/historical-held seats are refilled harmlessly (no player to
 * spend them, same as the VP mirror's NPP-held-seat note).
 */
export async function resetJusticeActions(db: Db): Promise<{ justiceActionsRegenerated: number }> {
  const todayEastern = getCalendarDayInTimezone(new Date());
  const seats = await db
    .collection<SupremeCourtSeat>("supremeCourtSeats")
    .find({ justiceCharacterId: { $ne: null } })
    .project<Pick<SupremeCourtSeat, "_id" | "lastJusticeActionResetDay">>({
      _id: 1,
      lastJusticeActionResetDay: 1,
    })
    .toArray();

  const bulkOps: AnyBulkWriteOperation<SupremeCourtSeat>[] = [];
  for (const seat of seats) {
    if (!shouldApplyDailyReset(seat.lastJusticeActionResetDay)) continue;
    bulkOps.push({
      updateOne: {
        filter: { _id: seat._id },
        update: {
          $set: {
            justiceActionsRemaining: JUSTICE_ACTION_CAP,
            lastJusticeActionResetDay: todayEastern,
          },
        },
      },
    });
  }

  if (bulkOps.length > 0) {
    await db.collection<SupremeCourtSeat>("supremeCourtSeats").bulkWrite(bulkOps);
  }

  return { justiceActionsRegenerated: bulkOps.length };
}
