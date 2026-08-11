import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryConfig } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { isSittingLeader } from "@/lib/governorOffice/isSittingLeader";

/**
 * Authority gate for National Corporation management (appoint CEO, split off /
 * merge back sector types — spec §24.4).
 *
 * The seated finance-minister-equivalent per country (`financeMinisterCabinetId`:
 * US `secretary_of_treasury`, UK `chancellor`, DE `finance_minister`, …) may act.
 * If that seat is **vacant** or the country has **no such portfolio**, the head
 * of government (`isSittingLeader`) may act instead — so no country is ever
 * locked out. Generalizes the Phase-1 `isSittingLeader` gate; it does not
 * replace the executive-nationalize route's own head-of-government check.
 */
export async function assertTreasuryAuthority(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<boolean> {
  const positionId = getCountryConfig(countryId).financeMinisterCabinetId;

  if (positionId) {
    // Cabinet seats live in the `cabinetMembers` collection (one doc per active
    // appointment) — NOT `unifiedCabinetMembers`, which is never written.
    const seat = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
    const holder = seat?.characterId ?? null;
    // Seat is filled: only the seated finance minister is authorized.
    if (holder) return holder.equals(characterId);
  }

  // No finance portfolio, or the seat is vacant → head of government may act.
  return isSittingLeader(db, countryId, characterId);
}
