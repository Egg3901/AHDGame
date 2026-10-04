/**
 * Hungary's six campaign regions file distinct constituency and list nominees.
 * buildHu1991Slates expands existing NPC profiles into bounded people, and files
 * each player in one constituency and one territorial list plus the national list.
 */
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import {
  validateHu1991Nominations,
  type Hu1991Nominations,
  type Hu1991Person,
} from "./mandates1991";
import { huMixedElectoralLaw, type HuMixedElectoralLaw } from "./electoralLaw";

export interface Hu1991CampaignNominee {
  id: string;
  ownerId: string;
  regionId: string;
  partyId: string;
  isNpc: boolean;
  filingOrder: number;
  /** A player chooses one constituency; missing legacy filings use a stable assignment. */
  constituencyId?: string;
}
export interface Hu1991FiledSlates {
  nominations: Hu1991Nominations;
  playerConstituencies: Record<string, string>;
}
function stableIndex(id: string, count: number): number {
  let value = 2166136261;
  for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value % count;
}

export function buildHu1991Slates(
  input: readonly Hu1991CampaignNominee[],
  law?: HuMixedElectoralLaw
): Hu1991FiledSlates {
  const { version, listMultiplier } = huMixedElectoralLaw(law);
  const ordered = [...input].sort(
    (a, b) => a.filingOrder - b.filingOrder || a.id.localeCompare(b.id)
  );
  const people: Hu1991Person[] = [];
  const candidateIds = new Set<string>(),
    ownerIds = new Set<string>();
  const serials = new Map<string, number>();
  const regionIds = new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId));
  const playerConstituencies: Record<string, string> = {};
  for (const row of ordered) {
    const ownerKey = `${row.isNpc ? "npc" : "player"}:${row.ownerId}`;
    if (
      !row.id ||
      !row.ownerId ||
      !row.partyId ||
      !Number.isSafeInteger(row.filingOrder) ||
      row.filingOrder < 0 ||
      !regionIds.has(row.regionId) ||
      candidateIds.has(row.id) ||
      ownerIds.has(ownerKey) ||
      (row.isNpc && row.partyId === "independent")
    )
      throw new Error("Invalid or duplicated Hungarian campaign nominee");
    candidateIds.add(row.id);
    ownerIds.add(ownerKey);
    if (!row.isNpc) {
      const local = HU_1991_CONSTITUENCIES.filter((d) => d.regionId === row.regionId);
      const occupied = new Set(
        row.partyId === "independent"
          ? []
          : ordered
              .filter(
                (other) => !other.isNpc && other.id !== row.id && other.partyId === row.partyId
              )
              .flatMap((other) =>
                (playerConstituencies[other.id] ?? other.constituencyId)
                  ? [playerConstituencies[other.id] ?? other.constituencyId!]
                  : []
              )
      );
      let districtId = row.constituencyId;
      if (!districtId) {
        const start = stableIndex(row.id, local.length);
        districtId = Array.from(
          { length: local.length },
          (_, offset) => local[(start + offset) % local.length].id
        ).find((id) => !occupied.has(id));
      }
      if (!districtId || occupied.has(districtId))
        throw new Error("Hungarian party constituency is already filed");
      if (!local.some((d) => d.id === districtId))
        throw new Error("Hungarian player constituency is outside their region");
      playerConstituencies[row.id] = districtId;
    }
  }
  const createPerson = (row: Hu1991CampaignNominee): Hu1991Person => {
    const index = serials.get(row.id) ?? 0;
    if (!row.isNpc && index > 0) return people.find((person) => person.id === row.id)!;
    const person: Hu1991Person = {
      id: row.isNpc ? `${row.id}:hu1991:${index + 1}` : row.id,
      candidateId: row.id,
      ownerId: row.ownerId,
      isNpc: row.isNpc,
      partyId: row.partyId,
      regionId: row.regionId,
    };
    serials.set(row.id, index + 1);
    people.push(person);
    return person;
  };
  const partyIds = [
    ...new Set(ordered.filter((row) => row.partyId !== "independent").map((row) => row.partyId)),
  ].sort();
  const constituencies: Hu1991Nominations["constituencies"][number][] = [];
  for (const district of HU_1991_CONSTITUENCIES) {
    const candidates: string[] = [];
    for (const partyId of partyIds) {
      const humans = ordered.filter(
        (row) =>
          !row.isNpc && row.partyId === partyId && playerConstituencies[row.id] === district.id
      );
      if (humans.length > 1) throw new Error("Hungarian party constituency is already filed");
      const npc = ordered.find(
        (row) => row.isNpc && row.partyId === partyId && row.regionId === district.regionId
      );
      const candidate = humans[0] ?? npc;
      if (candidate) candidates.push(createPerson(candidate).id);
    }
    for (const human of ordered.filter(
      (row) =>
        !row.isNpc && row.partyId === "independent" && playerConstituencies[row.id] === district.id
    ))
      candidates.push(createPerson(human).id);
    constituencies.push({ id: district.id, candidateIds: candidates });
  }
  const territorial: Hu1991Nominations["territorial"][number][] = [];
  for (const county of HU_1991_TERRITORIAL_DISTRICTS) {
    const districts = HU_1991_CONSTITUENCIES.filter((row) => row.countyId === county.id).map(
      (row) => row.id
    );
    const localPeople = constituencies
      .filter((row) => districts.includes(row.id))
      .flatMap((row) => row.candidateIds)
      .map((id) => people.find((row) => row.id === id)!);
    const lists: Hu1991Nominations["territorial"][number]["lists"][number][] = [];
    for (const partyId of partyIds) {
      const filed = localPeople.filter((row) => row.partyId === partyId);
      if (filed.length < county.minimumConstituencyNominees) continue;
      const npc = ordered.find(
        (row) => row.isNpc && row.partyId === partyId && row.regionId === county.regionId
      );
      // Keep enough distinct list-only people when constituency winners leave
      // the list. Otherwise a Budapest sweep would remove 32 of 56 nominees
      // and leave only 24 people for its 28 territorial mandates.
      const prioritized = [...filed].sort(
        (a, b) => Number(a.isNpc) - Number(b.isNpc) || a.id.localeCompare(b.id)
      );
      const list = (
        npc
          ? prioritized.slice(
              0,
              Math.max(county.territorialSeats, prioritized.filter((row) => !row.isNpc).length)
            )
          : prioritized
      ).map((row) => row.id);
      if (npc)
        while (list.length < listMultiplier * county.territorialSeats)
          list.push(createPerson(npc).id);
      lists.push({
        partyId,
        candidateIds: list.slice(0, listMultiplier * county.territorialSeats),
      });
    }
    territorial.push({ id: county.id, lists });
  }
  const national: Hu1991Nominations["national"][number][] = [];
  for (const partyId of partyIds) {
    if (territorial.filter((row) => row.lists.some((list) => list.partyId === partyId)).length < 7)
      continue;
    const list = ordered
      .filter((row) => !row.isNpc && row.partyId === partyId)
      .map((row) => createPerson(row).id);
    if (list.length > listMultiplier * 58)
      throw new Error("Hungarian national player nominations exceed list capacity");
    const npcs = ordered.filter((row) => row.isNpc && row.partyId === partyId);
    // Additional national people are distinct from constituency and territorial
    // nominees. Players remain the same people on all three tiers. National
    // filing uses twice the initial statutory 58 mandates (Act XXXIV, section 5).
    while (npcs.length && list.length < listMultiplier * 58) {
      const npc = npcs[list.length % npcs.length];
      list.push(createPerson(npc).id);
    }
    national.push({ partyId, candidateIds: list });
  }
  const nominations = {
    people,
    constituencies,
    territorial,
    national,
    ...(version === "mixed-1994-v1" ? { electoralLaw: version } : {}),
  };
  validateHu1991Nominations(nominations);
  return { nominations, playerConstituencies };
}
