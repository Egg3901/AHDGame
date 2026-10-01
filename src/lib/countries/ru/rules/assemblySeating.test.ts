import { describe, expect, it } from "vitest";
import { planRussianAssemblySeating as plan } from "./assemblySeating";
import { russianAssemblySeatingScenario as scenario } from "../testing/assemblySeatingScenario";
describe("Joint Assembly seating plan", () => {
  it("plans450 Duma and178 Council mandates without copying NPC account identities", () => {
    const input = scenario();
    const before = structuredClone(input);
    const result = plan(input);
    expect(result).toMatchObject({
      dumaSeats: 450,
      councilSeats: 178,
      dumaVacancies: 0,
      councilVacancies: 0,
      seatsByParty: { "1": 300, "2": 75, "3": 75 },
    });
    expect(result.seats).toHaveLength(406);
    expect(result.owners.find((row) => row.ownerId === "duma-profile-0")?.seatsHeld).toBe(300);
    expect(input).toEqual(before);
  });
  it("preserves failed constituency and lawful Council vacancies without awarding runners-up", () => {
    const input = scenario();
    input.duma.ballots[0].candidates.forEach((row) => (row.votes = 0));
    input.council.ballots[0].againstAllVotes = 600;
    input.council.ballots[0].candidates.forEach(
      (row, index) => (row.votes = [300, 250, 150][index])
    );
    expect(plan(input)).toMatchObject({
      dumaSeats: 449,
      councilSeats: 177,
      dumaVacancies: 1,
      councilVacancies: 1,
    });
  });
  it("keeps empty party-list capacity visible instead of inventing NPC mandates", () => {
    const input = scenario();
    input.duma.ballots.at(-1)!.candidates.forEach((row) => (row.capacity = 1));
    expect(plan(input)).toMatchObject({ dumaSeats: 228, dumaVacancies: 222 });
  });
  it.each(["missing-name", "wrong-owner", "wrong-party", "wrong-kind", "duplicate-nominee"])(
    "rejects %s receipt metadata",
    (defect) => {
      const input = scenario();
      const row = input.council.nominees[0];
      if (defect === "missing-name") row.name = " ";
      if (defect === "wrong-owner") row.ownerId = "other";
      if (defect === "wrong-party") row.party = "other";
      if (defect === "wrong-kind") row.isNpc = false;
      if (defect === "duplicate-nominee") input.council.nominees.push({ ...row });
      expect(() => plan(input)).toThrow();
    }
  );
  it("rejects profiles reserved into both chambers", () => {
    const input = scenario();
    input.council.ballots[0].candidates[0].ownerId = "duma-profile-0";
    input.council.nominees[0].ownerId = "duma-profile-0";
    expect(() => plan(input)).toThrow("disjoint");
  });
  it("limits an eligible player to one individual mandate while retaining their identity", () => {
    const input = scenario();
    input.council.ballots[0].candidates[0].isNpc = false;
    input.council.nominees[0].isNpc = false;
    expect(plan(input).seats.find((row) => row.candidateId === "council-1-0")).toMatchObject({
      isNpc: false,
      seatsHeld: 1,
      ownerId: "council-profile-0",
    });
  });
  it("accepts a certified repeat family with fresh registers in only failed polls", () => {
    const input = scenario();
    input.council.ballots[0].registeredVoters = 2000;
    expect(plan({ ...input, council: { ...input.council, generation: 1 } }).councilSeats).toBe(178);
    expect(() => plan({ ...input, council: { ...input.council, generation: -1 } })).toThrow(
      "generation"
    );
  });
});
