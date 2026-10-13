import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";

/**
 * Justice self-serve action pool (#3598, spec #3581 user story 9).
 *
 * The Justice office is otherwise passive between Docket cases; this gives a
 * seated player-Justice a small, self-directed toolkit, judicial-flavored.
 * The pool mirrors the VP `vicePresidentActions.ts` model exactly (which
 * itself mirrors the cabinet `ministerialActions` model): a small banked cap
 * that regains one action every `JUSTICE_ACTION_ACCRUAL_TURNS` turns via the
 * turn engine (see `src/lib/turn/justiceActionReset.ts`), spent one-per-action
 * by the justice action endpoint. Reuses the same tier/cap machinery, not a
 * new economy.
 */

/** Max self-serve actions a seated Justice can bank. Same cap as VP. */
export const JUSTICE_ACTION_CAP = 2;

/** Turns between +1 Justice action accruals (12 turns = 12 hours, 2 per day). */
export const JUSTICE_ACTION_ACCRUAL_TURNS = 12;

/**
 * Passive National Influence accrued per turn by a seated (player-character)
 * Justice: the cabinet tier. Kept as its own constant because Justice is
 * deliberately NOT stored on `currentOffice`; the position resolver stacks it
 * via a separate lookup, the same way it handles the central bank chair.
 */
export const JUSTICE_NI_BONUS_PER_TURN = 1.5;

/**
 * National influence the Justice gains from one Write an Opinion. National,
 * not political: a sitting Justice builds standing on the bench, not a
 * home-state machine.
 */
export const JUSTICE_OPINION_NATIONAL_INFLUENCE_GAIN = 0.5;

/** Favorability the Justice gains from one Public Address (clamped to 100), self-targeting like rally_base. */
export const JUSTICE_ADDRESS_FAVORABILITY_GAIN = 2;

/** Reset-cadence hint shown next to the action counter. */
export const JUSTICE_ACTION_RESET_HINT = `Regains 1 action every ${JUSTICE_ACTION_ACCRUAL_TURNS} turns, up to ${JUSTICE_ACTION_CAP}.`;

export type JusticeActionId = "public_address" | "write_opinion";

export interface JusticeActionDef {
  id: JusticeActionId;
  name: string;
  description: string;
}

/** The two self-serve actions surfaced on the Justice office page. */
export const JUSTICE_ACTIONS: readonly JusticeActionDef[] = [
  {
    id: "public_address",
    name: "Public Address",
    description: "Speak publicly on the Court's role. A small favorability boost.",
  },
  {
    id: "write_opinion",
    name: "Write an Opinion",
    description: "Publish a legal opinion piece. You gain a small national influence boost.",
  },
] as const;

/** Fields to seed on a newly seated Justice's action pool. */
export function initialJusticeActionFields(now: Date = new Date()) {
  return {
    justiceActionsRemaining: JUSTICE_ACTION_CAP,
    lastJusticeActionResetDay: getCalendarDayInTimezone(now),
  };
}
