import { describe, expect, it } from "vitest";
import { countRussianCouncilBallotBatches as count } from "./councilVoteIncrement";
import type { RussianCouncilBallotInput } from "./councilResult";

function prior(): RussianCouncilBallotInput {
  return {
    registeredVoters: 1000,
    validBallots: 0,
    againstAllVotes: 0,
    options: [
      { id: "a", votes: 0, registrationOrder: 0 },
      { id: "b", votes: 0, registrationOrder: 1 },
      { id: "c", votes: 0, registrationOrder: 2 },
    ],
  };
}

describe("Council ballot batches", () => {
  it("counts mixed two-choice, single-choice and against-all ballots independently of marks", () => {
    const input = prior();
    const before = structuredClone(input);
    const result = count({
      prior: input,
      batches: [
        { count: 200, choices: ["a", "b"] },
        { count: 50, choices: ["c"] },
        { count: 25, choices: [] },
      ],
    });
    expect(result.validBallots).toBe(275);
    expect(result.againstAllVotes).toBe(25);
    expect(result.options.map((row) => row.votes)).toEqual([200, 200, 50]);
    expect(input).toEqual(before);
  });
  it("preserves prior ballots through several increments and reaches the register exactly", () => {
    const initial = count({ prior: prior(), batches: [{ count: 400, choices: ["a", "b"] }] });
    const result = count({
      prior: initial,
      batches: [
        { count: 500, choices: ["c"] },
        { count: 100, choices: [] },
      ],
    });
    expect(result.validBallots).toBe(1000);
    expect(result.options.map((row) => row.votes)).toEqual([400, 400, 500]);
    expect(() => count({ prior: result, batches: [{ count: 1, choices: [] }] })).toThrow(
      "register"
    );
  });
  it("does not overflow safe integers while counting two marks per ballot", () => {
    const input = prior();
    input.registeredVoters = Number.MAX_SAFE_INTEGER;
    const result = count({
      prior: input,
      batches: [{ count: Number.MAX_SAFE_INTEGER, choices: ["a", "b"] }],
    });
    expect(result.validBallots).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.options[0].votes).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.options[1].votes).toBe(Number.MAX_SAFE_INTEGER);
  });
  it.each([
    { count: -1, choices: ["a"] },
    { count: 0.5, choices: ["a"] },
    { count: Number.MAX_SAFE_INTEGER + 1, choices: ["a"] },
    { count: 1, choices: ["a", "a"] },
    { count: 1, choices: ["a", "b", "c"] },
    { count: 1, choices: ["missing"] },
    { count: 1001, choices: ["a"] },
  ])("rejects an invalid batch %# without changing prior counts", (batch) => {
    const input = prior();
    const before = structuredClone(input);
    expect(() => count({ prior: input, batches: [batch] })).toThrow();
    expect(input).toEqual(before);
  });
  it("rejects an inconsistent prior tally before adding batches", () => {
    const input = prior();
    input.options[0].votes = 1;
    expect(() => count({ prior: input, batches: [] })).toThrow();
  });
});
