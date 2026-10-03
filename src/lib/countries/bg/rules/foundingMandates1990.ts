/** Founding nominees can appear in one constituency and one list, but take one mandate. */
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";

export interface BgFoundingPerson {
  id: string;
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  partyId: string;
  regionId: string;
}
export interface BgFoundingNominations {
  people: readonly BgFoundingPerson[];
  constituencies: readonly { id: string; candidateIds: readonly string[] }[];
  lists: readonly { districtId: string; partyId: string; candidateIds: readonly string[] }[];
}
export interface BgFoundingMandate {
  personId: string;
  candidateId: string;
  ownerId: string;
  isNpc: boolean;
  partyId: string;
  regionId: string;
  tier: "constituency" | "list";
  districtId: string;
}

export function validateBgFoundingNominations(nominations: BgFoundingNominations): void {
  const people = new Map(nominations.people.map((row) => [row.id, row]));
  const regions = new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId));
  const playerOwners = new Set<string>(),
    candidateOwners = new Map<string, string>();
  if (people.size !== nominations.people.length)
    throw new Error("Invalid Bulgarian founding person catalog");
  for (const person of people.values()) {
    if (
      !person.id ||
      !person.candidateId ||
      !person.ownerId ||
      !person.partyId ||
      !regions.has(person.regionId)
    )
      throw new Error("Invalid Bulgarian founding nominee identity");
    const ownerKey = `${person.isNpc ? "npc" : "player"}:${person.ownerId}:${person.partyId}:${person.regionId}`;
    const existing = candidateOwners.get(person.candidateId);
    if (existing && existing !== ownerKey)
      throw new Error("Bulgarian campaign changes financial owner");
    candidateOwners.set(person.candidateId, ownerKey);
    if (!person.isNpc) {
      if (playerOwners.has(person.ownerId))
        throw new Error("One Bulgarian player has multiple person identities");
      playerOwners.add(person.ownerId);
    }
  }
  const districts = new Map(BG_1990_CONSTITUENCIES.map((row) => [row.id, row]));
  const listDistricts = new Map(BG_1990_LIST_DISTRICTS.map((row) => [row.id, row]));
  if (
    nominations.constituencies.length !== 200 ||
    new Set(nominations.constituencies.map((row) => row.id)).size !== 200
  )
    throw new Error("Bulgarian founding nominations require all200 constituencies");
  const directPeople = new Set<string>(),
    listPeople = new Set<string>(),
    lists = new Set<string>();
  for (const row of nominations.constituencies) {
    const district = districts.get(row.id);
    if (!district) throw new Error("Unknown Bulgarian founding constituency");
    const parties = new Set<string>();
    for (const id of row.candidateIds) {
      const person = people.get(id);
      if (!person || person.regionId !== district.regionId || directPeople.has(id))
        throw new Error(
          "Bulgarian founding constituency nominee is missing, duplicated or outside their region"
        );
      directPeople.add(id);
      if (person.partyId !== "independent") {
        if (parties.has(person.partyId))
          throw new Error("Bulgarian party has multiple nominees in one constituency");
        parties.add(person.partyId);
      }
    }
  }
  for (const list of nominations.lists) {
    const district = listDistricts.get(list.districtId);
    const key = `${list.districtId}:${list.partyId}`;
    if (
      !district ||
      !list.partyId ||
      list.partyId === "independent" ||
      lists.has(key) ||
      list.candidateIds.length === 0 ||
      list.candidateIds.length > 400
    )
      throw new Error("Invalid Bulgarian founding party list");
    lists.add(key);
    for (const id of list.candidateIds) {
      const person = people.get(id);
      if (
        !person ||
        person.partyId !== list.partyId ||
        person.regionId !== district.regionId ||
        listPeople.has(id)
      )
        throw new Error(
          "Bulgarian founding list nominee is missing, duplicated or outside their party or region"
        );
      listPeople.add(id);
    }
  }
}

export function settleBgFoundingMandates(input: {
  nominations: BgFoundingNominations;
  constituencyWinners: Readonly<Record<string, string | null>>;
  districtListSeats: Readonly<Record<string, Readonly<Record<string, number>>>>;
  availablePersonIds: ReadonlySet<string>;
}) {
  validateBgFoundingNominations(input.nominations);
  const people = new Map(input.nominations.people.map((row) => [row.id, row]));
  const direct = new Map(input.nominations.constituencies.map((row) => [row.id, row]));
  const districts = new Map(BG_1990_LIST_DISTRICTS.map((row) => [row.id, row]));
  if (
    Object.keys(input.constituencyWinners).length !== 200 ||
    BG_1990_CONSTITUENCIES.some((row) => !(row.id in input.constituencyWinners)) ||
    Object.keys(input.districtListSeats).length !== 28 ||
    BG_1990_LIST_DISTRICTS.some((row) => !(row.id in input.districtListSeats))
  )
    throw new Error("Bulgarian founding mandate coverage is incomplete");
  const mandates: BgFoundingMandate[] = [];
  const vacancies: Array<{
    tier: BgFoundingMandate["tier"];
    districtId: string;
    partyId: string | null;
  }> = [];
  const used = new Set<string>();
  const install = (personId: string, tier: BgFoundingMandate["tier"], districtId: string) => {
    const person = people.get(personId);
    if (!person || used.has(personId))
      throw new Error("Bulgarian founding person holds multiple mandates");
    used.add(personId);
    mandates.push({
      personId,
      candidateId: person.candidateId,
      ownerId: person.ownerId,
      isNpc: person.isNpc,
      partyId: person.partyId,
      regionId: person.regionId,
      tier,
      districtId,
    });
  };
  for (const district of BG_1990_CONSTITUENCIES) {
    const winner = input.constituencyWinners[district.id];
    if (winner && !direct.get(district.id)!.candidateIds.includes(winner))
      throw new Error("Bulgarian founding winner is not a registered constituency nominee");
    if (winner && input.availablePersonIds.has(winner))
      install(winner, "constituency", district.id);
    else
      vacancies.push({
        tier: "constituency",
        districtId: district.id,
        partyId: winner ? people.get(winner)!.partyId : null,
      });
  }
  let listSeats = 0;
  for (const [districtId, quotas] of Object.entries(input.districtListSeats)) {
    const district = districts.get(districtId)!;
    let localSeats = 0;
    for (const [partyId, count] of Object.entries(quotas)) {
      if (
        !partyId ||
        partyId === "independent" ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > district.seats
      )
        throw new Error("Invalid Bulgarian founding district list quota");
      localSeats += count;
      const list = input.nominations.lists.find(
        (row) => row.districtId === districtId && row.partyId === partyId
      );
      let remaining = count;
      for (const id of list?.candidateIds ?? []) {
        if (!remaining) break;
        if (used.has(id) || !input.availablePersonIds.has(id)) continue;
        install(id, "list", districtId);
        remaining--;
      }
      for (let vacancy = 0; vacancy < remaining; vacancy++)
        vacancies.push({ tier: "list", districtId, partyId });
    }
    if (localSeats !== district.seats)
      throw new Error("Bulgarian founding district quota changes capacity");
    listSeats += localSeats;
  }
  if (listSeats !== 200 || mandates.length + vacancies.length !== 400)
    throw new Error("Bulgarian founding handover does not conserve400 mandates");
  const candidateSeats: Record<string, number> = {},
    partySeats: Record<string, number> = {};
  for (const row of mandates) {
    candidateSeats[row.candidateId] = (candidateSeats[row.candidateId] ?? 0) + 1;
    partySeats[row.partyId] = (partySeats[row.partyId] ?? 0) + 1;
  }
  return { mandates, vacancies, candidateSeats, partySeats };
}
