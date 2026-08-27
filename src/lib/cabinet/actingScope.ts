/**
 * What an acting secretary may and may not do.
 *
 * An acting appointment (`POST /api/whitehouse/cabinet/acting`) exists to stop a
 * department going dark between a president taking office and the Senate getting
 * round to a confirmation vote. It is a caretaker post, not a short confirmation:
 * the holder keeps the lights on, and the levers that bind the department past
 * their own tenure stay locked until the Senate votes.
 *
 * The split is operations vs commitments:
 *
 *  - ALLOWED. Running the department day to day. Ministerial orders, moving and
 *    assigning units, declaring and withdrawing offensives, force org (commands,
 *    formations, theaters), reinforcement mode, recruiting, funding levels on
 *    things that already exist, and splitting an already-appropriated budget.
 *    These are the things a vacancy actually costs the country, which is the
 *    whole reason the acting appointment exists.
 *
 *  - BARRED. The six scopes below. Each either outlives the acting holder
 *    (doctrine, contracts, debt maturities, plants), cannot be undone (a nuclear
 *    test, a dismissed general's chain of command), or is the department's
 *    declared policy direction, which is precisely what confirmation is a vote on.
 *
 * Only the executive's own restriction lives here. Whether the caller holds the
 * seat at all is a separate, earlier check every route already does.
 */

/** A class of cabinet lever, grouped by what confirmation is protecting. */
export type CabinetLeverScope =
  "stance" | "personnel" | "doctrine" | "procurement" | "treasury" | "assets";

/**
 * The scopes an acting secretary may not touch, each with the sentence the
 * player sees. Written as what the office cannot do and what unlocks it, because
 * "forbidden" on its own reads as a bug to someone who was just handed the seat.
 */
const BARRED_SCOPES: Record<CabinetLeverScope, string> = {
  stance:
    "An acting secretary cannot change the department's stance. Policy direction is what the Senate confirms.",
  personnel:
    "An acting secretary cannot commission or dismiss commanders. The general corps outlasts a caretaker appointment.",
  doctrine:
    "An acting secretary cannot adopt doctrine or move the nuclear programme. These bind the country past this appointment.",
  procurement:
    "An acting secretary cannot award or cancel defence contracts. Procurement commits money beyond this appointment.",
  treasury:
    "An acting secretary cannot run debt operations or reset the bond profile. These commit the country's borrowing for years.",
  assets:
    "An acting secretary cannot open, close or expand departmental assets. An acting secretary funds what exists; the confirmed secretary decides what exists.",
};

/** The minimum shape needed to judge a holder's authority. */
export type ActingScopeMember = { acting?: boolean } | null | undefined;

/**
 * True when this seat is held in an acting (unconfirmed) capacity.
 *
 * A missing `acting` field means confirmed: every pre-existing member predates
 * acting appointments, and the confirmation path inserts a fresh document
 * without the flag rather than clearing it.
 */
export function isActingMember(member: ActingScopeMember): boolean {
  return member?.acting === true;
}

/** True when `scope` is closed to acting secretaries. */
export function isScopeBarredWhenActing(scope: CabinetLeverScope): boolean {
  return scope in BARRED_SCOPES;
}

/**
 * The player-facing sentence for `scope`, independent of who is asking.
 *
 * Exported so the disabled control's tooltip and the API's 403 body read the
 * same words. This module has no server-only imports precisely so the client
 * can share them rather than keep a second copy that drifts.
 */
export function barredScopeMessage(scope: CabinetLeverScope): string {
  return BARRED_SCOPES[scope];
}

/**
 * The refusal sentence for `scope`, or `null` when the holder may proceed,
 * either because they are confirmed, or because the scope was never barred.
 */
export function actingScopeRefusal(
  member: ActingScopeMember,
  scope: CabinetLeverScope
): string | null {
  if (!isActingMember(member)) return null;
  return BARRED_SCOPES[scope] ?? null;
}

/**
 * Every scope closed to `member`, for handing to the client so a barred control
 * renders disabled instead of erroring on click. Empty for a confirmed holder,
 * which is the signal the UI uses to render normally.
 */
export function barredScopesFor(member: ActingScopeMember): CabinetLeverScope[] {
  if (!isActingMember(member)) return [];
  return Object.keys(BARRED_SCOPES) as CabinetLeverScope[];
}
