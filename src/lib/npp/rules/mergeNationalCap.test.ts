import { describe, expect, it } from "vitest";
import { selectNationalMergeNppCull, type MergeNppRank } from "./mergeNationalCap";

const npp = (id: string, politicalInfluence = 10, favorability = 50): MergeNppRank => ({
  id,
  politicalInfluence,
  favorability,
});

describe("national merger NPP cap", () => {
  it("retains weaker surviving-party NPPs ahead of stronger incoming ones", () => {
    expect(
      selectNationalMergeNppCull({
        survivingNpps: [npp("own", 1)],
        incomingNpps: [npp("incoming", 100)],
        maxNpps: 1,
      })
    ).toEqual(["incoming"]);
  });
  it("retains an over-cap surviving roster and deletes all incoming NPPs", () => {
    expect(
      selectNationalMergeNppCull({
        survivingNpps: [npp("weak", 1), npp("strong", 90)],
        incomingNpps: [npp("incoming", 100)],
        maxNpps: 1,
      })
    ).toEqual(["incoming"]);
  });
  it("fills remaining national slots with strongest incoming NPPs across regions", () => {
    expect(
      selectNationalMergeNppCull({
        survivingNpps: [npp("own")],
        incomingNpps: [npp("low", 2), npp("high", 50), npp("mid", 20)],
        maxNpps: 3,
      })
    ).toEqual(["low"]);
  });
  it("uses favorability and stable id ordering, independent of input order", () => {
    const incoming = [npp("b", 10, 80), npp("a", 10, 80), npp("c", 10, 20)];
    for (const rows of [incoming, [...incoming].reverse()]) {
      expect(
        selectNationalMergeNppCull({ survivingNpps: [], incomingNpps: rows, maxNpps: 1 })
      ).toEqual(["b", "c"]);
    }
  });
  it("removes only incoming NPPs when there are no qualifying players", () => {
    expect(
      selectNationalMergeNppCull({
        survivingNpps: [npp("own")],
        incomingNpps: [npp("new")],
        maxNpps: 0,
      })
    ).toEqual(["new"]);
  });
  it("keeps an exact-cap roster and handles empty input", () => {
    expect(
      selectNationalMergeNppCull({
        survivingNpps: [npp("own")],
        incomingNpps: [npp("new")],
        maxNpps: 2,
      })
    ).toEqual([]);
    expect(selectNationalMergeNppCull({ survivingNpps: [], incomingNpps: [], maxNpps: 0 })).toEqual(
      []
    );
  });
  it("grandfathers a roster above 25 and does not mutate its inputs", () => {
    const own = Object.freeze(Array.from({ length: 26 }, (_, i) => npp(String(i), 100 - i)));
    expect(
      selectNationalMergeNppCull({ survivingNpps: own, incomingNpps: [npp("new")], maxNpps: 25 })
    ).toEqual(["new"]);
    expect(own[0].id).toBe("0");
  });
  it("allows no more than 25 incoming NPPs even when every region has room", () => {
    const incoming = Array.from({ length: 26 }, (_, i) => npp(String(i), 100 - i));
    expect(
      selectNationalMergeNppCull({ survivingNpps: [], incomingNpps: incoming, maxNpps: 25 })
    ).toEqual(["25"]);
  });
  it("preserves roster and capacity invariants across all supported national limits", () => {
    const incoming = Object.freeze(
      Array.from({ length: 30 }, (_, i) => npp(`incoming-${i}`, 100 - i))
    );
    for (let maxNpps = 0; maxNpps <= 25; maxNpps += 5) {
      for (let existing = 0; existing <= 30; existing += 1) {
        const survivingNpps = Array.from({ length: existing }, (_, i) => ({ id: `own-${i}` }));
        const args = { survivingNpps, incomingNpps: incoming, maxNpps };
        const removed = selectNationalMergeNppCull(args);
        const expectedSlots = Math.max(0, maxNpps - existing);
        expect(removed).toEqual(incoming.slice(expectedSlots).map((row) => row.id));
        expect(removed.every((id) => id.startsWith("incoming-"))).toBe(true);
        expect(
          selectNationalMergeNppCull({ ...args, incomingNpps: [...incoming].reverse() })
        ).toEqual(removed);
      }
    }
  });
  it.each([NaN, Infinity, -1, 1.5])(
    "rejects invalid capacity %s instead of deleting accidentally",
    (maxNpps) => {
      expect(() =>
        selectNationalMergeNppCull({ survivingNpps: [npp("own")], incomingNpps: [], maxNpps })
      ).toThrow("Invalid");
    }
  );
});
