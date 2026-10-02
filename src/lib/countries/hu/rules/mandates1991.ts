/**
 * Hungarian deputies take one mandate per person. Constituency winners leave
 * both lists; territorial winners leave the national list. NPC slate members
 * share their existing financial owner without becoming duplicate characters.
 */
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import type { Hu1991MixedCount } from "./mixedElection1991";

export interface Hu1991Person {
  id: string;
  /** Existing candidate row used for campaigning and financial ownership. */
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  partyId: string;
  regionId: string;
}
export interface Hu1991Nominations {
  people: readonly Hu1991Person[];
  constituencies: readonly { id: string; candidateIds: readonly string[] }[];
  territorial: readonly {
    id: string;
    lists: readonly { partyId: string; candidateIds: readonly string[] }[];
  }[];
  national: readonly { partyId: string; candidateIds: readonly string[] }[];
}
export interface Hu1991Mandate {
  personId: string;
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  partyId: string;
  regionId: string;
  tier: "constituency" | "territorial" | "national";
  districtId: string;
}
export interface Hu1991InstalledMandates {
  mandates: Hu1991Mandate[];
  vacancies: Array<{ tier: Hu1991Mandate["tier"]; districtId: string; partyId: string | null }>;
  candidateSeats: Record<string, number>;
  partySeats: Record<string, number>;
  regionCapacity: Record<string, number>;
}

/** Validate filed people before ballots or withdrawals can alter a list. */
export function validateHu1991Nominations(nominations: Hu1991Nominations): void {
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const playerOwners = new Set<string>();
  const candidateOwners = new Map<string, string>();
  if (people.size !== nominations.people.length) throw new Error("Duplicated Hungarian person");
  const regions = new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId));
  for (const person of people.values()) {
    if (
      !person.id ||
      !person.candidateId ||
      !person.ownerId ||
      !person.partyId ||
      !regions.has(person.regionId)
    )
      throw new Error("Invalid Hungarian nominee identity");
    const ownerKey = `${person.isNpc ? "npc" : "player"}:${person.ownerId}`;
    const candidateOwner = candidateOwners.get(person.candidateId);
    if (candidateOwner && candidateOwner !== ownerKey)
      throw new Error("Hungarian candidate changes financial owner");
    candidateOwners.set(person.candidateId, ownerKey);
    if (!person.isNpc) {
      if (playerOwners.has(person.ownerId))
        throw new Error("One Hungarian player has multiple person identities");
      playerOwners.add(person.ownerId);
    }
  }
  const districtMap = new Map(HU_1991_CONSTITUENCIES.map((row) => [row.id, row]));
  const countyMap = new Map(HU_1991_TERRITORIAL_DISTRICTS.map((row) => [row.id, row]));
  const directPeople = new Set<string>(),
    countyPeople = new Set<string>(),
    nationalPeople = new Set<string>();
  const countyNominations = new Map<string, Map<string, number>>();
  if (
    nominations.constituencies.length !== 176 ||
    new Set(nominations.constituencies.map((row) => row.id)).size !== 176 ||
    nominations.territorial.length !== 20 ||
    new Set(nominations.territorial.map((row) => row.id)).size !== 20
  )
    throw new Error("Hungarian nominations require 176 constituencies and 20 counties");
  for (const row of nominations.constituencies) {
    const district = districtMap.get(row.id);
    if (!district) throw new Error("Unknown Hungarian constituency");
    const parties = new Set<string>();
    for (const id of row.candidateIds) {
      const person = people.get(id);
      if (!person || person.regionId !== district.regionId || directPeople.has(id))
        throw new Error(
          "Hungarian constituency nominee is unknown, duplicated or outside their region"
        );
      directPeople.add(id);
      if (person.partyId !== "independent") {
        if (parties.has(person.partyId))
          throw new Error("A Hungarian party nominates one person per constituency");
        parties.add(person.partyId);
        const counts = countyNominations.get(district.countyId) ?? new Map<string, number>();
        counts.set(person.partyId, (counts.get(person.partyId) ?? 0) + 1);
        countyNominations.set(district.countyId, counts);
      }
    }
  }
  const filedCounties = new Map<string, number>();
  for (const row of nominations.territorial) {
    const county = countyMap.get(row.id);
    if (!county) throw new Error("Unknown Hungarian territorial district");
    const parties = new Set<string>();
    for (const list of row.lists) {
      if (
        !list.partyId ||
        list.partyId === "independent" ||
        parties.has(list.partyId) ||
        list.candidateIds.length === 0 ||
        list.candidateIds.length > 2 * county.territorialSeats
      )
        throw new Error("Invalid Hungarian territorial list identity or capacity");
      parties.add(list.partyId);
      if (
        (countyNominations.get(county.id)?.get(list.partyId) ?? 0) <
        county.minimumConstituencyNominees
      )
        throw new Error("Hungarian territorial list lacks statutory constituency nominees");
      filedCounties.set(list.partyId, (filedCounties.get(list.partyId) ?? 0) + 1);
      for (const id of list.candidateIds) {
        const person = people.get(id);
        if (
          !person ||
          person.partyId !== list.partyId ||
          person.regionId !== county.regionId ||
          countyPeople.has(id)
        )
          throw new Error(
            "Hungarian territorial nominee is unknown, duplicated or belongs to another party or region"
          );
        countyPeople.add(id);
      }
    }
  }
  const nationalParties = new Set<string>();
  for (const list of nominations.national) {
    if (
      !list.partyId ||
      list.partyId === "independent" ||
      nationalParties.has(list.partyId) ||
      list.candidateIds.length === 0 ||
      list.candidateIds.length > 116 ||
      (filedCounties.get(list.partyId) ?? 0) < 7
    )
      throw new Error("Invalid Hungarian national list identity, capacity or territorial filings");
    nationalParties.add(list.partyId);
    for (const id of list.candidateIds) {
      const person = people.get(id);
      if (!person || person.partyId !== list.partyId || nationalPeople.has(id))
        throw new Error(
          "Hungarian national nominee is unknown, duplicated or belongs to another party"
        );
      nationalPeople.add(id);
    }
  }
}

/**
 * Keep the certified tier totals fixed. If a filed list exhausts its available
 * people, record the unfilled mandates explicitly rather than seat a player
 * twice, invent nominees or transfer a personal constituency win to a party.
 */
export function settleHu1991Mandates(
  count: Extract<Hu1991MixedCount, { kind: "counted" }>,
  nominations: Hu1991Nominations,
  unavailableIds: ReadonlySet<string> = new Set()
): Hu1991InstalledMandates {
  validateHu1991Nominations(nominations);
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const seated = new Set<string>();
  const mandates: Hu1991Mandate[] = [];
  const vacancies: Hu1991InstalledMandates["vacancies"] = [];
  const countyMap = new Map(HU_1991_TERRITORIAL_DISTRICTS.map((row) => [row.id, row]));
  const candidateSeats = Object.fromEntries(nominations.people.map((row) => [row.candidateId, 0]));
  const partySeats: Record<string, number> = {};
  const regionCapacity: Record<string, number> = Object.fromEntries(
    HU_1991_TERRITORIAL_DISTRICTS.map((row) => [row.regionId, 0])
  );
  const install = (
    personId: string,
    tier: Hu1991Mandate["tier"],
    districtId: string,
    regionId: string
  ): boolean => {
    const person = people.get(personId);
    if (!person) throw new Error("Certified Hungarian winner is absent from the filed slate");
    if (seated.has(personId) || unavailableIds.has(personId)) return false;
    seated.add(personId);
    mandates.push({ ...person, personId, tier, districtId, regionId });
    candidateSeats[person.candidateId]++;
    partySeats[person.partyId] = (partySeats[person.partyId] ?? 0) + 1;
    return true;
  };
  for (const district of HU_1991_CONSTITUENCIES) {
    regionCapacity[district.regionId]++;
    if (!Object.prototype.hasOwnProperty.call(count.constituencyWinners, district.id))
      throw new Error("Incomplete certified Hungarian constituency count");
    const winner = count.constituencyWinners[district.id];
    const filed = nominations.constituencies.find((row) => row.id === district.id)!;
    if (winner && !filed.candidateIds.includes(winner))
      throw new Error("Unfiled Hungarian constituency winner");
    if (winner && people.get(winner)?.partyId !== count.constituencyParties[district.id])
      throw new Error("Certified Hungarian constituency winner changes party");
    if (!winner || !install(winner, "constituency", district.id, district.regionId))
      vacancies.push({
        tier: "constituency",
        districtId: district.id,
        partyId: winner ? people.get(winner)!.partyId : null,
      });
  }
  for (const county of HU_1991_TERRITORIAL_DISTRICTS) {
    const allocation = count.territorialSeats[county.id];
    if (!allocation) throw new Error("Incomplete certified Hungarian territorial count");
    for (const [partyId, seats] of Object.entries(allocation)) {
      const list = nominations.territorial
        .find((row) => row.id === county.id)!
        .lists.find((row) => row.partyId === partyId);
      if (!list && seats > 0)
        throw new Error("Unfiled Hungarian territorial list receives mandates");
      let remaining = seats;
      regionCapacity[county.regionId] += seats;
      for (const id of list?.candidateIds ?? []) {
        if (remaining === 0) break;
        if (install(id, "territorial", county.id, county.regionId)) remaining--;
      }
      while (remaining-- > 0)
        vacancies.push({ tier: "territorial", districtId: county.id, partyId });
    }
  }
  for (const [partyId, seats] of Object.entries(count.nationalSeats)) {
    const list = nominations.national.find((row) => row.partyId === partyId);
    if (!list && seats > 0) throw new Error("Unfiled Hungarian national list receives mandates");
    let remaining = seats;
    for (const id of list?.candidateIds ?? []) {
      if (remaining === 0) break;
      const person = people.get(id)!;
      if (install(id, "national", "HU-national", person.regionId)) {
        regionCapacity[person.regionId]++;
        remaining--;
      }
    }
    // National vacancies have no resident officeholder. Keep their capacity
    // in Budapest for the game's regional chamber mirror without inventing a person.
    regionCapacity[countyMap.get("HU-territorial-01")!.regionId] += remaining;
    while (remaining-- > 0)
      vacancies.push({ tier: "national", districtId: "HU-national", partyId });
  }
  regionCapacity["HU_BUD"] += count.nationalVacancies;
  for (let i = 0; i < count.nationalVacancies; i++)
    vacancies.push({ tier: "national", districtId: "HU-national", partyId: null });
  if (
    mandates.length + vacancies.length !== 386 ||
    Object.values(regionCapacity).reduce((sum, seats) => sum + seats, 0) !== 386
  )
    throw new Error("Hungarian installation fails 386-mandate conservation");
  return { mandates, vacancies, candidateSeats, partySeats, regionCapacity };
}
