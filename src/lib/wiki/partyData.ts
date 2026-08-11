/**
 * Party data for wiki party pages.
 */
import { getDb } from "@/lib/mongodb";
import type { Filter } from "mongodb";
import type { PoliticalParty, ElectedOfficial } from "@/lib/db/types";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { CountryId } from "@/lib/constants/countries";

export interface PartyData {
  id: string;
  countryId: CountryId;
  name: string;
  abbreviation: string;
  color: string;
  memberCount: number;
  economicPosition: number;
  socialPosition: number;
  seatCounts: {
    senate: number;
    house: number;
    governor: number;
    president: number;
    vicePresident: number;
  };
}

export async function getAllPartySlugs(): Promise<{ id: string; countryId: CountryId }[]> {
  const db = await getDb();
  const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
  // Include countryId to disambiguate parties with same sequential ID across countries
  return parties.map((p) => ({ id: String(p.sequentialId), countryId: p.countryId ?? "US" }));
}

export async function getPartyData(
  id: string,
  countryId: CountryId = "US"
): Promise<PartyData | null> {
  const db = await getDb();
  const partyCountryQuery: Filter<PoliticalParty> =
    countryId === COUNTRY_CONFIGS.US.id
      ? { $or: [{ countryId: COUNTRY_CONFIGS.US.id }, { countryId: { $exists: false } }] }
      : { countryId };
  const officialCountryQuery: Filter<ElectedOfficial> =
    countryId === COUNTRY_CONFIGS.US.id
      ? { $or: [{ countryId: COUNTRY_CONFIGS.US.id }, { countryId: { $exists: false } }] }
      : { countryId };

  // Filter by both sequentialId and countryId to avoid cross-country collisions.
  const party = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ sequentialId: Number(id), ...partyCountryQuery });
  if (!party) return null;

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ party: id, ...officialCountryQuery })
    .toArray();

  let senate = 0;
  let house = 0;
  let governor = 0;
  let president = 0;
  let vicePresident = 0;
  for (const o of officials) {
    if (o.officeType === "senate") senate++;
    else if (o.officeType === "house") house++;
    else if (o.officeType === "governor") governor++;
    else if (o.officeType === "president") president++;
    else if (o.officeType === "vicePresident") vicePresident++;
  }

  return {
    id: String(party.sequentialId),
    countryId: party.countryId ?? "US",
    name: party.name,
    abbreviation: party.abbreviation,
    color: party.color,
    memberCount: party.memberCount ?? 0,
    economicPosition: party.economicPosition ?? 0,
    socialPosition: party.socialPosition ?? 0,
    seatCounts: { senate, house, governor, president, vicePresident },
  };
}
