import type { Db, ObjectId } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import type { Notification, NotificationPreferences } from "@/lib/db/types/notifications";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { notificationTypeFilter } from "@/lib/notifications/visibility";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";

export interface WidgetExtras {
  turn: { current: number; date: string; nextAt: string | null; active: boolean } | null;
  /** The same counts as the navbar bell and mail icon. */
  inbox: { unread: number; mail: number };
}

/**
 * The turn clock and inbox counts the phone widgets show. Requested with
 * `widgets=1` so the web status bar poll keeps its query count and ETag.
 */
export async function loadWidgetExtras(
  db: Db,
  userId: ObjectId,
  preferences: NotificationPreferences | undefined
): Promise<WidgetExtras> {
  const now = new Date();
  const [state, unread, mail] = await Promise.all([
    getGameStateCollection(db).then((states) =>
      states.findOne(
        { _id: "current" },
        {
          projection: {
            currentTurn: 1,
            nextScheduledTurn: 1,
            isActive: 1,
            startingYear: 1,
            preIteration: 1,
            preIterationTurns: 1,
          },
        }
      )
    ),
    db.collection<Notification>("notifications").countDocuments({
      userId,
      ...notificationTypeFilter(preferences, now),
      read: false,
    }),
    preferences?.muteMail
      ? 0
      : db.collection("playerMail").countDocuments({
          toUserId: userId,
          read: false,
          deletedByRecipient: false,
          blockedByRecipient: { $ne: true },
        }),
  ]);
  return {
    turn:
      state && Number.isFinite(state.currentTurn)
        ? {
            current: state.currentTurn,
            date: rawTurnToLarpDate(state.currentTurn, state.startingYear ?? STARTING_YEAR, {
              preIterationActive: state.preIteration?.active,
              preIterationTurns: state.preIterationTurns,
            }),
            nextAt: state.nextScheduledTurn
              ? new Date(state.nextScheduledTurn).toISOString()
              : null,
            active: state.isActive !== false,
          }
        : null,
    inbox: { unread, mail },
  };
}
