import { describe, expect, it } from "vitest";
import { buildBgOrdinaryElectionPlan, type BgOrdinaryRace } from "./ordinaryElectionPlan";
import { BG_1991_MACROREGION_POPULATION } from "../data/bgPopulation1991";
import { BG_1991_ELECTORAL_DISTRICTS } from "../data/electoralDistricts1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

function races(): BgOrdinaryRace[] {
  return Object.keys(BG_1991_MACROREGION_POPULATION).map((regionId) => ({
    regionId,
    electionId: `${regionId}:1991`,
    candidates: ["A", "B"].map((party, order) => ({
      id: `${regionId}:${party}`,
      ownerId: `${regionId}:${party}:profile`,
      party,
      votes: Math.round(BG_1991_MACROREGION_POPULATION[regionId] * (order === 0 ? 0.55 : 0.45)),
      listOrder: order,
      isNpc: true,
      eligible: true,
    })),
  }));
}

describe("Bulgarian31 district plan from bounded regional campaigns", () => {
  it("conserves240 mandates in district, national, region and existing profile assignments", () => {
    const result = buildBgOrdinaryElectionPlan(races());
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Fixture has full lists");
    const capacities = apportionSeats(
      240,
      Object.fromEntries(BG_1991_ELECTORAL_DISTRICTS.map((row) => [row.id, row.population]))
    );
    expect(result.partySeats).toEqual({ A: 132, B: 108 });
    expect(Object.keys(result.districtSeats)).toHaveLength(31);
    for (const [district, seats] of Object.entries(result.districtSeats))
      expect(Object.values(seats).reduce((sum, n) => sum + n, 0)).toBe(capacities[district]);
    expect(Object.values(result.regionCapacity).reduce((sum, n) => sum + n, 0)).toBe(240);
    expect(
      Object.values(result.candidateSeatsByElection)
        .flatMap(Object.values)
        .reduce((sum, n) => sum + n, 0)
    ).toBe(240);
    expect(buildBgOrdinaryElectionPlan([...races()].reverse())).toEqual(result);
  });
  it("gives a player list head one seat and the existing NPC slate the remainder", () => {
    const input = races();
    const row = input[0];
    row.candidates = [
      {
        ...row.candidates[0],
        id: "player",
        ownerId: "human",
        isNpc: false,
        votes: 1,
        listOrder: -1,
      },
      ...row.candidates,
    ];
    const result = buildBgOrdinaryElectionPlan(input);
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Fixture has full lists");
    expect(result.candidateSeatsByElection[row.electionId].player).toBe(1);
    expect(result.candidateSeatsByElection[row.electionId][row.candidates[1].id]).toBeGreaterThan(
      1
    );
  });
  it("defers a party mandate with no viable list capacity instead of multiplying a player", () => {
    const input = races();
    input[0].candidates = input[0].candidates.map((row) => ({ ...row, isNpc: false }));
    expect(buildBgOrdinaryElectionPlan(input)).toEqual({
      kind: "deferred",
      reason: "insufficient-viable-list-capacity",
    });
  });
  it("uses the next viable list entry after an earlier nominee becomes unavailable", () => {
    const input = races();
    const first = input[0].candidates[0];
    input[0].candidates = [
      { ...first, eligible: false },
      { ...first, id: "replacement", ownerId: "replacement-owner", votes: 0, listOrder: 2 },
      ...input[0].candidates.slice(1),
    ];
    const result = buildBgOrdinaryElectionPlan(input);
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Fixture has replacement list");
    expect(result.candidateSeatsByElection[input[0].electionId][first.id]).toBe(0);
    expect(result.candidateSeatsByElection[input[0].electionId].replacement).toBeGreaterThan(0);
  });
  it("binds an independent to one district and one mandate", () => {
    const input = races();
    const district = BG_1991_ELECTORAL_DISTRICTS.find((row) => row.regionId === input[0].regionId)!;
    input[0].candidates = [
      ...input[0].candidates,
      {
        id: "independent",
        ownerId: "independent-owner",
        party: "independent",
        votes: 1_000_000,
        listOrder: 3,
        isNpc: false,
        eligible: true,
        independentDistrictId: district.id,
      },
    ];
    const result = buildBgOrdinaryElectionPlan(input);
    expect(result.kind).toBe("allocated");
    if (result.kind !== "allocated") throw new Error("Fixture has full party lists");
    expect(result.independentSeats).toBe(1);
    expect(result.candidateDistricts.independent).toBe(district.id);
    expect(result.candidateSeatsByElection[input[0].electionId].independent).toBe(1);
    expect(Object.values(result.partySeats).reduce((sum, n) => sum + n, 0)).toBe(239);
  });
  it("rejects missing regions and repeated human or NPC ownership across races", () => {
    expect(() => buildBgOrdinaryElectionPlan(races().slice(1))).toThrow(/coverage/);
    const input = races();
    input[1].candidates = input[1].candidates.map((row, index) =>
      index === 0 ? { ...row, ownerId: input[0].candidates[0].ownerId } : row
    );
    expect(() => buildBgOrdinaryElectionPlan(input)).toThrow(/identity/);
  });
});
