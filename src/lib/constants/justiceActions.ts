import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";

/**
 * Justice self-serve action pool (#3598, spec #3581 user story 9).
 *
 * The Justice office is otherwise passive between Docket cases; this gives a
 * seated player-Justice a small, self-directed toolkit, judicial-flavored.
 * The pool mirrors the VP `vicePresidentActions.ts` model exactly (which
 * itself mirrors the cabinet `ministerialActions` model): a fixed daily cap,
 * refilled once per Eastern-time calendar day by the turn engine (see
 * `src/lib/turn/justiceActionReset.ts`), spent one-per-action by the justice
 * action endpoint. Reuses the same tier/cap machinery — not a new economy.
 */

/** Max self-serve actions a seated Justice can take per Eastern-time day. Same cap as VP. */
export const JUSTICE_ACTION_CAP = 2;

/**
 * Passive National Influence accrued per turn by a seated (player-character)
 * Justice — same tier as VP's `OFFICE_NI_BONUS.vicePresident` in
 * `src/lib/turn/actionRefresh.ts`. Kept as its own constant (rather than added
 * to `OFFICE_NI_BONUS`, which is keyed off `character.currentOffice.type`)
 * because Justice is deliberately NOT stored on `currentOffice` — mirrors how
 * the central bank chair bonus is stacked via a separate `Set` lookup there.
 */
export const JUSTICE_NI_BONUS_PER_TURN = 2.0;

/**
 * Political influence the Justice gains from one Write an Opinion (clamped to
 * 100) — mirrors VP's `rally_base` exactly (self-targeting, boosts the
 * office-holder's own politicalInfluence), just judicial-flavored.
 */
export const JUSTICE_OPINION_INFLUENCE_GAIN = 2;

/** Favorability the Justice gains from one Public Address (clamped to 100), self-targeting like rally_base. */
export const JUSTICE_ADDRESS_FAVORABILITY_GAIN = 2;

/** Reset-cadence hint shown next to the action counter. */
export const JUSTICE_ACTION_RESET_HINT = "Resets daily at midnight Eastern Time.";

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
    description: "Publish a legal opinion piece. You gain a small political influence boost.",
  },
] as const;

/** Fields to seed on a newly seated Justice's action pool. */
export function initialJusticeActionFields(now: Date = new Date()) {
  return {
    justiceActionsRemaining: JUSTICE_ACTION_CAP,
    lastJusticeActionResetDay: getCalendarDayInTimezone(now),
  };
}
