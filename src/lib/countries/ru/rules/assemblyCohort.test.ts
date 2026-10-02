import { describe, expect, it } from "vitest";
import { planRussianDumaDistricts } from "./assemblyDistricts";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import {
  resolveRussianDumaCohort as resolve,
  resolveRussianDumaRepeatGeneration as repeat,
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

function replacement(
  old: RussianDumaCohortBallot,
  registeredVoters = old.registeredVoters + 7
): RussianDumaCohortBallot {
  return {
    ...old,
    id: `${old.id}-repeat`,
    registeredVoters,
    againstAllVotes: 0,
    invalidated: false,
    candidates: [
      {
        ...candidate(`${old.id}-new-nominee`, registeredVoters),
        capacity: old.tier === "list" ? 225 : 1,
      },
    ],
  };
}
describe("Duma repeat generations", () => {
  it("retains successful districts and the old list while a failed district gets a new register", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    const original = structuredClone(ballots);
    const next = replacement(ballots[0]);
    const result = repeat({ previousBallots: ballots, replacements: [next] });
    expect(result.result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(result.ballots[0]).toBe(next);
    expect(result.ballots[1]).toBe(ballots[1]);
    expect(result.ballots[225]).toBe(ballots[225]);
    expect(result.result.listAssignment).toEqual(resolve(ballots).listAssignment);
    expect(ballots).toEqual(original);
    expect(() => resolve(result.ballots)).toThrow("registration");
  });
  it("repeats a failed national list without recasting valid constituency votes", () => {
    const ballots = scenario();
    ballots[225].candidates[0].votes = 1000;
    ballots[225].againstAllVotes = 99000;
    const oldDistricts = resolve(ballots).constituencyResults;
    const result = repeat({
      previousBallots: ballots,
      replacements: [replacement(ballots[225], 80000)],
    });
    expect(result.result.constituencyResults).toEqual(oldDistricts);
    expect(result.result.listDecision.outcome).toBe("elected");
    expect(result.result.listAssignment?.seatsByNominee).toEqual({
      "list-election-new-nominee": 225,
    });
  });
  it("keeps a repeated failure pending and accepts another generation with its own register", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    const first = replacement(ballots[0], 90);
    first.candidates[0].votes = 0;
    const next = repeat({ previousBallots: ballots, replacements: [first] });
    expect(next.result.constituencyResults.filter((row) => row.winner)).toHaveLength(224);
    const second = repeat({
      previousBallots: next.ballots,
      replacements: [replacement(first, 30)],
    });
    expect(second.result.constituencyResults.filter((row) => row.winner)).toHaveLength(225);
    expect(second.ballots[0].registeredVoters).toBe(30);
    expect(second.ballots[225].registeredVoters).toBe(100000);
  });
  it("moves a player from a list mandate to a repeat constituency while retaining total list seats", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    ballots[225].candidates = [
      { ...candidate("player-list", 1000), ownerId: "player", isNpc: false, capacity: 1 },
      { ...candidate("list-slate", 99000), nominationOrder: 1 },
    ];
    expect(resolve(ballots).listAssignment?.seatsByNominee["player-list"]).toBe(1);
    const next = replacement(ballots[0]);
    Object.assign(next.candidates[0], { ownerId: "player", isNpc: false });
    const result = repeat({ previousBallots: ballots, replacements: [next] });
    expect(result.result.listAssignment?.seatsByNominee).toEqual({
      "player-list": 0,
      "list-slate": 225,
    });
    expect(
      result.result.constituencyResults.filter((row) => row.winner?.ownerId === "player")
    ).toHaveLength(1);
  });
  it("lets a previous constituency loser contest a vacancy without treating their old votes as another mandate", () => {
    const ballots = scenario();
    const first = ballots[0];
    first.candidates[0].votes--;
    first.candidates = [
      ...first.candidates,
      { ...candidate("player-lost", 1), ownerId: "player", isNpc: false, capacity: 1 },
    ];
    ballots[1].candidates[0].votes = 0;
    const next = replacement(ballots[1]);
    Object.assign(next.candidates[0], { ownerId: "player", isNpc: false });
    const result = repeat({ previousBallots: ballots, replacements: [next] });
    expect(
      result.result.constituencyResults.filter((row) => row.winner?.ownerId === "player")
    ).toHaveLength(1);
    expect(result.ballots[0]).toBe(first);
  });
  it("rejects protected winners and duplicate live player constituency nominations", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    Object.assign(ballots[1].candidates[0], { ownerId: "player", isNpc: false });
    const next = replacement(ballots[0]);
    Object.assign(next.candidates[0], { ownerId: "player", isNpc: false });
    expect(() => repeat({ previousBallots: ballots, replacements: [next] })).toThrow(
      "another constituency"
    );
    ballots[1].candidates[0].votes = 0;
    const another = replacement(ballots[1]);
    Object.assign(another.candidates[0], { ownerId: "player", isNpc: false });
    expect(() => repeat({ previousBallots: ballots, replacements: [next, another] })).toThrow(
      "another constituency"
    );
  });
  it("rejects missing or successful replacement targets and stale identities", () => {
    const ballots = scenario();
    ballots[0].candidates[0].votes = 0;
    expect(() => repeat({ previousBallots: ballots, replacements: [] })).toThrow("exactly");
    expect(() =>
      repeat({ previousBallots: ballots, replacements: [replacement(ballots[1])] })
    ).toThrow("exactly");
    const next = replacement(ballots[0]);
    next.id = ballots[0].id;
    expect(() => repeat({ previousBallots: ballots, replacements: [next] })).toThrow(
      "new identities"
    );
    next.id += "-fresh";
    next.candidates[0].id = ballots[0].candidates[0].id;
    expect(() => repeat({ previousBallots: ballots, replacements: [next] })).toThrow(
      "new identities"
    );
    const foreign = { ...replacement(ballots[0]), regionId: "foreign" };
    expect(() => repeat({ previousBallots: ballots, replacements: [foreign] })).toThrow(
      "territories"
    );
  });
  it("records empty replacement districts as repeat vacancies without invalidating the old list", () => {
    const ballots = scenario();
    for (const row of ballots.slice(0, 225)) row.candidates[0].votes = 0;
    const replacements = ballots
      .slice(0, 225)
      .map((row) => ({ ...replacement(row, 0), candidates: [] }));
    const result = repeat({ previousBallots: ballots, replacements });
    expect(result.result.constituencyResults.every((row) => row.winner === null)).toBe(true);
    expect(result.result.listDecision.outcome).toBe("elected");
  });
});
