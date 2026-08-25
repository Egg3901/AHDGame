/**
 * Who may act for a delegation.
 *
 * Mirrors `loadViewerOrganizationRoles` in the IntOrg feature deliberately: the
 * same two offices carry a nation's voice abroad, and the two features should
 * not disagree about who holds them.
 *
 * A seat is exercisable by its country's head of government, its foreign
 * minister, and its defence minister. They share one budget — the SEAT is
 * rate-limited, not the person — so which of the three acted matters only for
 * the audit trail.
 *
 * One-party states resolve correctly through `findCountryHeadedBy`: DD and RU
 * seat their General Secretary / Premier through `governmentFormations`, the
 * same row a parliamentary PM uses, so the non-presidential branch covers them.
 */
import type { Db, ObjectId } from "mongodb";
import { SETTLEMENT_SEATS, type SettlementSeatKey } from "@/lib/constants/settlementCrisis";
import { FOREIGN_AFFAIRS_POSITION_BY_COUNTRY } from "@/lib/constants/internationalOrganizations";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { findCountryHeadedBy } from "@/lib/api/headOfGovernment";

export type SettlementSeatRole = "headOfGovernment" | "foreignMinister" | "defenseMinister";

export interface SettlementSeatClaim {
  seatId: SettlementSeatKey;
  role: SettlementSeatRole;
}

/** The four delegation countries. Seat ids are country ids for all of them. */
const SEAT_COUNTRIES: readonly SettlementSeatKey[] = SETTLEMENT_SEATS.map((s) => s.id);

function seatFor(countryId: string | null): SettlementSeatKey | null {
  if (!countryId) return null;
  return SEAT_COUNTRIES.find((s) => s === countryId) ?? null;
}

/**
 * The delegation this character may act for, or null.
 *
 * Head of government wins when a character somehow holds both offices, so the
 * claim is stable rather than depending on query order.
 */
export async function resolveSettlementSeat(
  db: Db,
  characterId: ObjectId
): Promise<SettlementSeatClaim | null> {
  const headedCountry = await findCountryHeadedBy(db, characterId);
  const headedSeat = seatFor(headedCountry);
  if (headedSeat) return { seatId: headedSeat, role: "headOfGovernment" };

  // ONE query over the exact (country, position) pairs rather than a findOne per
  // seat. IntOrg's equivalent walks every country in the world sequentially;
  // there are only four here, but this is on the dossier's load path and an
  // exact `$or` costs the same as a single lookup.
  //
  // `$or` of pairs rather than `$in` on each field: RU and DD share the position
  // id `minister_of_foreign_affairs`, so crossing the two lists would match a
  // pairing that does not exist.
  const foreignPairs = SEAT_COUNTRIES.flatMap((seatId) => {
    const positionId = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[seatId as CountryId];
    return positionId ? [{ countryId: seatId, positionId }] : [];
  });
  const defensePairs = SEAT_COUNTRIES.flatMap((seatId) => {
    const positionId = DEFENSE_POSITION_BY_COUNTRY[seatId as CountryId];
    return positionId ? [{ countryId: seatId, positionId }] : [];
  });
  const pairs = [...foreignPairs, ...defensePairs];
  if (pairs.length === 0) return null;

  const member = await getCabinetMembersCollection(db).findOne({
    characterId,
    $or: pairs,
  });
  if (!member) return null;
  const ministerSeat = seatFor(member.countryId ?? null);
  if (!ministerSeat) return null;
  const foreignPosition = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[ministerSeat as unknown as CountryId];
  if (member.positionId === foreignPosition) {
    return { seatId: ministerSeat, role: "foreignMinister" };
  }
  const defensePosition = DEFENSE_POSITION_BY_COUNTRY[ministerSeat as unknown as CountryId];
  if (member.positionId === defensePosition) {
    return { seatId: ministerSeat, role: "defenseMinister" };
  }
  return { seatId: ministerSeat, role: "foreignMinister" };
}
