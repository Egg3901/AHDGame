/**
 * Hungary's modern mixed count assigns 199 individual mandates from one
 * national result. NPC nominees share existing financial owners; every player
 * retains one identity across all six regions and cannot win duplicate seats.
 */
import type { HuMixedPlan } from "./mixedElectionPlan";
import type { Hu1991InstalledMandates, Hu1991Person } from "./mandates1991";
import { apportionSeats } from "@/lib/country/seatApportionment";
import { allocateHuModernPeople } from "./modernMandates2011";
export interface HuModernCandidate {
  id: string;
  ownerId: string;
  partyId: string;
  regionId: string;
  isNpc: boolean;
  votes: number;
}
export function buildHuModernAssembly(
  plan: HuMixedPlan,
  candidates: readonly HuModernCandidate[]
): { installed: Hu1991InstalledMandates; people: Hu1991Person[] } | null {
  const ownerKeys = candidates.map((row) =>
    row.isNpc ? `npc:${row.ownerId}:${row.regionId}` : `player:${row.ownerId}`
  );
  if (
    new Set(candidates.map((row) => row.id)).size !== candidates.length ||
    new Set(ownerKeys).size !== candidates.length ||
    candidates.some((row) => !row.ownerId || !row.regionId)
  )
    throw new Error("A Hungarian modern person cannot file multiple financial identities");
  const byId = new Map(candidates.map((row) => [row.id, row]));
  const people: Hu1991Person[] = [];
  const candidateSeats: Record<string, number> = Object.fromEntries(
    candidates.map((row) => [row.id, 0])
  );
  for (const estimates of Object.values(plan.candidateSeatsByElection)) {
    const quotas: Record<string, number> = {};
    const pool = Object.keys(estimates).flatMap((id) => {
      const row = byId.get(id);
      if (!row) throw new Error("Modern Hungarian count lacks its filed candidate");
      const party = row.partyId === "independent" ? `independent@${id}` : row.partyId;
      quotas[party] = (quotas[party] ?? 0) + estimates[id];
      return [{ id, partyId: party, votes: row.votes, isNpc: row.isNpc }];
    });
    const seats = allocateHuModernPeople({ quotas, people: pool });
    if (!seats) return null;
    for (const [id, count] of Object.entries(seats)) {
      const candidate = byId.get(id)!;
      candidateSeats[id] = count;
      for (let index = 0; index < count; index++)
        people.push({
          id: `${id}:person:${index + 1}`,
          candidateId: id,
          ownerId: candidate.ownerId,
          isNpc: candidate.isNpc,
          partyId: candidate.partyId,
          regionId: candidate.regionId,
        });
    }
  }
  const vacancies: Hu1991InstalledMandates["vacancies"] = Object.entries(
    plan.result.constituencyWinners
  )
    .filter(([, winner]) => winner === null)
    .map(([districtId]) => ({
      tier: "constituency",
      districtId,
      partyId: null,
    }));
  if (people.length + vacancies.length !== 199) return null;
  const remaining = [...people].sort((a, b) => a.id.localeCompare(b.id));
  const mandates: Hu1991InstalledMandates["mandates"] = [];
  for (const [district, party] of Object.entries(plan.result.constituencyWinners).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (!party) continue;
    const region = district.split(":")[0];
    const index = remaining.findIndex(
      (row) =>
        row.regionId === region &&
        (row.partyId === "independent" ? `independent@${row.candidateId}` : row.partyId) === party
    );
    if (index < 0) throw new Error("Hungarian district winner lacks a counted nominee");
    const person = remaining.splice(index, 1)[0];
    mandates.push({ ...person, personId: person.id, tier: "constituency", districtId: district });
  }
  for (const person of remaining)
    mandates.push({
      ...person,
      personId: person.id,
      tier: "national",
      districtId: "HU-national-2011",
    });
  const partySeats: Record<string, number> = {};
  for (const person of people) partySeats[person.partyId] = (partySeats[person.partyId] ?? 0) + 1;
  // File a bounded original national slate, including unused nominees. The
  // statutory maximum is three times93, shared by all regional actors of a party.
  const filedPeople = [...people];
  for (const [party, listSeats] of Object.entries(plan.result.listSeats)) {
    if (listSeats <= 0) continue;
    const actors = candidates.filter((row) => row.partyId === party);
    for (const player of actors.filter((row) => !row.isNpc)) {
      if (filedPeople.some((row) => row.candidateId === player.id)) continue;
      filedPeople.push({
        id: `${player.id}:person:1`,
        candidateId: player.id,
        ownerId: player.ownerId,
        isNpc: false,
        partyId: party,
        regionId: player.regionId,
      });
    }
    const remainingSlots = 279 - filedPeople.filter((row) => row.partyId === party).length;
    if (remainingSlots < 0)
      throw new Error("Modern Hungarian national slate exceeds its filed capacity");
    const npcActors = actors.filter((row) => row.isNpc);
    const extras = apportionSeats(
      Object.fromEntries(npcActors.map((row) => [row.id, row.votes])),
      remainingSlots
    );
    for (const actor of npcActors) {
      const existing = filedPeople.filter((row) => row.candidateId === actor.id).length;
      for (let index = 0; index < (extras[actor.id] ?? 0); index++)
        filedPeople.push({
          id: `${actor.id}:person:${existing + index + 1}`,
          candidateId: actor.id,
          ownerId: actor.ownerId,
          isNpc: true,
          partyId: party,
          regionId: actor.regionId,
        });
    }
  }
  return {
    people: filedPeople,
    installed: {
      mandates,
      vacancies,
      candidateSeats,
      partySeats,
      regionCapacity: { ...plan.regionCapacity },
    },
  };
}

/** Withdrawn direct winners leave vacancies; national mandates use the filed slate. */
export function settleHuModernAssembly(
  original: Hu1991InstalledMandates,
  people: readonly Hu1991Person[],
  unavailable: ReadonlySet<string>
): Hu1991InstalledMandates {
  const mandates: Hu1991InstalledMandates["mandates"] = [];
  const vacancies: Hu1991InstalledMandates["vacancies"] = original.vacancies.map((row) => ({
    ...row,
  }));
  const used = new Set<string>();
  const reserved = new Set(
    original.mandates.filter((row) => !unavailable.has(row.personId)).map((row) => row.personId)
  );
  const capacity = { ...original.regionCapacity };
  for (const mandate of original.mandates) {
    let person = !unavailable.has(mandate.personId)
      ? people.find((row) => row.id === mandate.personId)
      : undefined;
    if (!person && mandate.tier === "national")
      person = people.find(
        (row) =>
          row.partyId === mandate.partyId &&
          !unavailable.has(row.id) &&
          !used.has(row.id) &&
          !reserved.has(row.id)
      );
    if (!person) {
      vacancies.push({
        tier: mandate.tier,
        districtId: mandate.districtId,
        partyId: mandate.partyId,
      });
      continue;
    }
    if (used.has(person.id)) throw new Error("Modern Hungarian settlement duplicates a person");
    used.add(person.id);
    if (person.regionId !== mandate.regionId) {
      capacity[mandate.regionId]--;
      capacity[person.regionId]++;
    }
    mandates.push({
      ...mandate,
      personId: person.id,
      candidateId: person.candidateId,
      ownerId: person.ownerId,
      isNpc: person.isNpc,
      regionId: person.regionId,
    });
  }
  const candidateSeats: Record<string, number> = {},
    partySeats: Record<string, number> = {};
  for (const mandate of mandates) {
    candidateSeats[mandate.candidateId] = (candidateSeats[mandate.candidateId] ?? 0) + 1;
    partySeats[mandate.partyId] = (partySeats[mandate.partyId] ?? 0) + 1;
  }
  return { mandates, vacancies, candidateSeats, partySeats, regionCapacity: capacity };
}
