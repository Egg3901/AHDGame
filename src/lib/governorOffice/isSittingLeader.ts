import type { Db } from "mongodb";
import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getHeadOfGovernmentCharacterId } from "@/lib/api/headOfGovernment";

/**
 * Returns true if `characterId` is the sitting head of government for `countryId`.
 *
 * Delegates to {@link getHeadOfGovernmentCharacterId} which walks the
 * canonical resolution chain (governmentFormations → legacy
 * parliamentaryGovernments → officials for presidential). Going through
 * the helper ensures admin-formed governments (CN's "Formed Via Admin"
 * Premier) and any other path that writes to `governmentFormations`
 * register as the sitting leader, instead of being missed by a direct
 * read of the legacy `parliamentaryGovernments` collection.
 *
 * Used by the federal Executive Order, National Address, and Phase-7
 * regime endpoints to gate issuance regardless of country type.
 */
export async function isSittingLeader(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<boolean> {
  const hogId = await getHeadOfGovernmentCharacterId(db, countryId);
  return !!hogId && hogId.equals(characterId);
}
