import { describe, expect, it } from "vitest";
import { castRankedBallots, countPrStv, mergeRankedBallots, validateRankedBallots } from "./prStv";

describe("persisted ranked PR-STV ballots", () => {
  it("elects a transfer winner who loses on first preferences", () => {
    const result = countPrStv(["a", "b", "c", "d"], 2, [
      { weight: 45, preferences: ["a", "c"] },
      { weight: 30, preferences: ["b"] },
      { weight: 20, preferences: ["c"] },
      { weight: 5, preferences: ["d", "c"] },
    ]);
    expect(result.quota).toBe(34);
    expect(result.elected).toEqual(["a", "c"]);
    expect(result.seats).toEqual({ a: 1, b: 0, c: 1, d: 0 });
    expect(result.rounds.map((r) => r.action)).toEqual(["elect", "eliminate", "elect"]);
    expect(result.rounds[0].transferValue).toBeCloseTo(11 / 45);
    for (const r of result.rounds) expect(r.conservationResidual).toBeCloseTo(0, 8);
  });

  it("keeps the same first-preference totals but changes the winner when preferences change", () => {
    const result = countPrStv(["a", "b", "c", "d"], 2, [
      { weight: 45, preferences: ["a", "b"] },
      { weight: 30, preferences: ["b"] },
      { weight: 20, preferences: ["c"] },
      { weight: 5, preferences: ["d", "c"] },
    ]);
    expect(result.elected).toEqual(["a", "b"]);
  });

  it("preserves the weight of fractional parcels through another elimination", () => {
    const result = countPrStv(["a", "b", "c", "d"], 2, [
      { weight: 40, preferences: ["a", "d", "c"] },
      { weight: 25, preferences: ["b"] },
      { weight: 24, preferences: ["c"] },
      { weight: 11, preferences: ["d", "c"] },
    ]);
    expect(result.elected).toEqual(["a", "c"]);
    expect(result.rounds[1].candidates).toEqual(["d"]);
    expect(result.rounds[2].totals.c).toBeCloseTo(41);
    for (const r of result.rounds) expect(r.conservationResidual).toBeCloseTo(0, 8);
  });

  it("skips unavailable candidates and accounts for exhausted preferences", () => {
    const result = countPrStv(["a", "b", "c"], 2, [
      { weight: 50, preferences: ["withdrawn", "a", "c"] },
      { weight: 30, preferences: ["b"] },
      { weight: 15, preferences: ["c"] },
      { weight: 5, preferences: ["withdrawn"] },
    ]);
    expect(result.totalBallots).toBe(100);
    expect(result.quota).toBe(34);
    expect(result.elected).toEqual(["a", "c"]);
    expect(result.rounds[0].exhausted).toBe(5);
  });

  it("elects the last remaining candidates below quota without manufacturing ballot value", () => {
    const result = countPrStv(["a", "b", "c"], 2, [
      { weight: 90, preferences: ["a"] },
      { weight: 6, preferences: ["b"] },
      { weight: 4, preferences: ["c"] },
    ]);
    expect(result.elected).toEqual(["a", "b"]);
    expect(result.rounds.at(-1)?.action).toBe("elect_remaining");
    expect(result.rounds.at(-1)?.exhausted).toBe(60);
    expect(result.rounds.at(-1)?.retained).toBe(40);
  });

  it("uses countback before stable identity to break an elimination tie", () => {
    const result = countPrStv(["a", "b", "c", "d"], 2, [
      { weight: 40, preferences: ["a", "c"] },
      { weight: 25, preferences: ["b"] },
      { weight: 15, preferences: ["c"] },
      { weight: 20, preferences: ["d", "c"] },
    ]);
    // a's six surplus votes give c 21; d remains lowest, then transfers to c.
    expect(result.elected).toEqual(["a", "c"]);
    const tie = countPrStv(["b", "a", "c"], 1, [
      { weight: 5, preferences: ["a"] },
      { weight: 5, preferences: ["b"] },
      { weight: 5, preferences: ["c"] },
    ]);
    expect(tie.elected).toEqual(["a"]);
    expect(tie).toEqual(
      countPrStv(["c", "a", "b"], 1, [
        { weight: 5, preferences: ["a"] },
        { weight: 5, preferences: ["b"] },
        { weight: 5, preferences: ["c"] },
      ])
    );
  });

  it("uses an earlier unequal count when current elimination totals are tied", () => {
    const result = countPrStv(["a", "z", "b", "d"], 2, [
      { weight: 40, preferences: ["a", "b"] },
      { weight: 25, preferences: ["z"] },
      { weight: 19, preferences: ["b"] },
      { weight: 16, preferences: ["d"] },
    ]);
    expect(result.rounds[2].totals).toEqual({ z: 25, b: 25 });
    expect(result.rounds[2].candidates).toEqual(["b"]);
    expect(result.elected).toEqual(["a", "z"]);
  });

  it("does not lose a one-ballot countback difference in a large valid poll", () => {
    const result = countPrStv(["a", "b", "c", "d"], 1, [
      { weight: 4_000_000_000_000, preferences: ["a"] },
      { weight: 3_000_000_000_000, preferences: ["c", "b"] },
      { weight: 2_999_999_999_999, preferences: ["b", "a"] },
      { weight: 1, preferences: ["d", "b"] },
    ]);
    expect(result.elected).toEqual(["a"]);
    expect(result.rounds[1].candidates).toEqual(["b"]);
    expect(result.arithmetic).toBe("exact_rational");
    expect(result.rounds.every((round) => round.conservationResidual === 0)).toBe(true);
  });

  it.each([
    [{ preferences: ["a", "a"], weight: 1 }],
    [{ preferences: [], weight: 1 }],
    [{ preferences: ["a"], weight: -1 }],
    [{ preferences: ["a"], weight: 1.5 }],
    [{ preferences: ["a"], weight: Infinity }],
  ])("rejects invalid original ballots", (...ballots) => {
    expect(() => countPrStv(["a", "b"], 1, ballots)).toThrow(/invalid/);
  });

  it("rejects absent, inconsistent or invented preference evidence", () => {
    expect(() => validateRankedBallots(undefined, { a: 1 })).toThrow(/requires/);
    expect(() => validateRankedBallots([{ weight: 2, preferences: ["a"] }], { a: 1 })).toThrow(
      /disagree/
    );
    expect(() =>
      validateRankedBallots([{ weight: 1, preferences: ["a", "invented"] }], { a: 1 })
    ).toThrow(/invalid/);
    expect(() => countPrStv(["a"], 2, [{ weight: 1, preferences: ["a"] }])).toThrow(/smaller/);
    expect(() => countPrStv(["a", "a"], 1, [{ weight: 1, preferences: ["a"] }])).toThrow(
      /distinct/
    );
  });

  it("casts the documented synthetic ranking at the original turn and compacts repeated rankings", () => {
    const roster = [
      { candidateId: "a", party: "1", charEP: -2, charSP: 0 },
      { candidateId: "b", party: "1", charEP: 3, charSP: 0 },
      { candidateId: "c", party: "2", charEP: -1, charSP: 0 },
    ];
    const cast = castRankedBallots(roster, { a: 45, b: 0, c: 30 });
    expect(cast[0]).toEqual({ weight: 45, preferences: ["a", "b", "c"] });
    expect(cast[1]).toEqual({ weight: 30, preferences: ["c", "a", "b"] });
    const merged = mergeRankedBallots(cast, cast);
    expect(merged.map((b) => b.weight)).toEqual([90, 60]);
    validateRankedBallots(merged, { a: 90, b: 0, c: 60 });
    expect(cast[0].weight).toBe(45);
  });
});
