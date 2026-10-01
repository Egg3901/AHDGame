import { describe, expect, it } from "vitest";
import { russianCouncilVoteTotals as count } from "./councilVoteTotals";
type CountInput = Parameters<typeof count>[0];
function fixture(): Omit<CountInput, "nominees" | "rawVotes"> & {
  nominees: Array<CountInput["nominees"][number]>;
  rawVotes: Record<string, number>;
} {
  return {
    registeredVoters: 100,
    priorVotes: {},
    rawVotes: { a: 40, b: 30, c: 30 },
    nominees: ["a", "b", "c"].map((id, index) => ({
      id,
      registrationOrder: index,
      economicLean: 0,
      socialLean: 0,
      favorability: 100,
    })),
  };
}
describe("Council native first and second choices", () => {
  it("counts new against-all ballots once alongside candidate choices", () => {
    const input = fixture();
    const result = count({ ...input, rawVotes: { a: 20, b: 15, c: 15 }, rawAgainstAllVotes: 50 });
    expect(result.ledger.validBallots).toBe(100);
    expect(result.ledger.againstAllVotes).toBe(50);
    expect(result.batches.filter((row) => row.choices.length === 0)).toEqual([
      { count: 50, choices: [] },
    ]);
    expect(Object.values(result.votes).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(50);
    expect(Object.values(result.votes).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(100);
  });
  it("continues an existing registered poll after a withdrawal", () => {
    const input = fixture();
    input.nominees.pop();
    delete input.rawVotes.c;
    const result = count({
      ...input,
      priorVotes: { c: 5 },
      ledger: {
        registeredVoters: 100,
        validBallots: 5,
        againstAllVotes: 0,
        registrationOrderByCandidate: { a: 0, b: 1, c: 2 },
      },
    });
    expect(result.ledger.validBallots).toBe(75);
    expect(result.votes.c).toBe(5);
    expect(result.batches.every((row) => !row.choices.includes("c"))).toBe(true);
  });
  it("counts voters once while producing distinct optional second marks", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = count(input);
    expect(result.ledger.validBallots).toBe(100);
    expect(result.votes).toEqual({ a: 58, b: 46, c: 46 });
    expect(result.batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(100);
    expect(result.batches.some((batch) => batch.choices.length === 2)).toBe(true);
    expect(
      result.batches.every((batch) => new Set(batch.choices).size === batch.choices.length)
    ).toBe(true);
    expect(input).toEqual(before);
  });
  it("keeps one-choice ballots when alternatives have no approval", () => {
    const input = fixture();
    input.nominees.forEach((row) => (row.favorability = 0));
    const result = count(input);
    expect(result.votes).toEqual(input.rawVotes);
    expect(result.batches.every((batch) => batch.choices.length === 1)).toBe(true);
  });
  it("caps voters using valid ballots rather than the larger prior mark total", () => {
    const input = fixture();
    const prior = count({ ...input, rawVotes: { a: 20, b: 15, c: 15 } });
    const result = count({ ...input, priorVotes: prior.votes, ledger: prior.ledger });
    expect(prior.ledger.validBallots).toBe(50);
    expect(Object.values(prior.votes).reduce((a, b) => a + b, 0)).toBeGreaterThan(50);
    expect(result.ledger.validBallots).toBe(100);
    expect(result.batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(50);
    expect(Object.values(result.votes).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
  });
  it("preserves against-all voters and counted withdrawn nominees", () => {
    const input = fixture();
    const result = count({
      ...input,
      priorVotes: { x: 20 },
      ledger: {
        registeredVoters: 100,
        validBallots: 30,
        againstAllVotes: 10,
        registrationOrderByCandidate: { x: 0, a: 0, b: 1, c: 2 },
      },
    });
    expect(result.votes.x).toBe(20);
    expect(result.ledger.againstAllVotes).toBe(10);
    expect(result.ledger.validBallots).toBe(100);
    expect(result.batches.every((batch) => !batch.choices.includes("x"))).toBe(true);
  });
  it("defers additional voting when fewer than three nominees remain", () => {
    const input = fixture();
    input.nominees.pop();
    delete input.rawVotes.c;
    const result = count(input);
    expect(result.ledger.validBallots).toBe(0);
    expect(result.batches).toEqual([]);
  });
  it("does not invent support for an alternative with no first-choice weight", () => {
    const input = fixture();
    input.rawVotes = { a: 100, b: 0, c: 0 };
    const result = count(input);
    expect(result.votes).toEqual({ a: 100, b: 0, c: 0 });
    expect(result.batches).toEqual([{ count: 100, choices: ["a"] }]);
  });
  it("is independent of nominee and raw-weight input ordering", () => {
    const input = fixture();
    expect(
      count({
        ...input,
        nominees: [...input.nominees].reverse(),
        rawVotes: { c: 30, b: 30, a: 40 },
      })
    ).toEqual(count(input));
  });
  it("returns no new ballots after the frozen register is exhausted", () => {
    const input = fixture();
    const first = count(input);
    const result = count({ ...input, priorVotes: first.votes, ledger: first.ledger });
    expect(result.votes).toEqual(first.votes);
    expect(result.batches).toEqual([]);
    expect(result.ledger).toEqual(first.ledger);
  });
  it.each([
    "missing-ledger",
    "register",
    "order",
    "late-nominee",
    "unknown-weight",
    "negative-weight",
    "stat",
  ])("rejects invalid %s", (reason) => {
    const input = fixture();
    if (reason === "missing-ledger") input.priorVotes = { a: 1 };
    if (reason === "register")
      input.ledger = {
        registeredVoters: 99,
        validBallots: 0,
        againstAllVotes: 0,
        registrationOrderByCandidate: {},
      };
    if (reason === "order")
      input.ledger = {
        registeredVoters: 100,
        validBallots: 0,
        againstAllVotes: 0,
        registrationOrderByCandidate: { a: 4 },
      };
    if (reason === "late-nominee") {
      input.priorVotes = { a: 1 };
      input.ledger = {
        registeredVoters: 100,
        validBallots: 1,
        againstAllVotes: 0,
        registrationOrderByCandidate: { a: 0 },
      };
    }
    if (reason === "unknown-weight") input.rawVotes.z = 1;
    if (reason === "negative-weight") input.rawVotes.a = -1;
    if (reason === "stat") input.nominees[0].favorability = Infinity;
    expect(() => count(input)).toThrow();
  });
});
