/**
 * Who reviews a merger in this country, this era, and are they anybody?
 *
 * The seat id is fixed per country; its NAME moves with the era (the UK seat is
 * the Board of Trade in 1953 and Business and Trade in 2024). A seat that exists
 * but is vacant, or is held by an NPP, still produces a valid authority — the
 * review just runs to its deadline and resolves on the published bands rather
 * than on a player's judgement.
 *
 * Holders come from `cabinetMembers`, the unified SSOT for active appointments,
 * not from `character.currentOffice` (which a cabinet appointment overwrites and
 * which the NPP-held case leaves empty).
 */

import type { Db, ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { isSeatActive, resolveSeatName } from "@/lib/cabinet/rosterEra";
import { MERGER_AUTHORITY_SEAT_BY_COUNTRY } from "./constants";

export interface MergerAuthority {
  seatId: string;
  /** Era-correct display name for the seat. */
  seatName: string;
  countryId: string;
  /** The seated officeholder, when a CHARACTER holds the seat. */
  holderCharacterId?: ObjectId;
  holderName?: string;
  /** The player behind the officeholder, when a player holds the seat. */
  holderUserId?: ObjectId;
  /** True when an NPP holds the seat — nobody to prompt, deadline decides. */
  holderIsNpp?: boolean;
}

/**
 * Resolve the reviewing authority. Returns null when the country has no such
 * seat, or the seat does not exist yet in this year — in which case there is
 * nobody to refer to and merger review does not apply.
 */
export async function resolveMergerAuthority(
  db: Db,
  countryId: string,
  currentYear: number | null
): Promise<MergerAuthority | null> {
  const seatId = MERGER_AUTHORITY_SEAT_BY_COUNTRY[countryId as CountryId];
  if (!seatId) return null;

  const position = getCabinetPositions(countryId).find((p) => p.id === seatId);
  if (!position || !isSeatActive(position, currentYear)) return null;

  const authority: MergerAuthority = {
    seatId,
    seatName: resolveSeatName(position, currentYear),
    countryId,
  };

  const member = await db
    .collection<UnifiedCabinetMember>("cabinetMembers")
    .findOne(
      { countryId: countryId as CountryId, positionId: seatId },
      { projection: { characterId: 1, characterName: 1, isNPP: 1 } }
    );
  if (!member) return authority;

  if (member.isNPP || !member.characterId) {
    authority.holderIsNpp = true;
    authority.holderName = member.characterName;
    return authority;
  }

  authority.holderCharacterId = member.characterId;
  authority.holderName = member.characterName;
  const holder = await db
    .collection<Character>("characters")
    .findOne({ _id: member.characterId }, { projection: { userId: 1 } });
  if (holder?.userId) authority.holderUserId = holder.userId;
  return authority;
}
