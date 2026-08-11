import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, Character, NPP, PoliticalParty } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface ExecutiveHolder {
  /** Character _id or NPP _id (whichever backs the seat), as a string. */
  id: string;
  /** Character _id string when character-backed; "" when NPP-backed. */
  characterId: string;
  sequentialId?: number;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  countryId: CountryId;
  avatarUrl?: string;
  isNPP: boolean;
  administrationStartDate: string | null;
}

/**
 * Resolve an executive `ElectedOfficial` (president / VP) into a uniform holder,
 * whether it is held by a Character (`characterId`) or an NPP (`nppId`).
 * Returns null when the official is null or neither id resolves — the caller
 * renders "Vacant" in that case.
 */
export async function resolveExecutiveHolder(
  db: Db,
  official: ElectedOfficial | null
): Promise<ExecutiveHolder | null> {
  if (!official) return null;
  const countryId = (official.countryId ?? "US") as CountryId;
  const administrationStartDate = official.electedAt?.toISOString() ?? null;

  const lookupParty = async (party: string | undefined) => {
    if (!party) return { name: undefined, color: undefined };
    const p = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(party), countryId });
    return { name: p?.name, color: p?.color };
  };

  if (official.characterId) {
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: official.characterId });
    if (!char) return null;
    const { name, color } = await lookupParty(char.party);
    return {
      id: char._id.toString(),
      characterId: char._id.toString(),
      sequentialId: char.sequentialId,
      characterName: char.name,
      party: char.party,
      partyName: name ?? char.party,
      partyColor: color,
      countryId,
      avatarUrl: char.avatarUrl,
      isNPP: false,
      administrationStartDate,
    };
  }

  if (official.nppId) {
    const npp = await db.collection<NPP>("npps").findOne({ _id: official.nppId });
    if (!npp) return null;
    const { name, color } = await lookupParty(npp.party);
    return {
      id: npp._id.toString(),
      characterId: "",
      sequentialId: npp.sequentialId,
      characterName: npp.name,
      party: npp.party,
      partyName: name ?? npp.party,
      partyColor: color,
      countryId,
      avatarUrl: npp.avatarUrl,
      isNPP: true,
      administrationStartDate,
    };
  }

  return null;
}
