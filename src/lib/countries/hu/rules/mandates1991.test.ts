import { describe, expect, it } from "vitest";
import {
  HU_1991_CONSTITUENCIES,
  HU_1991_TERRITORIAL_DISTRICTS,
} from "../data/electoralDistricts1991";
import { buildHu1991Slates, type Hu1991CampaignNominee } from "./slates1991";
import { settleHu1991Mandates, validateHu1991Nominations } from "./mandates1991";
import { countHuMixed1991, type Hu1991MixedBallots } from "./mixedElection1991";

function nominees(): Hu1991CampaignNominee[] {
  const regions = [...new Set(HU_1991_TERRITORIAL_DISTRICTS.map((row) => row.regionId))];
  return regions.flatMap((regionId, index) =>
    ["A", "B"].map((partyId, order) => ({
      id: `${regionId}:${partyId}`,
      ownerId: `npc-owner-${regionId}-${partyId}`,
      regionId,
      partyId,
      isNpc: true,
      filingOrder: 100 + index * 2 + order,
    }))
  );
}
function fixture(players: boolean = true) {
  const input = nominees();
  if (players)
    input.push(
      {
        id: "player-a",
        ownerId: "human-a",
        regionId: "HU_BUD",
        partyId: "A",
        isNpc: false,
        filingOrder: 1,
        constituencyId: HU_1991_CONSTITUENCIES[0].id,
      },
      {
        id: "player-b",
        ownerId: "human-b",
        regionId: "HU_BUD",
        partyId: "B",
        isNpc: false,
        filingOrder: 2,
        constituencyId: HU_1991_CONSTITUENCIES[1].id,
      }
    );
  const filed = buildHu1991Slates(input);
  const people = new Map(filed.nominations.people.map((row) => [row.id, row]));
  const ballots: Hu1991MixedBallots = {
    constituencies: filed.nominations.constituencies.map((row) => ({
      id: row.id,
      first: {
        registeredVoters: 1000,
        ballotsCast: 600,
        candidates: row.candidateIds.map((candidateId) => ({
          candidateId,
          partyId: people.get(candidateId)!.partyId,
          votes: people.get(candidateId)!.partyId === "A" ? 400 : 200,
        })),
      },
    })),
    territorial: filed.nominations.territorial.map((row) => ({
      id: row.id,
      first: {
        registeredVoters: 1000,
        ballotsCast: 600,
        lists: row.lists.map((list, index) => ({
          partyId: list.partyId,
          ballotOrder: index + 1,
          votes: list.partyId === "A" ? 360 : 240,
        })),
      },
    })),
    nationalLists: filed.nominations.national.map((row, index) => ({
      partyId: row.partyId,
      ballotOrder: index + 1,
    })),
  };
  const count = countHuMixed1991(ballots);
  if (count.kind !== "counted") throw new Error("Fixture closes in the first round");
  return { filed, ballots, count };
}

describe("Hungarian individual filing and tier priority", () => {
  it("installs 386 distinct people using only the original financial profiles", () => {
    const { filed, count } = fixture();
    const installed = settleHu1991Mandates(count, filed.nominations);
    expect(installed.mandates).toHaveLength(386);
    expect(new Set(installed.mandates.map((row) => row.personId)).size).toBe(386);
    expect(installed.vacancies).toEqual([]);
    expect(installed.partySeats).toEqual(count.partySeats);
    expect(installed.candidateSeats["player-a"]).toBe(1);
    expect(installed.candidateSeats["player-b"]).toBe(1);
    expect(installed.mandates.find((row) => row.personId === "player-a")?.tier).toBe(
      "constituency"
    );
    expect(installed.mandates.find((row) => row.personId === "player-b")?.tier).toBe("territorial");
    const npcOwners = new Set(nominees().map((row) => row.ownerId));
    expect(
      installed.mandates.filter((row) => row.isNpc).every((row) => npcOwners.has(row.ownerId))
    ).toBe(true);
    expect(Object.values(installed.regionCapacity).reduce((a, b) => a + b, 0)).toBe(386);
  });
  it("removes a territorial winner from the national list and a direct winner from both lists", () => {
    const { filed, count } = fixture();
    const installed = settleHu1991Mandates(count, filed.nominations);
    for (const personId of ["player-a", "player-b"]) {
      expect(filed.nominations.national.some((row) => row.candidateIds.includes(personId))).toBe(
        true
      );
      expect(installed.mandates.filter((row) => row.personId === personId)).toHaveLength(1);
    }
  });
  it("can elect a losing constituency player from the national list when their county awards no party seat", () => {
    const { filed, ballots } = fixture();
    ballots.territorial[0].first.lists = ballots.territorial[0].first.lists.map((row) => ({
      ...row,
      votes: row.partyId === "A" ? 600 : 0,
    }));
    const count = countHuMixed1991(ballots);
    if (count.kind !== "counted") throw new Error("Fixture has valid ballots");
    const installed = settleHu1991Mandates(count, filed.nominations);
    expect(installed.mandates.find((row) => row.personId === "player-b")?.tier).toBe("national");
    expect(installed.candidateSeats["player-b"]).toBe(1);
    expect(installed.mandates).toHaveLength(386);
  });
  it("replaces unavailable list nominees but retains an unavailable constituency winner's vacancy", () => {
    const { filed, count } = fixture();
    const installed = settleHu1991Mandates(
      count,
      filed.nominations,
      new Set(["player-a", "player-b"])
    );
    expect(installed.candidateSeats["player-a"]).toBe(0);
    expect(installed.candidateSeats["player-b"]).toBe(0);
    expect(installed.mandates).toHaveLength(385);
    expect(installed.vacancies).toEqual([
      { tier: "constituency", districtId: HU_1991_CONSTITUENCIES[0].id, partyId: "A" },
    ]);
    expect(installed.partySeats.B).toBe(count.partySeats.B);
  });
  it("retains counted quotas and explicit vacancies when a filed list is exhausted", () => {
    const { filed, count } = fixture(false);
    const unavailable = new Set(
      filed.nominations.people.filter((row) => row.partyId === "B").map((row) => row.id)
    );
    const installed = settleHu1991Mandates(count, filed.nominations, unavailable);
    expect(installed.vacancies).toHaveLength(count.partySeats.B);
    expect(installed.mandates.length + installed.vacancies.length).toBe(386);
    expect(installed.partySeats.A).toBe(count.partySeats.A);
    expect(Object.values(installed.regionCapacity).reduce((a, b) => a + b, 0)).toBe(386);
  });
  it("is independent of campaign input order", () => {
    expect(buildHu1991Slates([...nominees()].reverse())).toEqual(buildHu1991Slates(nominees()));
  });
  it("rejects duplicate player personas, campaign owners and multiple constituency filings", () => {
    const { filed } = fixture();
    expect(() =>
      validateHu1991Nominations({
        ...filed.nominations,
        people: [
          ...filed.nominations.people,
          {
            ...filed.nominations.people.find((row) => row.id === "player-a")!,
            id: "player-a-clone",
          },
        ],
      })
    ).toThrow(/multiple person/);
    const duplicate = nominees();
    duplicate.push({ ...duplicate[0], id: "duplicate" });
    expect(() => buildHu1991Slates(duplicate)).toThrow(/duplicated/);
    const constituency = structuredClone(filed.nominations);
    constituency.constituencies[1].candidateIds = [
      ...constituency.constituencies[1].candidateIds,
      "player-a",
    ];
    expect(() => validateHu1991Nominations(constituency)).toThrow(/duplicated/);
  });
  it("rejects cross-region choices, party slot conflicts and oversized lists", () => {
    const outside: Hu1991CampaignNominee = {
      id: "human",
      ownerId: "owner",
      isNpc: false,
      regionId: "HU_ALF",
      partyId: "A",
      filingOrder: 1,
      constituencyId: HU_1991_CONSTITUENCIES[0].id,
    };
    expect(() => buildHu1991Slates([...nominees(), outside])).toThrow(/outside/);
    const human = { ...outside, regionId: "HU_BUD" };
    expect(() =>
      buildHu1991Slates([...nominees(), human, { ...human, id: "human2", ownerId: "owner2" }])
    ).toThrow(/already filed/);
    const { filed } = fixture();
    const oversized = structuredClone(filed.nominations);
    oversized.national[0].candidateIds = [...oversized.national[0].candidateIds, "player-a"];
    expect(() => validateHu1991Nominations(oversized)).toThrow(/capacity/);
  });
  it("does not register independent party lists or invent a national list without seven counties", () => {
    const input: Hu1991CampaignNominee[] = [
      {
        id: "human",
        ownerId: "owner",
        isNpc: false,
        regionId: "HU_BUD",
        partyId: "independent",
        filingOrder: 1,
      },
    ];
    const independent = buildHu1991Slates(input);
    expect(independent.nominations.people).toHaveLength(1);
    expect(independent.nominations.territorial.every((row) => !row.lists.length)).toBe(true);
    expect(independent.nominations.national).toEqual([]);
    const localParty = buildHu1991Slates(nominees().filter((row) => row.regionId === "HU_BUD"));
    expect(localParty.nominations.national).toEqual([]);
    expect(localParty.nominations.territorial.filter((row) => row.lists.length)).toHaveLength(1);
  });
});
