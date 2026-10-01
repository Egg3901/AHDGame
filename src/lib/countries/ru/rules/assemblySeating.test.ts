import { describe, expect, it } from "vitest";
import {
  planRussianAssemblySeating as plan,
  type RussianAssemblySeatingNominee,
} from "./assemblySeating";
import { planRussianDumaDistricts } from "./assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import type { RussianDumaCohortBallot } from "./assemblyCohort";
import type { RussianCouncilCohortBallot } from "./councilCohort";
function scenario() {
  const registers = Object.fromEntries(
    Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 1000000])
  );
  const districts = planRussianDumaDistricts(registers);
  const dumaBallots: RussianDumaCohortBallot[] = districts.map((row, index) => ({
    id: `duma-${index}`,
    seatId: row.seatId,
    regionId: row.regionId,
    tier: "constituency",
    registeredVoters: row.registeredVoters,
    againstAllVotes: 0,
    candidates: [0, 1].map((order) => ({
      id: `duma-${index}-${order}`,
      ownerId: `duma-profile-${order}`,
      party: String(order + 1),
      isNpc: true,
      capacity: 1,
      eligible: true,
      registrationOrder: order,
      nominationOrder: order,
      votes:
        order === 0
          ? Math.ceil(row.registeredVoters * 0.6)
          : Math.floor(row.registeredVoters * 0.4),
    })),
  }));
  const national = Object.values(registers).reduce((sum, row) => sum + row, 0);
  dumaBallots.push({
    id: "national",
    seatId: "RU-duma-national-list",
    regionId: "RU",
    tier: "list",
    registeredVoters: national,
    againstAllVotes: 0,
    candidates: [0, 1, 2].map((order) => ({
      id: `list-${order}`,
      ownerId: `duma-profile-${order}`,
      party: String(order + 1),
      isNpc: true,
      capacity: 75,
      eligible: true,
      registrationOrder: order,
      nominationOrder: order,
      votes: Math.floor(national / 3),
    })),
  });
  const councilBallots: RussianCouncilCohortBallot[] = RUSSIAN_COUNCIL_SUBJECTS_1993.map(
    ([number, , regionId]) => ({
      id: `council-${number}`,
      seatId: `RU-council-${number}`,
      regionId,
      registeredVoters: 1000,
      validBallots: 1000,
      againstAllVotes: 0,
      candidates: [0, 1, 2].map((order) => ({
        id: `council-${number}-${order}`,
        ownerId: `council-profile-${order}`,
        party: String(order + 1),
        isNpc: true,
        eligible: true,
        registrationOrder: order,
        votes: [600, 500, 400][order],
      })),
    })
  );
  function nominees(
    ballots: readonly (RussianDumaCohortBallot | RussianCouncilCohortBallot)[]
  ): RussianAssemblySeatingNominee[] {
    return ballots.flatMap((ballot) =>
      ballot.candidates.map((candidate) => ({
        candidateId: candidate.id,
        ownerId: candidate.ownerId,
        isNpc: candidate.isNpc,
        name: `Nominee ${candidate.id}`,
        party: candidate.party,
      }))
    );
  }
  return {
    duma: { ballots: dumaBallots, nominees: nominees(dumaBallots) },
    council: { ballots: councilBallots, nominees: nominees(councilBallots) },
  };
}
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
