/**
 * Command Economy v2 (P2) — server-side authorization for the three economic
 * seats. A player may only drive the seat they actually hold:
 *
 *  - Gosbank Chair panel  → the holder of the country's `bankCabinetId` seat,
 *    or the head of government (who may always steer state credit).
 *  - Gosplan Planner panel → the holder of the `plannerCabinetId` seat, or the
 *    head of government.
 *  - SOE Director panel    → the character whose id is the SOE's `directorId`.
 *  - Appointing an SOE director → the Gosplan chair or the head of government
 *    (the "cabinet / Supreme Soviet appoints" rule). A vacant seat may also be
 *    self-claimed by a citizen of the country.
 *
 * The role RESOLUTION (a DB read) is separated from the role DECISION (a pure
 * predicate) so the decisions are unit-testable without a database.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { commandEconomyOffices } from "@/lib/constants/commandEconomyOffices";

/** The command-economy roles a viewer holds in one country. */
export interface CommandEconomyRoles {
  /** Sitting head of government (premier). Can drive planner + bank + appoint. */
  isHeadOfGovernment: boolean;
  /** Holds the Gosplan / planning chair. */
  isPlanner: boolean;
  /** Holds the Gosbank / state-bank chair. */
  isBankChair: boolean;
}

/** True if the viewer may write the Gosbank (state-credit) levers. */
export function canOperateGosbank(roles: CommandEconomyRoles): boolean {
  return roles.isBankChair || roles.isHeadOfGovernment;
}

/** True if the viewer may write the Gosplan (national-plan) levers. */
export function canOperateGosplan(roles: CommandEconomyRoles): boolean {
  return roles.isPlanner || roles.isHeadOfGovernment;
}

/** True if the viewer may appoint / reassign an SOE director. */
export function canAppointSoeDirector(roles: CommandEconomyRoles): boolean {
  return roles.isPlanner || roles.isHeadOfGovernment;
}

/**
 * True if the viewer may set the internal-repression lever. The government's
 * tool for staying communist: the head of government drives it, and the Gosbank
 * chair (who steers the whole command apparatus) may too. The Gosplan planner
 * alone may not — repression is a political-security call, not a planning one.
 */
export function canSetRepression(roles: CommandEconomyRoles): boolean {
  return roles.isHeadOfGovernment || roles.isBankChair;
}

/**
 * True if the given character is the SOE's director. Compares nullable
 * ObjectIds safely (a vacant seat → false).
 */
export function isSoeDirector(
  directorId: ObjectId | null | undefined,
  characterId: ObjectId | null | undefined
): boolean {
  if (!directorId || !characterId) return false;
  return directorId.equals(characterId);
}

/**
 * Resolve which command-economy seats `characterId` holds in `countryId`.
 * Non-command countries and unknown characters resolve to all-false.
 */
export async function resolveCommandEconomyRoles(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<CommandEconomyRoles> {
  const offices = commandEconomyOffices(countryId);
  if (!offices) {
    return { isHeadOfGovernment: false, isPlanner: false, isBankChair: false };
  }
  const cabinet = getCabinetMembersCollection(db);
  const [isHeadOfGovernment, plannerSeat, bankSeat] = await Promise.all([
    isSittingLeader(db, countryId, characterId),
    cabinet.findOne({ countryId, positionId: offices.plannerCabinetId, characterId }),
    cabinet.findOne({ countryId, positionId: offices.bankCabinetId, characterId }),
  ]);
  return {
    isHeadOfGovernment,
    isPlanner: !!plannerSeat,
    isBankChair: !!bankSeat,
  };
}
