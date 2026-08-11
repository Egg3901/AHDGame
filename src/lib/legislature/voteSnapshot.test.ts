import { describe, expect, it } from "vitest";
import { toVoteSnapshot, snapshotWeightMap } from "@/lib/legislature/voteSnapshot";

describe("toVoteSnapshot", () => {
  it("serializes scoped votes, weights, and totals for the given turn", () => {
    const snap = toVoteSnapshot(
      {
        votes: { a: "for", npp_b: "against" },
        weightMap: new Map([
          ["a", 1],
          ["npp_b", 10],
        ]),
        totals: { for: 1, against: 10, abstain: 0 },
      },
      42
    );
    expect(snap.votes).toEqual({ a: "for", npp_b: "against" });
    expect(snap.weights).toEqual({ a: 1, npp_b: 10 });
    expect(snap.totals).toEqual({ for: 1, against: 10, abstain: 0 });
    expect(snap.resolvedAtTurn).toBe(42);
  });

  it("defaults missing weights to 1 and tolerates an undefined vote map", () => {
    const snap = toVoteSnapshot(
      { votes: { a: "for" }, weightMap: new Map(), totals: { for: 1, against: 0, abstain: 0 } },
      7
    );
    expect(snap.weights).toEqual({ a: 1 });

    const empty = toVoteSnapshot(
      { votes: undefined, weightMap: new Map(), totals: { for: 0, against: 0, abstain: 0 } },
      7
    );
    expect(empty.votes).toEqual({});
  });

  it("round-trips weights back into a Map", () => {
    const snap = toVoteSnapshot(
      {
        votes: { a: "for" },
        weightMap: new Map([["a", 3]]),
        totals: { for: 3, against: 0, abstain: 0 },
      },
      1
    );
    expect(snapshotWeightMap(snap).get("a")).toBe(3);
  });
});
