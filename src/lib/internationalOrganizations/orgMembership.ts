/**
 * Who belongs to an organisation, and which of them have a say.
 *
 * The rule: membership is open to any entity in the game; voting, leadership and
 * dues belong to player-enabled countries; everyone else pays tribute and is
 * silent.
 *
 * That is not only a fairness rule, it is what keeps unanimity workable. Adding
 * thirty client states to NATO would deadlock every admission if they were
 * voters who could never cast a vote — so they are not voters.
 *
 * Keeping the vote predicate and the money predicate in this one file is what
 * stops them drifting apart: `votingMembers` and `tributeMembers` partition the
 * roll exactly, so nobody is billed twice and nobody is billed not at all.
 */
import type { Db } from "mongodb";
import { getAllCountryAccess, type CountryAccess } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import { getMembers, isMember } from "./service";

/**
 * The access table these predicates read. Callers sweeping many organisations in
 * one pass should load it once and pass it in — `getAllCountryAccess` costs two
 * round-trips, and the turn phase would otherwise pay that per organisation.
 */
export type AccessTable = Record<CountryId, CountryAccess>;

/** Fail-closed: an entity with no access row is not enabled. Macro entities have
 *  none by construction, so they fall out here with no special case. */
function isEnabled(access: AccessTable, id: string): boolean {
  return access[id as CountryId]?.enabledForPlayers === true;
}

/**
 * Members entitled to vote and to hold office: player-enabled countries only.
 * A macro entity, or a country an admin has not enabled, is a member in every
 * other sense but is silent.
 */
export async function votingMembers(
  db: Db,
  orgId: string,
  access?: AccessTable
): Promise<CountryId[]> {
  const [members, table] = await Promise.all([
    getMembers(db, orgId),
    access ? Promise.resolve(access) : getAllCountryAccess(db),
  ]);
  return members.filter((id): id is CountryId => isEnabled(table, id));
}

/** Members that owe tribute rather than dues — the exact complement of the above. */
export async function tributeMembers(
  db: Db,
  orgId: string,
  access?: AccessTable
): Promise<OrgMemberId[]> {
  const [members, table] = await Promise.all([
    getMembers(db, orgId),
    access ? Promise.resolve(access) : getAllCountryAccess(db),
  ]);
  return members.filter((id) => !isEnabled(table, id));
}

/**
 * Whether one entity may cast a vote in an organisation. Used by the write side
 * so a ballot is refused at the door rather than accepted and then dropped by the
 * resolver, which would tell a player their vote counted when it did not.
 */
export async function isVotingMember(db: Db, orgId: string, id: string): Promise<boolean> {
  const access = await getAllCountryAccess(db);
  if (access[id as CountryId]?.enabledForPlayers !== true) return false;
  return isMember(db, orgId as Parameters<typeof isMember>[1], id as CountryId);
}
