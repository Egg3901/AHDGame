import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { Character, NPP } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import type { ElectedOfficial } from "@/lib/db/types/officials";
import type { ParliamentaryGovernment } from "@/lib/db/types/parliamentaryGovernment";
import { getCountryState, primeCountryStates } from "@/lib/countryState";

export interface PolicyHeadSponsor {
  _id: ObjectId;
  name: string;
  party?: string;
  isNpp: boolean;
}

/** Load the policy head for many countries with bounded reads. */
export async function loadPolicyHeadSponsors(
  db: Db,
  countryIds: CountryId[]
): Promise<Map<CountryId, PolicyHeadSponsor>> {
  if (countryIds.length === 0) return new Map();
  await primeCountryStates(db, countryIds);
  const states = await Promise.all(countryIds.map((countryId) => getCountryState(db, countryId)));
  const presidential = new Set(
    states
      .filter((state) => state.governmentType === "presidential")
      .map((state) => state.countryId)
  );

  const [formations, presidents, legacyGovernments] = await Promise.all([
    db
      .collection<GovernmentFormation>("governmentFormations")
      .find({ _id: { $in: countryIds }, status: "formed" })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: { $in: [...presidential] },
        officeType: "president",
        characterId: { $ne: null },
      })
      .toArray(),
    db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .find({ _id: { $in: countryIds.filter((countryId) => !presidential.has(countryId)) } })
      .toArray(),
  ]);

  const formationByCountry = new Map(
    formations.map((formation) => [formation.countryId, formation])
  );
  const presidentByCountry = new Map(
    presidents
      .filter((president): president is ElectedOfficial & { characterId: ObjectId } =>
        Boolean(president.characterId)
      )
      .map((president) => [president.countryId as CountryId, president.characterId])
  );
  const legacyByCountry = new Map(
    legacyGovernments.map((government) => [government._id as CountryId, government.pmCharacterId])
  );

  const playerHeadByCountry = new Map<CountryId, ObjectId>();
  const nppHeadByCountry = new Map<CountryId, ObjectId>();
  for (const countryId of countryIds) {
    const formation = formationByCountry.get(countryId);
    const playerHead = presidential.has(countryId)
      ? presidentByCountry.get(countryId)
      : (formation?.pmCharacterId ?? legacyByCountry.get(countryId));
    if (playerHead) {
      playerHeadByCountry.set(countryId, playerHead);
      continue;
    }
    const nppHead = formation?.presidentNppId ?? formation?.pmNppId ?? null;
    if (nppHead) nppHeadByCountry.set(countryId, nppHead);
  }

  const [characters, npps] = await Promise.all([
    db
      .collection<Character>("characters")
      .find(
        { _id: { $in: [...playerHeadByCountry.values()] } },
        { projection: { _id: 1, name: 1, party: 1 } }
      )
      .toArray(),
    db
      .collection<NPP>("npps")
      .find(
        { _id: { $in: [...nppHeadByCountry.values()] } },
        { projection: { _id: 1, name: 1, party: 1 } }
      )
      .toArray(),
  ]);
  const charactersById = new Map(
    characters.map((character) => [character._id.toString(), character])
  );
  const nppsById = new Map(npps.map((npp) => [npp._id.toString(), npp]));

  const result = new Map<CountryId, PolicyHeadSponsor>();
  for (const [countryId, characterId] of playerHeadByCountry) {
    const character = charactersById.get(characterId.toString());
    if (!character) continue;
    result.set(countryId, {
      _id: character._id,
      name: character.name ?? "Head of Government",
      party: character.party ? character.party.toString() : undefined,
      isNpp: false,
    });
  }
  for (const [countryId, nppId] of nppHeadByCountry) {
    const npp = nppsById.get(nppId.toString());
    if (!npp) continue;
    result.set(countryId, {
      _id: npp._id,
      name: npp.name,
      party: npp.party,
      isNpp: true,
    });
  }
  return result;
}
