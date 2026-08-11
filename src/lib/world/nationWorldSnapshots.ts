/**
 * Live executive + lower-chamber plurality data for the /world nation cards.
 * Kept in lib so the world page can call it from a server component without self-HTTP.
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId, isParliamentarySystem } from "@/lib/constants/countries";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { NPP } from "@/lib/db/types/npp";
import { getHouseComposition } from "@/lib/congress/houseComposition";
import { getPartyMap } from "@/lib/db/partyMap";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { tallySeatsByParty, getLargestParty } from "@/lib/turn/parliamentaryGovernment";

export type NationExecutiveSnapshot = {
  name: string;
  avatarUrl: string | null;
  borderKey: string | null;
  tintColor: string | null;
  isNpp: boolean;
  sequentialId: number | null;
  nppSequentialId: number | null;
  isVacant: boolean;
};

export type NationLegislaturePartySnapshot = {
  /** Sequential ID string — matches PartyLogo / party routes */
  partySequentialId: string;
  partyName: string;
  partyColor: string;
};

export type NationWorldSnapshot = {
  executive: NationExecutiveSnapshot;
  legislatureParty: NationLegislaturePartySnapshot | null;
};

async function resolvePresidentExecutive(db: Db): Promise<NationExecutiveSnapshot> {
  // World snapshot's "President" branch is invoked only for US per
  // snapshotForCountry's countryId === usId guard. The lookup is scoped
  // explicitly so it cannot resolve to CN's ceremonial President row
  // (auto-populated from CCP.chairId) or any other future country's
  // president officeType.
  const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
    countryId: "US",
    officeType: "president",
  });
  if (!official?.characterId && !(official?.isNPP && official.nppId)) {
    return {
      name: "Vacant",
      avatarUrl: null,
      borderKey: null,
      tintColor: null,
      isNpp: false,
      sequentialId: null,
      nppSequentialId: null,
      isVacant: true,
    };
  }

  if (official.characterId) {
    const char = await db
      .collection<Character>("characters")
      .findOne({ _id: official.characterId });
    if (char) {
      return {
        name: char.name,
        avatarUrl: char.avatarUrl ?? null,
        borderKey: char.borderKey ?? null,
        tintColor: char.tintColor ?? null,
        isNpp: false,
        sequentialId: char.sequentialId ?? null,
        nppSequentialId: null,
        isVacant: false,
      };
    }
  }

  if (official.isNPP && official.nppId) {
    const npp = await db.collection<NPP>("npps").findOne({ _id: official.nppId });
    if (npp) {
      return {
        name: npp.name,
        avatarUrl: npp.avatarUrl ?? null,
        borderKey: npp.borderKey ?? null,
        tintColor: npp.tintColor ?? null,
        isNpp: true,
        sequentialId: null,
        nppSequentialId: npp.sequentialId ?? null,
        isVacant: false,
      };
    }
  }

  return {
    name: "Vacant",
    avatarUrl: null,
    borderKey: null,
    tintColor: null,
    isNpp: false,
    sequentialId: null,
    nppSequentialId: null,
    isVacant: true,
  };
}

async function resolveParliamentaryExecutive(
  db: Db,
  countryId: CountryId
): Promise<NationExecutiveSnapshot> {
  const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!gov?.pmCharacterId) {
    return {
      name: "Vacant",
      avatarUrl: null,
      borderKey: null,
      tintColor: null,
      isNpp: false,
      sequentialId: null,
      nppSequentialId: null,
      isVacant: true,
    };
  }

  const char = await db.collection<Character>("characters").findOne({ _id: gov.pmCharacterId });
  if (!char) {
    return {
      name: gov.pmName ?? "Vacant",
      avatarUrl: null,
      borderKey: null,
      tintColor: null,
      isNpp: false,
      sequentialId: null,
      nppSequentialId: null,
      isVacant: true,
    };
  }

  return {
    name: gov.pmName ?? char.name,
    avatarUrl: char.avatarUrl ?? null,
    borderKey: char.borderKey ?? null,
    tintColor: char.tintColor ?? null,
    isNpp: false,
    sequentialId: char.sequentialId ?? null,
    nppSequentialId: null,
    isVacant: false,
  };
}

async function legislaturePartyFromSequentialId(
  db: Db,
  countryId: CountryId,
  partySequentialId: string | null
): Promise<NationLegislaturePartySnapshot | null> {
  if (!partySequentialId || partySequentialId === "__vacant__") return null;
  if (partySequentialId === "independent") {
    return {
      partySequentialId: "independent",
      partyName: "Independent",
      partyColor: "#9CA3AF",
    };
  }
  const party = await findPartyBySequentialId(db, partySequentialId, countryId);
  if (!party) return null;
  return {
    partySequentialId: String(party.sequentialId),
    partyName: party.name,
    partyColor: party.color,
  };
}

async function snapshotForCountry(db: Db, countryId: CountryId): Promise<NationWorldSnapshot> {
  const config = COUNTRY_CONFIGS[countryId];
  const usId = COUNTRY_CONFIGS.US.id;

  if (countryId === usId) {
    const [executive, partyMap] = await Promise.all([
      resolvePresidentExecutive(db),
      getPartyMap(db, usId),
    ]);
    const houseComposition = await getHouseComposition(db, partyMap);
    const legislatureParty = await legislaturePartyFromSequentialId(
      db,
      usId,
      houseComposition.majorityParty
    );
    return { executive, legislatureParty };
  }

  if (isParliamentarySystem(config)) {
    const [executive, gov, seatsByParty] = await Promise.all([
      resolveParliamentaryExecutive(db, countryId),
      getGovernmentFormationsCollection(db).findOne({ _id: countryId }),
      tallySeatsByParty(db, countryId),
    ]);

    let legSeq: string | null = null;
    if (gov && gov.status !== "collapsed" && gov.governingPartyId) {
      legSeq = gov.governingPartyId;
    } else {
      legSeq = getLargestParty(seatsByParty);
    }

    const legislatureParty = await legislaturePartyFromSequentialId(db, countryId, legSeq);
    return { executive, legislatureParty };
  }

  return {
    executive: {
      name: "—",
      avatarUrl: null,
      borderKey: null,
      tintColor: null,
      isNpp: false,
      sequentialId: null,
      nppSequentialId: null,
      isVacant: true,
    },
    legislatureParty: null,
  };
}

export async function getNationWorldSnapshots(
  db: Db
): Promise<Record<CountryId, NationWorldSnapshot>> {
  // Build for every REGISTERED country (COUNTRY_ORDER ∪ runtime-activated SCO/WAL)
  // so a seceded nation's /world card has a snapshot — matching getAllCountryAccess.
  const ids = await getRegisteredCountryIds(db);
  const entries = await Promise.all(
    ids.map(async (id) => [id, await snapshotForCountry(db, id)] as const)
  );
  return Object.fromEntries(entries) as Record<CountryId, NationWorldSnapshot>;
}
