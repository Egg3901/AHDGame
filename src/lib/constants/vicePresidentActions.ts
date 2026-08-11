import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";

/**
 * Vice-president self-serve action pool (player suggestion #67).
 *
 * The VP office is otherwise passive between elections; this gives the seated
 * VP a small, self-directed toolkit. The pool mirrors the cabinet
 * `ministerialActions` model exactly: a fixed daily cap, refilled once per
 * Eastern-time calendar day by the turn engine (see
 * `src/lib/turn/vicePresidentActionReset.ts`), and spent one-per-action by the
 * VP action endpoint.
 */

/** Max self-serve actions a seated vice-president can take per Eastern-time day. */
export const VP_ACTION_CAP = 2;

/** Favorability the sitting president gains from one Surrogate Address (clamped to 100). */
export const VP_SURROGATE_FAVORABILITY_GAIN = 2;

/** Political influence the VP gains from one Rally the Base (clamped to 100). */
export const VP_RALLY_INFLUENCE_GAIN = 2;

/** Reset-cadence hint shown next to the action counter. */
export const VP_ACTION_RESET_HINT = "Resets daily at midnight Eastern Time.";

export type VpActionId = "surrogate_address" | "rally_base";

export interface VpActionDef {
  id: VpActionId;
  name: string;
  description: string;
}

/** The two self-serve actions surfaced on the VP office page. */
export const VP_ACTIONS: readonly VpActionDef[] = [
  {
    id: "surrogate_address",
    name: "Surrogate Address",
    description:
      "Take the stump for the administration. The sitting president gains a small favorability boost.",
  },
  {
    id: "rally_base",
    name: "Rally the Base",
    description:
      "Work the party faithful and the Senate floor. You gain a small political influence boost.",
  },
] as const;

/** Fields to seed on a newly seated vice-president's action pool. */
export function initialVpActionFields(now: Date = new Date()) {
  return {
    vpActionsRemaining: VP_ACTION_CAP,
    lastVpActionResetDay: getCalendarDayInTimezone(now),
  };
}
