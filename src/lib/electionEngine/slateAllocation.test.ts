import { describe, it, expect } from "vitest";
import { splitGroupPoolBySlate, slateKey, type SlateSplitMember } from "./slateAllocation";

const m = (candidateId: string, party: string | undefined, weight: number): SlateSplitMember => ({
  candidateId,
  party,
  weight,
});

/** Legacy per-candidate split, kept here as the byte-identity oracle. */
function legacySplit(groupPool: number, members: SlateSplitMember[]): Record<string, number> {
  const total = members.reduce((s, x) => s + x.weight, 0);
  const out: Record<string, number> = {};
  if (total > 0) {
    for (const x of members) out[x.candidateId] = groupPool * (x.weight / total);
  } else {
    for (const x of members) out[x.candidateId] = groupPool / members.length;
  }
  return out;
}

describe("slateKey", () => {
  it("pools same-party candidates and leaves independents standing alone", () => {
    expect(slateKey("1", "a")).toBe(slateKey("1", "b"));
    expect(slateKey("independent", "a")).not.toBe(slateKey("independent", "b"));
    expect(slateKey(undefined, "a")).toBe("cand:a");
  });
});

describe("splitGroupPoolBySlate: byte-identity guarantees", () => {
  it("matches the legacy per-candidate split when every party fields one candidate", () => {
    const members = [m("a", "1", 3), m("b", "2", 2), m("c", "3", 1)];
    expect(splitGroupPoolBySlate(1000, members)).toEqual(legacySplit(1000, members));
  });

  it("matches the legacy split for a primary (all candidates share one party)", () => {
    const members = [m("a", "1", 5), m("b", "1", 3), m("c", "1", 2)];
    expect(splitGroupPoolBySlate(1000, members)).toEqual(legacySplit(1000, members));
  });

  it("matches the legacy split for a field of independents", () => {
    const members = [m("a", "independent", 4), m("b", "independent", 1)];
    expect(splitGroupPoolBySlate(500, members)).toEqual(legacySplit(500, members));
  });
});

describe("splitGroupPoolBySlate: candidate count no longer buys share (#1048)", () => {
  it("gives two equally-appealing parties equal share regardless of slate size", () => {
    // Party 1 fields two candidates, party 2 fields one, all equal appeal.
    const split = splitGroupPoolBySlate(1200, [
      m("a1", "1", 10),
      m("a2", "1", 10),
      m("b1", "2", 10),
    ]);
    expect(split.a1 + split.a2).toBeCloseTo(600, 6);
    expect(split.b1).toBeCloseTo(600, 6);
    // ...and the two co-partisans divide their party's half evenly.
    expect(split.a1).toBeCloseTo(300, 6);
    expect(split.a2).toBeCloseTo(300, 6);
  });

  it("reproduces the ticket-1048 CA shape: 2-vs-1 no longer yields ~2/3", () => {
    // Under the old per-candidate split this was 20/30 = 66.7% for the
    // two-candidate party on equal appeal. Now it is 50%.
    const members = [m("a1", "2", 10), m("a2", "2", 10), m("b1", "1", 10)];
    const legacy = legacySplit(3000, members);
    expect((legacy.a1 + legacy.a2) / 3000).toBeCloseTo(2 / 3, 6);

    const fixed = splitGroupPoolBySlate(3000, members);
    expect((fixed.a1 + fixed.a2) / 3000).toBeCloseTo(0.5, 6);
  });

  it("adding a co-partisan of equal appeal leaves the opponent's votes unchanged", () => {
    const solo = splitGroupPoolBySlate(1000, [m("a1", "1", 7), m("b1", "2", 3)]);
    const withRunningMate = splitGroupPoolBySlate(1000, [
      m("a1", "1", 7),
      m("a2", "1", 7),
      m("b1", "2", 3),
    ]);
    expect(withRunningMate.b1).toBeCloseTo(solo.b1, 6);
    expect(withRunningMate.a1 + withRunningMate.a2).toBeCloseTo(solo.a1, 6);
  });

  it("still rewards slate quality: a stronger slate takes a bigger share", () => {
    const weak = splitGroupPoolBySlate(1000, [m("a1", "1", 4), m("a2", "1", 4), m("b1", "2", 6)]);
    const strong = splitGroupPoolBySlate(1000, [m("a1", "1", 8), m("a2", "1", 8), m("b1", "2", 6)]);
    expect(weak.a1 + weak.a2).toBeLessThan(strong.a1 + strong.a2);
  });

  it("lets a weak co-partisan drag the slate mean", () => {
    const alone = splitGroupPoolBySlate(1000, [m("a1", "1", 10), m("b1", "2", 10)]);
    const dragged = splitGroupPoolBySlate(1000, [
      m("a1", "1", 10),
      m("a2", "1", 2),
      m("b1", "2", 10),
    ]);
    expect(dragged.a1 + dragged.a2).toBeLessThan(alone.a1);
  });
});

describe("splitGroupPoolBySlate: conservation and degenerate cases", () => {
  it("conserves the group pool exactly", () => {
    const split = splitGroupPoolBySlate(997.5, [
      m("a1", "1", 3),
      m("a2", "1", 11),
      m("b1", "2", 5),
      m("c1", "independent", 1),
    ]);
    const sum = Object.values(split).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(997.5, 6);
  });

  it("splits evenly when all weights are zero", () => {
    const split = splitGroupPoolBySlate(300, [m("a", "1", 0), m("b", "1", 0), m("c", "2", 0)]);
    expect(split).toEqual({ a: 100, b: 100, c: 100 });
  });

  it("splits a zero-weight slate's own pool evenly without dividing by zero", () => {
    const split = splitGroupPoolBySlate(1000, [m("a1", "1", 0), m("a2", "1", 0), m("b1", "2", 5)]);
    expect(split.a1).toBe(0);
    expect(split.a2).toBe(0);
    expect(split.b1).toBeCloseTo(1000, 6);
    expect(Number.isFinite(split.a1)).toBe(true);
  });

  it("returns an empty map for an empty field", () => {
    expect(splitGroupPoolBySlate(100, [])).toEqual({});
  });
});
