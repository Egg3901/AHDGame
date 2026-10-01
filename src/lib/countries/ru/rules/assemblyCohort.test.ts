import { describe, expect, it } from "vitest";
import { planRussianDumaDistricts } from "./assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import {
  resolveRussianDumaCohort as resolve,
  type RussianDumaCohortBallot,
  type RussianDumaCohortCandidate,
} from "./assemblyCohort";
const candidate = (id: string, votes: number): RussianDumaCohortCandidate => ({
  id,
  ownerId: id,
  party: "party",
  votes,
  registrationOrder: 0,
  nominationOrder: 0,
  isNpc: true,
  capacity: 225,
  eligible: true,
});
function scenario(): RussianDumaCohortBallot[] {
  const register = Object.fromEntries(
    Object.keys(RU_1991_ECONOMIC_REGION_POPULATION).map((id) => [id, 10000])
  );
  const districts = planRussianDumaDistricts(register);
  return [
    ...districts.map((row, index) => ({
      id: `election-${index}`,
      seatId: row.seatId,
      regionId: row.regionId,
      tier: "constituency" as const,
      registeredVoters: row.registeredVoters,
      againstAllVotes: 0,
      candidates: [{ ...candidate(`district-npc-${index}`, row.registeredVoters), capacity: 1 }],
    })),
    {
      id: "list-election",
      seatId: "RU-duma-national-list",
      regionId: "RU",
      tier: "list",
      registeredVoters: 100000,
      againstAllVotes: 0,
      candidates: [candidate("list-slate", 100000)],
    },
  ];
}
describe("Complete first-Duma cohort certification", () => {
  it("certifies 225 individual winners and 225 list mandates from the same frozen register", () => {
    const result = resolve(scenario());
    expect(result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(result.listAssignment?.seatsByNominee).toEqual({ "list-slate": 225 });
  });
  it("preserves a failed constituency as a vacancy without blocking other results", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    const result = resolve(ballots);
    expect(result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    expect(
      result.constituencyResults.find((row) => row.electionId === ballots[0].id)?.decision
    ).toMatchObject({ outcome: "repeat", reason: "low-valid-turnout" });
    expect(result.listAssignment?.seatsByNominee["list-slate"]).toBe(225);
  });
  it("does not seat an invalid or retired winning owner", () => {
    const ballots = scenario();
    ballots[0].candidates[0].eligible = false;
    expect(
      resolve(ballots).constituencyResults.find((row) => row.electionId === ballots[0].id)
    ).toMatchObject({ winner: null, decision: { reason: "ineligible-winner" } });
  });
  it("keeps a constituency player out of the list while passing the mandate to the NPC slate", () => {
    const ballots = scenario();
    Object.assign(ballots[0].candidates[0], { ownerId: "player-owner", isNpc: false, capacity: 1 });
    ballots[225].candidates = [
      { ...candidate("player-list", 1000), ownerId: "player-owner", isNpc: false, capacity: 1 },
      { ...candidate("list-slate", 99000), nominationOrder: 1 },
    ];
    expect(resolve(ballots).listAssignment?.seatsByNominee).toEqual({
      "player-list": 0,
      "list-slate": 225,
    });
  });
  it("does not certify a list with no eligible vote shares or invent candidates", () => {
    const ballots = scenario();
    ballots[225].candidates[0].votes = 1000;
    ballots[225].againstAllVotes = 99000;
    expect(resolve(ballots)).toMatchObject({
      listDecision: { outcome: "repeat", reason: "no-eligible-list" },
      listAssignment: null,
    });
    ballots[225].candidates[0].votes = 100000;
    ballots[225].againstAllVotes = 0;
    ballots[225].candidates[0].eligible = false;
    expect(resolve(ballots).listAssignment?.vacanciesByParty).toEqual({ party: 225 });
  });
  it("rejects an incomplete map or registration modified between tiers", () => {
    const ballots = scenario();
    expect(() => resolve(ballots.slice(1))).toThrow("226");
    ballots[225].registeredVoters++;
    expect(() => resolve(ballots)).toThrow("registration");
  });
  it("rejects multiple constituency candidacies or list nominations owned by one player", () => {
    const ballots = scenario();
    Object.assign(ballots[0].candidates[0], { ownerId: "player", isNpc: false, capacity: 1 });
    Object.assign(ballots[1].candidates[0], { ownerId: "player", isNpc: false, capacity: 1 });
    expect(() => resolve(ballots)).toThrow("multiple Duma constituencies");
    ballots[1].candidates[0].ownerId = "other";
    ballots[225].candidates = [
      candidate("first-list", 50000),
      { ...candidate("second-list", 50000), ownerId: "first-list" },
    ];
    expect(() => resolve(ballots)).toThrow("multiple Duma list nominations");
  });
  it("produces the same receipt order regardless of database row order", () => {
    const ballots = scenario();
    expect(resolve([...ballots].reverse())).toEqual(resolve(ballots));
  });
  it("rejects multi-seat constituency nominees and independent national lists", () => {
    const ballots = scenario();
    ballots[0].candidates[0].capacity = 2;
    expect(() => resolve(ballots)).toThrow("only one seat");
    ballots[0].candidates[0].capacity = 1;
    ballots[225].candidates[0].party = "independent";
    expect(() => resolve(ballots)).toThrow("Independent");
  });
});
