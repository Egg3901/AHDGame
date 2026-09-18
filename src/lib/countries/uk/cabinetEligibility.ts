import { getCabinetEligibleOfficeTypes } from "@/lib/legislature/chamberOfficeType";
import { ObjectId, type Db } from "mongodb";
import { forbidden } from "@/lib/api/errors";
import { getCountryState } from "@/lib/countryState";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import {
  getCabinetEligibleChamberKeys as resolveCabinetEligibleChamberKeys,
  getCountryConfig,
  type CountryId,
} from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import type {
  Character,
  ElectedOfficial,
  ParliamentaryGovernment,
  PoliticalParty,
} from "@/lib/db/types";

export interface CabinetEligibleCharacter {
  _id: string;
  name: string;
  party?: string;
  partyName?: string;
  avatarUrl?: string;
  constituency: string;
  chamberName?: string;
  sequentialId?: number | null;
}

/** @deprecated Use CabinetEligibleCharacter instead */
export type UKCabinetEligibleCharacter = CabinetEligibleCharacter;

function normalizeCabinetChamberDisplayName(name: string): string {
  if (name === "ShÅ«giin") return "Shūgiin";
  return name;
}

export function getCabinetEligibleChamberKeys(countryId: CountryId): string[] {
  return resolveCabinetEligibleChamberKeys(getCountryConfig(countryId));
}

export function getCabinetEligibleChamberLabel(countryId: CountryId): string {
  const config = getCountryConfig(countryId);
  const eligibleKeys = getCabinetEligibleChamberKeys(countryId);

  const chamberNames = eligibleKeys
    .map((key) => {
      if (key === config.legislature.lowerChamber.key) {
        return normalizeCabinetChamberDisplayName(config.legislature.lowerChamber.name);
      }
      if (config.legislature.upperChamber && key === config.legislature.upperChamber.key) {
        return normalizeCabinetChamberDisplayName(config.legislature.upperChamber.name);
      }
      return normalizeCabinetChamberDisplayName(key);
    })
    .filter((name, index, names) => names.indexOf(name) === index);

  if (chamberNames.length === 1) return chamberNames[0] ?? config.legislature.lowerChamber.name;
  if (chamberNames.length === 2) return `${chamberNames[0]} or ${chamberNames[1]}`;
  return chamberNames.join(", ");
}

function getOfficialChamberName(countryId: CountryId, officeType: string): string {
  const config = getCountryConfig(countryId);

  // For countries where officeType differs from chamber key (e.g. CN npcDelegate),
  // resolve back to the chamber key first, then to the display name.
  const officeDef = config.officeTypes.find((o) => "chamberKey" in o && o.key === officeType);
  const resolvedChamberKey = officeDef?.chamberKey ?? officeType;

  if (resolvedChamberKey === config.legislature.lowerChamber.key)
    return normalizeCabinetChamberDisplayName(config.legislature.lowerChamber.name);
  if (config.legislature.upperChamber && resolvedChamberKey === config.legislature.upperChamber.key)
    return normalizeCabinetChamberDisplayName(config.legislature.upperChamber.name);
  return normalizeCabinetChamberDisplayName(officeType);
}

/**
 * Verify the caller is the current PM for the given parliamentary country.
 * governmentFormations is canonical. Only consults legacy parliamentaryGovernments
 * when the canonical document is missing entirely — never when its pmCharacterId is
 * null (that state is meaningful: e.g. immediately after a no-confidence vote passes).
 */
export async function requireCurrentPrimeMinister(
  db: Db,
  countryId: CountryId,
  authUserId: string,
  errorMessage: string
): Promise<{ pmCharacterId: ObjectId; pmCharacter: Character; countryId: CountryId }> {
  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  let pmCharId: ObjectId | null = govFormation ? (govFormation.pmCharacterId ?? null) : null;
  if (!govFormation) {
    const legacy = await db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .findOne({ _id: countryId as string });
    pmCharId = legacy?.pmCharacterId ?? null;
  }

  if (!pmCharId) {
    throw forbidden("No active government or Prime Minister");
  }

  if (!ObjectId.isValid(authUserId)) {
    throw forbidden(errorMessage);
  }

  const pmCharacter = await db.collection<Character>("characters").findOne({
    userId: new ObjectId(authUserId),
  });

  if (!pmCharacter || !pmCharacter._id.equals(pmCharId)) {
    throw forbidden(errorMessage);
  }

  return { pmCharacterId: pmCharId, pmCharacter, countryId };
}

/**
 * Get eligible cabinet candidates for any parliamentary country.
 * Returns lower-chamber player-character MPs who are not the PM and not already in cabinet.
 */
export async function getEligibleCabinetCharacters(
  db: Db,
  countryId: CountryId,
  pmCharacterId: ObjectId
): Promise<CabinetEligibleCharacter[]> {
  const runtime = await getCountryState(db, countryId);
  const isOps = runtime.governmentType === "onePartyState";
  const config = getCountryConfig(countryId);
  const eligibleOfficeTypes = getCabinetEligibleOfficeTypes(countryId);

  // Eligible-chamber officials drive the non-OPS candidate set and supply
  // chamber/constituency display for legislators in both modes.
  const eligibleOfficials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      officeType: { $in: eligibleOfficeTypes },
      countryId,
    })
    .toArray();

  const officialByCharacterId = new Map<string, ElectedOfficial>();
  for (const official of eligibleOfficials) {
    if (official.characterId) {
      officialByCharacterId.set(official.characterId.toString(), official);
    }
  }

  const existingMembers = await getCabinetMembersCollection(db).find({ countryId }).toArray();
  // NPP-held seats carry a null characterId — only player holders block re-appointment.
  const existingCharacterIds = new Set(
    existingMembers
      .filter((member) => member.characterId)
      .map((member) => member.characterId!.toString())
  );

  // Party lookup: name for display + regimeStatus for OPS banned-party filtering.
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId })
    .project({ sequentialId: 1, name: 1, regimeStatus: 1 })
    .toArray();
  const partyNameBySeqId = new Map(parties.map((p) => [String(p.sequentialId), p.name]));
  const partyBySeqId = new Map(parties.map((p) => [String(p.sequentialId), p]));

  // OPS governments may appoint any player citizen; everyone else is limited to
  // eligible-chamber legislators. See 2026-06-05-ops-cabinet-any-player-design.md.
  let characters: Character[];
  if (isOps) {
    characters = await db
      .collection<Character>("characters")
      .find({ countryId, userId: { $exists: true } })
      .toArray();
  } else {
    // PM can appoint any eligible seated player regardless of party.
    const characterIds = [
      ...new Set(
        eligibleOfficials
          .filter((official) => official.characterId && !official.characterId.equals(pmCharacterId))
          .map((official) => official.characterId!.toString())
      ),
    ].map((id) => new ObjectId(id));

    if (characterIds.length === 0) {
      return [];
    }

    characters = await db
      .collection<Character>("characters")
      .find({
        _id: { $in: characterIds },
        userId: { $exists: true },
      })
      .toArray();
  }

  return characters
    .filter((character) => !character._id.equals(pmCharacterId))
    .filter((character) => !existingCharacterIds.has(character._id.toString()))
    .filter((character) => {
      if (!isOps) return true;
      const party = partyBySeqId.get(String(character.party));
      return !isBannedParty(config, party ?? null);
    })
    .map((character) => {
      const official = officialByCharacterId.get(character._id.toString());
      const partyId = official?.party ?? character.party;

      return {
        _id: character._id.toString(),
        name: character.name,
        party: partyId,
        partyName: partyId ? partyNameBySeqId.get(String(partyId)) : undefined,
        avatarUrl: character.avatarUrl,
        constituency: official?.state ? `Constituency ${official.state}` : "Unknown Constituency",
        chamberName: official ? getOfficialChamberName(countryId, official.officeType) : undefined,
        sequentialId: character.sequentialId,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
