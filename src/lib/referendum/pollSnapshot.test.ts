import { describe, it, expect } from "vitest";
import { upsertPollPoint } from "./pollSnapshot";

describe("upsertPollPoint", () => {
  it("appends a clamped reading in turn order", () => {
    const h = upsertPollPoint([{ turn: 1, yesShare: 50 }], 2, 120);
    expect(h).toEqual([
      { turn: 1, yesShare: 50 },
      { turn: 2, yesShare: 100 },
    ]);
  });

  it("clamps negatives to 0", () => {
    expect(upsertPollPoint([], 1, -5)).toEqual([{ turn: 1, yesShare: 0 }]);
  });

  it("is idempotent by turn — replaces the same-turn reading, no duplicate", () => {
    const h = upsertPollPoint([{ turn: 5, yesShare: 40 }], 5, 42);
    expect(h).toEqual([{ turn: 5, yesShare: 42 }]);
  });

  it("re-sorts when an out-of-order turn is inserted", () => {
    const h = upsertPollPoint([{ turn: 10, yesShare: 60 }], 3, 55);
    expect(h.map((p) => p.turn)).toEqual([3, 10]);
  });

  it("trims to the most recent `cap` readings", () => {
    let h: { turn: number; yesShare: number }[] = [];
    for (let t = 1; t <= 5; t++) h = upsertPollPoint(h, t, 50, 3);
    expect(h.map((p) => p.turn)).toEqual([3, 4, 5]);
  });

  it("treats undefined history as empty", () => {
    expect(upsertPollPoint(undefined, 1, 50)).toEqual([{ turn: 1, yesShare: 50 }]);
  });
});
