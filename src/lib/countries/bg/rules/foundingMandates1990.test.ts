import { describe, expect, it } from "vitest";
import { BG_1990_CONSTITUENCIES, BG_1990_LIST_DISTRICTS } from "../data/foundingDistricts1990";
import {
  settleBgFoundingMandates,
  validateBgFoundingNominations,
  type BgFoundingNominations,
  type BgFoundingPerson,
} from "./foundingMandates1990";

function fixture() {
  const people: BgFoundingPerson[] = [];
  const constituencies = BG_1990_CONSTITUENCIES.map((row, index) => {
    const id = `direct-${index}`;
    people.push({
      id,
      candidateId: `npc-${row.regionId}`,
      ownerId: `owner-${row.regionId}`,
      isNpc: true,
      partyId: "a",
      regionId: row.regionId,
    });
    return { id: row.id, candidateIds: [id] };
  });
  const lists = BG_1990_LIST_DISTRICTS.map((row) => {
    const candidateIds = Array.from({ length: row.seats + 1 }, (_, index) => `${row.id}-${index}`);
    people.push(
      ...candidateIds.map((id) => ({
        id,
        candidateId: `npc-${row.regionId}`,
        ownerId: `owner-${row.regionId}`,
        isNpc: true,
        partyId: "a",
        regionId: row.regionId,
      }))
    );
    return { districtId: row.id, partyId: "a", candidateIds };
  });
  const nominations: BgFoundingNominations = { people, constituencies, lists };
  return {
    nominations,
    constituencyWinners: Object.fromEntries(
      constituencies.map((row) => [row.id, row.candidateIds[0]])
    ),
    districtListSeats: Object.fromEntries(
      BG_1990_LIST_DISTRICTS.map((row) => [row.id, { a: row.seats }])
    ),
    availablePersonIds: new Set(people.map((row) => row.id)),
  };
}

describe("Bulgarian founding mandate custody", () => {
  it("installs400 individual mandates while retaining five existing NPC financial owners", () => {
    const input = fixture();
    const result = settleBgFoundingMandates(input);
    expect(result.mandates).toHaveLength(400);
    expect(result.vacancies).toHaveLength(0);
    expect(result.partySeats).toEqual({ a: 400 });
    expect(new Set(result.mandates.map((row) => row.ownerId)).size).toBe(5);
    expect(Object.values(result.candidateSeats).reduce((sum, count) => sum + count, 0)).toBe(400);
    expect(input.availablePersonIds.size).toBe(input.nominations.people.length);
  });
  it("a player elected directly leaves the list to its next nominee", () => {
    const input = fixture();
    const person = input.nominations.people[0];
    const humans = input.nominations.people.map((row) =>
      row.id === person.id
        ? { ...row, candidateId: "human-campaign", ownerId: "human", isNpc: false }
        : row
    );
    const firstList = input.nominations.lists.find(
      (row) => row.districtId === BG_1990_CONSTITUENCIES[0].listDistrictId
    )!;
    const lists = input.nominations.lists.map((row) =>
      row === firstList ? { ...row, candidateIds: [person.id, ...row.candidateIds] } : row
    );
    const result = settleBgFoundingMandates({
      ...input,
      nominations: { ...input.nominations, people: humans, lists },
    });
    expect(result.candidateSeats["human-campaign"]).toBe(1);
    expect(result.mandates.filter((row) => !row.isNpc)).toHaveLength(1);
    expect(result.mandates).toHaveLength(400);
  });
  it("departed direct holders produce vacancies and lists advance without changing quotas", () => {
    const input = fixture();
    const person = input.nominations.people[0];
    input.availablePersonIds.delete(person.id);
    input.availablePersonIds.delete(input.nominations.lists[0].candidateIds[0]);
    const result = settleBgFoundingMandates(input);
    expect(result.mandates).toHaveLength(399);
    expect(result.vacancies).toEqual([
      { tier: "constituency", districtId: BG_1990_CONSTITUENCIES[0].id, partyId: "a" },
    ]);
    expect(result.mandates.filter((row) => row.tier === "list")).toHaveLength(200);
  });
  it("an exhausted list produces explicit vacancies, not extra seats for another party", () => {
    const input = fixture();
    for (const id of input.nominations.lists[0].candidateIds) input.availablePersonIds.delete(id);
    const result = settleBgFoundingMandates(input);
    expect(result.vacancies.filter((row) => row.tier === "list")).toHaveLength(
      BG_1990_LIST_DISTRICTS[0].seats
    );
    expect(result.mandates.length + result.vacancies.length).toBe(400);
  });
  it("rejects changed financial owners, duplicated players and unregistered winners", () => {
    const input = fixture();
    const people = input.nominations.people.map((row, index) =>
      index === 1 ? { ...row, ownerId: "forged" } : row
    );
    expect(() => validateBgFoundingNominations({ ...input.nominations, people })).toThrow(
      "financial owner"
    );
    const humans = input.nominations.people.map((row, index) =>
      index < 2 ? { ...row, candidateId: `human-${index}`, ownerId: "human", isNpc: false } : row
    );
    expect(() => validateBgFoundingNominations({ ...input.nominations, people: humans })).toThrow(
      "multiple person identities"
    );
    expect(() =>
      settleBgFoundingMandates({
        ...input,
        constituencyWinners: {
          ...input.constituencyWinners,
          [BG_1990_CONSTITUENCIES[0].id]: "unfiled",
        },
      })
    ).toThrow("registered");
  });
  it("rejects an extra constituency candidacy, a second list and changed district capacity", () => {
    const input = fixture();
    const first = input.nominations.constituencies[0];
    const constituencies = input.nominations.constituencies.map((row, index) =>
      index === 1 ? { ...row, candidateIds: first.candidateIds } : row
    );
    expect(() => validateBgFoundingNominations({ ...input.nominations, constituencies })).toThrow(
      "duplicated"
    );
    expect(() =>
      validateBgFoundingNominations({
        ...input.nominations,
        lists: [...input.nominations.lists, input.nominations.lists[0]],
      })
    ).toThrow("party list");
    const id = BG_1990_LIST_DISTRICTS[0].id;
    expect(() =>
      settleBgFoundingMandates({
        ...input,
        districtListSeats: { ...input.districtListSeats, [id]: { a: 0 } },
      })
    ).toThrow("capacity");
  });
});
