import type { Db, ObjectId } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";
import { canManageOffice } from "@/lib/governorOffice/access";

/**
 * Authorization helpers shared by the government prospecting and
 * extraction-contract-issuance routes. A "national" issuer is the sitting head
 * of government OR the finance-minister cabinet seat holder; a "state" issuer is
 * the state's governor / regional executive. Admin is handled by the caller.
 */

/** Head of government (president / PM / premier) OR finance-minister seat. */
export async function isNationalIssuer(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<boolean> {
  if (await isSittingLeader(db, countryId, characterId)) return true;
  const seat = COUNTRY_CONFIGS[countryId]?.financeMinisterCabinetId;
  if (!seat) return false;
  const member = await getCabinetMembersCollection(db).findOne({
    countryId,
    positionId: seat,
    characterId,
  });
  return !!member;
}

/** The state's governor / regional executive (human holder only). */
export async function isStateIssuer(
  db: Db,
  countryId: CountryId,
  stateId: string,
  characterId: ObjectId
): Promise<boolean> {
  return canManageOffice(db, countryId, stateId, characterId);
}
