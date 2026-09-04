/**
 * What an acting secretary may and may not do.
 *
 * An acting appointment exists to stop a department going dark between a
 * president taking office and the Senate getting round to a confirmation vote.
 * It is a caretaker post, not a short confirmation: the holder keeps the lights
 * on, and the levers that bind the department past their own tenure stay locked
 * until the Senate votes.
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
 *
 * The appointment is also bounded in TIME and in COUNT, which is what stops a
 * caretaker post becoming a permanent one: see `ACTING_TENURE_TURNS` and
 * `ACTING_CHARGES_PER_SEAT` below, and `CABINET_ROUTE_SCOPES` for the manifest
 * that keeps every mutating route accounted for.
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

/**
 * How long an acting appointment lasts before it lapses.
 *
 * Matches `SETTING_CHANGE_COOLDOWN_TURNS`, so an acting holder could make at
 * most one policy change in a full tenure even if policy were open to them.
 */
export const ACTING_TENURE_TURNS = 24;

/**
 * Acting appointments a President may make per cabinet seat, per presidency.
 *
 * `hasUnspentActingCharge` implements this as "no charge row exists", which is
 * only equivalent while the value is 1. Raising it means changing that helper
 * to compare a count against this constant.
 */
export const ACTING_CHARGES_PER_SEAT = 1;

/**
 * Every mutating cabinet route, keyed by its path below
 * `/api/country/[code]/executive/cabinet/[positionId]/`, mapped to the lever
 * scope it exercises. `"operational"` means an acting holder may use it.
 *
 * This table is the completeness guarantee. The routes themselves call
 * `requireConfirmedSecretary(member, scope)` with a literal, which is readable
 * at the call site but says nothing about the routes that DON'T call it. The
 * manifest closes that gap: `actingScope.manifest.test.ts` walks the route tree
 * and fails when a mutating route is missing here, or when the scope a route
 * passes disagrees with the scope recorded here. A new cabinet route therefore
 * cannot ship without someone deciding, in writing, what an acting secretary may
 * do with it.
 *
 * GET handlers are never gated: who may READ a cabinet office is decided by
 * `resolveCabinetOfficeVisibility` instead.
 */
export const CABINET_ROUTE_SCOPES: Record<string, CabinetLeverScope | "operational"> = {
  // Operational: reversible, and spent within a tenure.
  "military/recruit": "operational",
  "military/[unitId]": "operational",
  "military/[unitId]/assign": "operational",
  "military/[unitId]/posture": "operational",
  "military/[unitId]/upgrade": "operational",
  "military/assign-branch": "operational",
  formations: "operational",
  theaters: "operational",
  commands: "operational",
  "battle/declare": "operational",
  "battle/auto-join": "operational",
  // Moving a fleet and setting what it is doing is routine command, and plainly less
  // consequential than declaring an offensive, which is already operational above. It
  // commits no money, starts no war, and any order it sets can be changed next turn by
  // whoever holds the seat properly.
  "navair/mission": "operational",
  manpower: "operational",
  order: "operational",
  banner: "operational",
  // Funding something already running keeps a department alive; starting
  // something new does not.
  "infra/[projectId]/funding": "operational",
  "estates/[estateId]/fund": "operational",
  // Splitting an already-appropriated budget is operations, not direction: the
  // appropriation itself was decided elsewhere. Deliberately open, matching the
  // allowed list in this file's header.
  allocation: "operational",

  // The department's declared policy direction, which is what confirmation is
  // a vote on.
  setting: "stance",

  // Who serves, which outlasts whoever appointed them.
  generals: "personnel",
  "generals/[characterId]": "personnel",

  // Irreversible, and permanent at national scale.
  "doctrine/adopt": "doctrine",
  "nuclear/adopt": "doctrine",
  // `nuclear/covert` itself is a GET surface; its mutations are the two below.
  "nuclear/covert/breakout": "doctrine",
  "nuclear/covert/funding": "doctrine",
  "nuclear/production": "doctrine",
  "nuclear/test": "doctrine",

  // The intelligence console. Every mutation funnels through
  // `requireIntelligenceHolder` with `intent: "manage"`, which applies the
  // scope once for the whole console the way the nuclear guard does. An
  // acting director reads the service but does not point it: funding a
  // network abroad and running an operation both outlive the appointment,
  // and an attributed operation is a diplomatic fact the next holder owns.
  "intelligence/counter-intel": "stance",
  "intelligence/network": "stance",
  "intelligence/operation": "stance",

  // Commits money past the appointment.
  "defence-contracts": "procurement",
  "debt-operation": "treasury",
  "bond-profile": "treasury",

  // What the department owns, as opposed to what it funds.
  "estates/open": "assets",
  "estates/[estateId]/expand": "assets",
  "estates/[estateId]": "assets",
  "infra/start": "assets",
  "infra/[projectId]": "assets",
  "energy/build": "assets",
  "energy/[plantId]": "assets",
  "energy/[plantId]/upgrade": "assets",
};
