import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getIncumbentSeatShareByParty, preloadIncumbentSeatShares } from "./incumbentSeatShare";

describe("preloadIncumbentSeatShares (#2695)", () => {
  it("matches the per-election read for every election, including those without a prior", async () => {
    const db = createInMemoryDb();
    const prior = (state: string, electionType: string, cycle: number, countryId = "UK") => ({
      _id: new ObjectId(),
      state,
      electionType,
      cycle,
      countryId,
      status: "resolved",
    });
    const p1 = prior("LON", "commons", 2);
    const p2 = prior("LON", "commons", 1);
    const p3 = prior("SCO", "commons", 2);
    db.seed("elections", [p1, p2, p3]);
    db.seed("electionVoteTallies", [
      {
        electionId: p1._id,
        finalized: true,
        totalVotes: { a: 600, b: 400 },
        candidateParties: { a: "1", b: "2" },
      },
      {
        electionId: p2._id,
        finalized: true,
        totalVotes: { a: 100, b: 900 },
        candidateParties: { a: "1", b: "2" },
      },
      { electionId: p3._id, finalized: false, totalVotes: { c: 10 }, candidateParties: { c: "3" } },
    ]);
    const active = [
      {
        _id: new ObjectId(),
        state: "LON",
        electionType: "commons",
        cycle: 3,
        countryId: "UK",
        status: "active",
      },
      {
        _id: new ObjectId(),
        state: "SCO",
        electionType: "commons",
        cycle: 3,
        countryId: "UK",
        status: "active",
      },
      {
        _id: new ObjectId(),
        state: "WAL",
        electionType: "commons",
        cycle: 3,
        countryId: "UK",
        status: "active",
      },
      {
        _id: new ObjectId(),
        state: "LON",
        electionType: "commons",
        cycle: 2,
        countryId: "UK",
        status: "active",
      },
    ];
    const pre = await preloadIncumbentSeatShares(active as never, db as unknown as Db);
    expect(pre.size).toBe(active.length);
    // LON cycle 3 inherits the finalized cycle-2 result; SCO's prior is not finalized.
    expect(pre.get(active[0]._id.toString())?.size).toBeGreaterThan(0);
    expect(pre.get(active[1]._id.toString())?.size).toBe(0);
    for (const election of active) {
      const live = await getIncumbentSeatShareByParty(election as never, db as unknown as Db);
      expect([...(pre.get(election._id.toString()) ?? new Map()).entries()].sort()).toEqual(
        [...live.entries()].sort()
      );
    }
  });
});
