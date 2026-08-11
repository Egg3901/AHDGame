import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { selectMergeNppCull } from "./mergeNppCap";

let counter = 0;
function makeNpp(overrides: Partial<NPP> & { homeState: string }): NPP {
  counter += 1;
  return {
    _id: new ObjectId(),
    name: `NPP ${counter}`,
    politicalInfluence: overrides.politicalInfluence ?? 10,
    favorability: overrides.favorability ?? 50,
    policies: { economic: 0, social: 0 },
    party: "1",
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    generatedAt: new Date("2026-01-01"),
    retiredAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as NPP;
}

describe("selectMergeNppCull", () => {
  it("keeps all incoming NPPs when the surviving party is under cap", () => {
    // Org 0 → 2 slots; target has none; 2 incoming all fit.
    const a = makeNpp({ homeState: "DUB", politicalInfluence: 20 });
    const b = makeNpp({ homeState: "DUB", politicalInfluence: 15 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [a, b],
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map([["DUB", 0]]),
    });

    expect(keep).toHaveLength(2);
    expect(cull).toHaveLength(0);
  });

  it("culls overflow beyond the per-state cap, keeping the strongest by influence", () => {
    // Org 0 → 2 slots; target empty → 2 remaining; 3 incoming → 1 culled (weakest).
    const strong = makeNpp({ homeState: "DUB", politicalInfluence: 30 });
    const mid = makeNpp({ homeState: "DUB", politicalInfluence: 20 });
    const weak = makeNpp({ homeState: "DUB", politicalInfluence: 5 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [mid, weak, strong],
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map([["DUB", 0]]),
    });

    expect(keep.map((n) => n._id.toString())).toEqual([strong._id.toString(), mid._id.toString()]);
    expect(cull.map((n) => n._id.toString())).toEqual([weak._id.toString()]);
  });

  it("counts the surviving party's existing NPPs against the cap first", () => {
    // Org 0 → 2 slots; target already has 1 NPP in DUB → only 1 remaining slot.
    const strong = makeNpp({ homeState: "DUB", politicalInfluence: 30 });
    const weak = makeNpp({ homeState: "DUB", politicalInfluence: 10 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [strong, weak],
      targetActiveCountByState: new Map([["DUB", 1]]),
      targetOrgByState: new Map([["DUB", 0]]),
    });

    expect(keep.map((n) => n._id.toString())).toEqual([strong._id.toString()]);
    expect(cull.map((n) => n._id.toString())).toEqual([weak._id.toString()]);
  });

  it("culls all incoming when the surviving party is already at cap", () => {
    // Org 0 → 2 slots; target already has 2 in DUB → 0 remaining.
    const a = makeNpp({ homeState: "DUB", politicalInfluence: 99 });
    const b = makeNpp({ homeState: "DUB", politicalInfluence: 80 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [a, b],
      targetActiveCountByState: new Map([["DUB", 2]]),
      targetOrgByState: new Map([["DUB", 0]]),
    });

    expect(keep).toHaveLength(0);
    expect(cull).toHaveLength(2);
  });

  it("uses POST-merge org to size the cap (org >= 75 → 5 slots)", () => {
    const npps = Array.from({ length: 6 }, (_, i) =>
      makeNpp({ homeState: "DUB", politicalInfluence: 100 - i })
    );

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: npps,
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map([["DUB", 80]]),
    });

    expect(keep).toHaveLength(5);
    expect(cull).toHaveLength(1);
    expect(cull[0]!._id.toString()).toBe(npps[5]!._id.toString());
  });

  it("caps each home state independently", () => {
    // DUB org 0 → 2 slots (3 incoming → 1 cull); COR org 50 → 4 slots (1 incoming → keep).
    const dub = Array.from({ length: 3 }, (_, i) =>
      makeNpp({ homeState: "DUB", politicalInfluence: 30 - i })
    );
    const cor = makeNpp({ homeState: "COR", politicalInfluence: 10 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [...dub, cor],
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map([
        ["DUB", 0],
        ["COR", 50],
      ]),
    });

    expect(keep.map((n) => n._id.toString()).sort()).toEqual(
      [dub[0]!._id.toString(), dub[1]!._id.toString(), cor._id.toString()].sort()
    );
    expect(cull.map((n) => n._id.toString())).toEqual([dub[2]!._id.toString()]);
  });

  it("breaks an influence tie by favorability, then by a stable id ordering", () => {
    // Org 0 → 2 slots, 3 incoming all equal influence. Favorability decides the
    // two keeps; the lowest-favorability one is culled.
    const high = makeNpp({ homeState: "DUB", politicalInfluence: 10, favorability: 70 });
    const midFav = makeNpp({ homeState: "DUB", politicalInfluence: 10, favorability: 60 });
    const low = makeNpp({ homeState: "DUB", politicalInfluence: 10, favorability: 40 });

    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [low, high, midFav],
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map([["DUB", 0]]),
    });

    expect(keep.map((n) => n._id.toString())).toEqual([high._id.toString(), midFav._id.toString()]);
    expect(cull.map((n) => n._id.toString())).toEqual([low._id.toString()]);
  });

  it("returns no culls for an empty incoming set", () => {
    const { keep, cull } = selectMergeNppCull({
      proposingNpps: [],
      targetActiveCountByState: new Map(),
      targetOrgByState: new Map(),
    });

    expect(keep).toHaveLength(0);
    expect(cull).toHaveLength(0);
  });
});
