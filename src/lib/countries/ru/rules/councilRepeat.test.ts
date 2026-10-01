import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import type { RussianCouncilCohortBallot } from "./councilCohort";
import {
  pendingRussianCouncilRepeatBallots as pending,
  resolveRussianCouncilRepeat as resolve,
} from "./councilRepeat";
function scenario(): RussianCouncilCohortBallot[] {
  return RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , regionId]) => ({
    id: `ballot-${number}`,
    seatId: `RU-council-${number}`,
    regionId,
    registeredVoters: 1000,
    validBallots: 1000,
    againstAllVotes: 0,
    candidates: [0, 1, 2].map((order) => ({
      id: `nominee-${number}-${order}`,
      ownerId: `profile-${order}`,
      party: String(order + 1),
      isNpc: true,
      eligible: true,
      registrationOrder: order,
      votes: [600, 500, 400][order],
    })),
  }));
}
function fail(ballot: RussianCouncilCohortBallot) {
  ballot.validBallots = 0;
  ballot.candidates = ballot.candidates.map((row) => ({ ...row, votes: 0 }));
}
function replacement(ballot: RussianCouncilCohortBallot): RussianCouncilCohortBallot {
  return {
    ...ballot,
    id: `${ballot.id}-next`,
    registeredVoters: 500,
    validBallots: 500,
    candidates: ballot.candidates.map((row, index) => ({
      ...row,
      id: `${row.id}-next`,
      votes: [300, 250, 200][index],
    })),
  };
}
describe("Council repeat generations preserve successful mandates", () => {
  it("does not reopen a valid subject with a lawful second-seat vacancy", () => {
    const previous = scenario();
    fail(previous[0]);
    previous[1].againstAllVotes = 600;
    previous[1].candidates = previous[1].candidates.map((row, index) => ({
      ...row,
      votes: [300, 250, 150][index],
    }));
    expect(pending(previous).map((row) => row.seatId)).toEqual(["RU-council-1"]);
    const result = resolve({ previous, replacements: [replacement(previous[0])] });
    expect(result.ballots[1]).toBe(previous[1]);
    expect(result.result[1].winners).toHaveLength(1);
    expect(result.result[1].vacancies).toBe(1);
    expect(result.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(177);
  });
  it("uses fresh registers only for failed polls and keeps every successful ballot unchanged", () => {
    const previous = scenario();
    fail(previous[0]);
    fail(previous[88]);
    const next = resolve({
      previous,
      replacements: [replacement(previous[88]), replacement(previous[0])],
    });
    expect(next.ballots[0].registeredVoters).toBe(500);
    expect(next.ballots[88].registeredVoters).toBe(500);
    for (let i = 1; i < 88; i++) expect(next.ballots[i]).toBe(previous[i]);
    expect(next.result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(178);
  });
  it("retains another failure for the next generation instead of forcing a result", () => {
    const previous = scenario();
    fail(previous[0]);
    const fresh = replacement(previous[0]);
    fail(fresh);
    const next = resolve({ previous, replacements: [fresh] });
    expect(pending(next.ballots).map((row) => row.id)).toEqual([fresh.id]);
    const third = resolve({ previous: next.ballots, replacements: [replacement(fresh)] });
    expect(pending(third.ballots)).toEqual([]);
  });
  it("sorts failed subjects by their stable district number", () => {
    const previous = scenario();
    fail(previous[0]);
    fail(previous[9]);
    fail(previous[88]);
    expect(pending([...previous].reverse()).map((row) => row.seatId)).toEqual([
      "RU-council-1",
      "RU-council-10",
      "RU-council-89",
    ]);
  });
  it.each([
    "missing",
    "extra",
    "duplicate-subject",
    "duplicate-id",
    "old-id",
    "wrong-region",
    "successful-subject",
  ])("rejects %s replacements", (defect) => {
    const previous = scenario();
    fail(previous[0]);
    fail(previous[1]);
    const replacements = [replacement(previous[0]), replacement(previous[1])];
    if (defect === "missing") replacements.pop();
    if (defect === "extra") replacements.push(replacement(previous[2]));
    if (defect === "duplicate-subject") replacements[1].seatId = replacements[0].seatId;
    if (defect === "duplicate-id") replacements[1].id = replacements[0].id;
    if (defect === "old-id") replacements[0].id = previous[5].id;
    if (defect === "wrong-region") replacements[0].regionId = "CEN";
    if (defect === "successful-subject") replacements[0] = replacement(previous[2]);
    expect(() => resolve({ previous, replacements })).toThrow();
  });
  it("does not allow a certified player to win another subject in the repeat", () => {
    const previous = scenario();
    fail(previous[0]);
    previous[1].candidates = previous[1].candidates.map((row, index) =>
      index === 0 ? { ...row, isNpc: false, ownerId: "player" } : row
    );
    const fresh = replacement(previous[0]);
    fresh.candidates = fresh.candidates.map((row, index) =>
      index === 0 ? { ...row, isNpc: false, ownerId: "player" } : row
    );
    expect(() => resolve({ previous, replacements: [fresh] })).toThrow("player");
  });
  it("lets an earlier losing player contest a later failed poll without changing the old result", () => {
    const previous = scenario();
    fail(previous[0]);
    previous[1].candidates = previous[1].candidates.map((row, index) =>
      index === 2 ? { ...row, isNpc: false, ownerId: "player" } : row
    );
    const fresh = replacement(previous[0]);
    fresh.candidates = fresh.candidates.map((row, index) =>
      index === 0 ? { ...row, isNpc: false, ownerId: "player" } : row
    );
    const next = resolve({ previous, replacements: [fresh] });
    expect(next.result[0].winners[0].ownerId).toBe("player");
    expect(next.result[1].winners.every((row) => row.isNpc)).toBe(true);
    expect(pending(next.ballots)).toEqual([]);
  });
  it("still rejects two current-generation candidacies for a player who wins neither", () => {
    const previous = scenario();
    fail(previous[0]);
    fail(previous[1]);
    const replacements = [replacement(previous[0]), replacement(previous[1])];
    for (const ballot of replacements)
      ballot.candidates = ballot.candidates.map((row, index) =>
        index === 2 ? { ...row, isNpc: false, ownerId: "player" } : row
      );
    expect(() => resolve({ previous, replacements })).toThrow("player");
  });
  it("does not open a repeat when all89 polls succeeded", () => {
    const previous = scenario();
    expect(pending(previous)).toEqual([]);
    expect(() => resolve({ previous, replacements: [] })).toThrow();
  });
});
