/** Existing regional campaign owners supply bounded individual nominees for the founding tiers. */
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import {
  validateBgFoundingNominations,
  type BgFoundingNominations,
  type BgFoundingPerson,
} from "./foundingMandates1990";

export interface BgFoundingCampaignNominee {
  id: string;
  ownerId: string;
  isNpc: boolean;
  partyId: string;
  regionId: string;
  constituencyId?: string;
  listDistrictId?: string;
  listOrder: number;
}
function stableIndex(id: string, count: number) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash % count;
}

export function buildBgFoundingSlates(candidates: readonly BgFoundingCampaignNominee[]) {
  const ordered = [...candidates].sort(
    (a, b) => a.listOrder - b.listOrder || a.id.localeCompare(b.id)
  );
  const people: BgFoundingPerson[] = [];
  const serials = new Map<string, number>();
  const playerConstituencies: Record<string, string> = {},
    playerListDistricts: Record<string, string> = {};
  const independentConstituencies = new Map<string, string>();
  const candidateIds = new Set<string>(),
    ownerIds = new Set<string>();
  const regions = new Set(BG_1990_LIST_DISTRICTS.map((row) => row.regionId));
  for (const candidate of ordered) {
    const owner = `${candidate.isNpc ? "npc" : "player"}:${candidate.ownerId}`;
    if (
      !candidate.id ||
      !candidate.ownerId ||
      !candidate.partyId ||
      !regions.has(candidate.regionId) ||
      !Number.isSafeInteger(candidate.listOrder) ||
      candidate.listOrder < 0 ||
      candidateIds.has(candidate.id) ||
      ownerIds.has(owner)
    )
      throw new Error("Invalid or duplicated Bulgarian founding campaign owner");
    candidateIds.add(candidate.id);
    ownerIds.add(owner);
    const local = BG_1990_CONSTITUENCIES.filter((row) => row.regionId === candidate.regionId);
    if (candidate.isNpc) {
      if (candidate.constituencyId || candidate.listDistrictId)
        throw new Error("Bulgarian aggregate party owner cannot file an individual nomination");
      if (candidate.partyId === "independent")
        independentConstituencies.set(
          candidate.id,
          local[stableIndex(candidate.id, local.length)].id
        );
      continue;
    }
    const occupied = new Set(
      ordered
        .filter(
          (row) =>
            !row.isNpc &&
            row.id !== candidate.id &&
            row.partyId === candidate.partyId &&
            row.partyId !== "independent"
        )
        .map((row) => row.constituencyId ?? playerConstituencies[row.id])
        .filter(Boolean)
    );
    let id = candidate.constituencyId;
    if (id && occupied.has(id))
      throw new Error("Bulgarian party constituency is already nominated");
    if (!id) {
      const start = stableIndex(candidate.id, local.length);
      id = Array.from(
        { length: local.length },
        (_, offset) => local[(start + offset) % local.length].id
      ).find((district) => !occupied.has(district));
    }
    if (!id || !local.some((row) => row.id === id))
      throw new Error("Bulgarian player constituency is missing or outside their region");
    playerConstituencies[candidate.id] = id;
    if (candidate.partyId !== "independent") {
      const areas = BG_1990_LIST_DISTRICTS.filter((row) => row.regionId === candidate.regionId);
      const listId =
        candidate.listDistrictId ??
        BG_1990_CONSTITUENCIES.find((row) => row.id === id)!.listDistrictId;
      if (!areas.some((row) => row.id === listId))
        throw new Error("Bulgarian player list is outside their region");
      playerListDistricts[candidate.id] = listId;
    } else if (candidate.listDistrictId) throw new Error("Bulgarian independent has no party list");
  }
  const create = (candidate: BgFoundingCampaignNominee) => {
    const serial = serials.get(candidate.id) ?? 0;
    if (!candidate.isNpc && serial) return people.find((row) => row.id === candidate.id)!;
    const person: BgFoundingPerson = {
      id: candidate.isNpc ? `${candidate.id}:bg1990:${serial + 1}` : candidate.id,
      candidateId: candidate.id,
      ownerId: candidate.ownerId,
      isNpc: candidate.isNpc,
      partyId: candidate.partyId,
      regionId: candidate.regionId,
    };
    serials.set(candidate.id, serial + 1);
    people.push(person);
    return person;
  };
  const parties = [
    ...new Set(ordered.filter((row) => row.partyId !== "independent").map((row) => row.partyId)),
  ].sort();
  const constituencies = BG_1990_CONSTITUENCIES.map((district) => {
    const candidateIds: string[] = [];
    for (const party of parties) {
      const human = ordered.find(
        (row) => !row.isNpc && row.partyId === party && playerConstituencies[row.id] === district.id
      );
      const npcs = ordered.filter(
        (row) => row.isNpc && row.partyId === party && row.regionId === district.regionId
      );
      const selected = human ?? npcs[stableIndex(district.id, Math.max(1, npcs.length))];
      if (selected) candidateIds.push(create(selected).id);
    }
    for (const independent of ordered.filter(
      (row) =>
        row.partyId === "independent" && !row.isNpc && playerConstituencies[row.id] === district.id
    ))
      candidateIds.push(create(independent).id);
    for (const independent of ordered.filter(
      (row) => independentConstituencies.get(row.id) === district.id
    ))
      candidateIds.push(create(independent).id);
    return { id: district.id, candidateIds };
  });
  const lists: BgFoundingNominations["lists"][number][] = [];
  for (const district of BG_1990_LIST_DISTRICTS) {
    for (const party of parties) {
      const humans = ordered.filter(
        (row) => !row.isNpc && row.partyId === party && playerListDistricts[row.id] === district.id
      );
      const npcs = ordered.filter(
        (row) => row.isNpc && row.partyId === party && row.regionId === district.regionId
      );
      const candidateIds = humans.map((row) => create(row).id);
      // Separate list people keep200 list places available after direct wins.
      // They retain campaign and account ownership; no new NPC documents exist.
      if (npcs.length)
        for (let index = 0; index < district.seats; index++)
          candidateIds.push(create(npcs[index % npcs.length]).id);
      if (candidateIds.length)
        lists.push({ districtId: district.id, partyId: party, candidateIds });
    }
  }
  const nominations: BgFoundingNominations = { people, constituencies, lists };
  validateBgFoundingNominations(nominations);
  return { nominations, playerConstituencies, playerListDistricts };
}
