import type { Db, ObjectId } from "mongodb";
import type { ElectedOfficial, GovernorOfficeState } from "@/lib/db/types";
import { getRegionalExecutiveOfficeKey, type CountryId } from "@/lib/constants/countries";

/**
 * Returns the electedOfficials row for the regional chief executive of the
 * given (countryId, stateId), if and only if `characterId` is the holder.
 */
export async function getOfficeHolderRow(
  db: Db,
  countryId: CountryId,
  stateId: string,
  characterId: ObjectId
): Promise<ElectedOfficial | null> {
  return db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: getRegionalExecutiveOfficeKey(countryId),
    state: stateId.toUpperCase(),
    characterId,
    countryId,
  });
}

/**
 * Returns the electedOfficials row for the regional chief executive of the
 * given (countryId, stateId), regardless of viewer. Used for "who is the
 * governor" lookups (e.g. seeding governorOfficeState).
 */
export async function getCurrentOfficeHolder(
  db: Db,
  countryId: CountryId,
  stateId: string
): Promise<ElectedOfficial | null> {
  return db.collection<ElectedOfficial>("electedOfficials").findOne({
    officeType: getRegionalExecutiveOfficeKey(countryId),
    state: stateId.toUpperCase(),
    countryId,
  });
}

/**
 * Returns the governorOfficeState row for (countryId, stateId), or null.
 */
export async function getOfficeState(
  db: Db,
  countryId: CountryId,
  stateId: string
): Promise<GovernorOfficeState | null> {
  return db.collection<GovernorOfficeState>("governorOfficeState").findOne({
    countryId,
    stateId,
  });
}
