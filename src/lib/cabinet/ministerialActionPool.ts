import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";

/** Fields to seed on a new cabinet appointment's action pool. */
export function initialMinisterialActionFields(now: Date = new Date()) {
  return {
    ministerialActions: MINISTERIAL_ACTION_CAP,
    lastMinisterialActionResetDay: getCalendarDayInTimezone(now),
  };
}

export const MINISTERIAL_ACTION_RESET_HINT = "Resets daily at midnight Eastern Time.";
