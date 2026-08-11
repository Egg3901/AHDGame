/**
 * Bulk-clear `regimeStatus` on every party in a country.
 *
 * Fired by Phase-6's `systemConversion` driver right after the
 * governmentType flip — the OPS-specific ruling/approved/banned
 * tagging stops being meaningful the moment the country becomes a
 * parliamentary or presidential system. The field is set to `null`
 * (not unset) so legacy readers that expect the property still find a
 * sentinel rather than `undefined`.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types";

export async function clearAllRegimeStatusForCountry(
  db: Db,
  countryId: CountryId
): Promise<{ modifiedCount: number }> {
  const result = await db
    .collection<PoliticalParty>("politicalParties")
    .updateMany({ countryId }, { $set: { regimeStatus: null, updatedAt: new Date() } });
  return { modifiedCount: result.modifiedCount ?? 0 };
}
