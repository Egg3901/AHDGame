import { describe, expect, it } from "vitest";
import {
  hasBankedGeneralTurn,
  oneRowPerTurn,
  planTurnSlice,
  sameTurnSliceParts,
  type TurnSlicePart,
} from "./turnSlice";

describe("planTurnSlice", () => {
  it("splits a turn into two halves that add up to one whole slice", () => {
    const whole = planTurnSlice([]);
    const early = planTurnSlice([], "early");
    const rest = planTurnSlice(["early"]);
    expect(whole).toEqual({ fraction: 1 });
    expect(early).toEqual({ slicePart: "early", fraction: 0.5 });
    expect(rest).toEqual({ slicePart: "rest", fraction: 0.5 });
    expect(early!.fraction + rest!.fraction).toBe(whole!.fraction);
  });

  it.each<[string, (TurnSlicePart | undefined)[], "early" | undefined]>([
    ["a second early tick", ["early"], "early"],
    ["an early tick after the whole turn", [undefined], "early"],
    ["the turn after it was counted whole", [undefined], undefined],
    ["the turn after both halves", ["early", "rest"], undefined],
    ["an early tick after both halves", ["early", "rest"], "early"],
  ])("counts nothing on %s", (_label, parts, slice) => {
    expect(planTurnSlice(parts, slice)).toBeNull();
  });
});

describe("sameTurnSliceParts", () => {
  it("reads the parts recorded for one turn only", () => {
    const rows = [{ turn: 4 }, { turn: 5, slicePart: "early" as const }, { turn: 6 }];
    expect(sameTurnSliceParts(rows, 5)).toEqual(["early"]);
    expect(sameTurnSliceParts(rows, 4)).toEqual([undefined]);
    expect(sameTurnSliceParts(undefined, 4)).toEqual([]);
  });
});

describe("hasBankedGeneralTurn", () => {
  it("needs a general snapshot or an accrual mark", () => {
    expect(hasBankedGeneralTurn(undefined)).toBe(false);
    expect(hasBankedGeneralTurn({ turnSnapshots: [] })).toBe(false);
    expect(hasBankedGeneralTurn({ turnSnapshots: [{ turn: 3 }] })).toBe(true);
    expect(hasBankedGeneralTurn({ turnSnapshots: [], lastAccruedTurn: 3 })).toBe(true);
  });
});

describe("oneRowPerTurn", () => {
  it("drops an early row once its turn has the rest", () => {
    const rows = [
      { turn: 1, id: "a" },
      { turn: 2, slicePart: "early" as const, id: "b" },
      { turn: 2, slicePart: "rest" as const, id: "c" },
      { turn: 3, slicePart: "early" as const, id: "d" },
    ];
    expect(oneRowPerTurn(rows).map((row) => row.id)).toEqual(["a", "c", "d"]);
    expect(oneRowPerTurn([...rows].reverse()).map((row) => row.id)).toEqual(["d", "c", "a"]);
  });
});
