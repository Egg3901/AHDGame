import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildSeasonRecaps } from "./buildSeasonRecaps";
import type { Character } from "@/lib/db/types/character";

function ch(o: Partial<Character>): Character {
  return {
    _id: new ObjectId(),
    name: "P",
    countryId: "US",
    politicalInfluence: 10,
    nationalInfluence: 10,
    favorability: 50,
    infamy: 0,
    party: "independent",
    currentOffice: null,
    careerHistory: [],
    createdTurn: 1,
    ...o,
  } as unknown as Character;
}

/** Override one collection's aggregate cursor for this test. */
function aggReturns(db: MockDb, name: string, rows: unknown[]): void {
  db.collection(name).aggregate.mockReturnValue({
    toArray: () => Promise.resolve(rows),
  });
}

describe("buildSeasonRecaps", () => {
  it("ranks per country and folds the action aggregate", async () => {
    const db = createMockDb();
    const A = new ObjectId();
    const B = new ObjectId();
    const C = new ObjectId();
    const chars = [
      ch({ _id: A, nationalInfluence: 90, favorability: 80 }),
      ch({ _id: B, nationalInfluence: 50, favorability: 60 }),
      ch({ _id: C, nationalInfluence: 10, favorability: 40 }),
    ];
    // Action totals: A = 100 (fundraise-heavy), B = 40, C = 0.
    aggReturns(db, "actionLogs", [
      { _id: { c: A, t: "fundraise" }, n: 70 },
      { _id: { c: A, t: "campaign" }, n: 30 },
      { _id: { c: B, t: "campaign" }, n: 40 },
    ]);

    const map = await buildSeasonRecaps(db as unknown as Db, chars, {
      currentTurn: 100,
      iteration: { type: "Beta", number: 2 },
    });

    const a = map.get(A.toString())!;
    expect(a.actions.total).toBe(100);
    expect(a.actions.topType).toBe("fundraise");
    expect(a.actions.rank).toEqual({ value: 100, rank: 1, total: 3 });
    expect(a.influence.npi).toEqual({ value: 90, rank: 1, total: 3 });
    expect(a.party).toBe("Independent");

    const c = map.get(C.toString())!;
    expect(c.actions.total).toBe(0);
    expect(c.actions.rank).toBeNull(); // zero activity ⇒ unranked
    expect(c.influence.npi?.rank).toBe(3);
  });

  it("returns an empty map when there are no characters", async () => {
    const db = createMockDb();
    const map = await buildSeasonRecaps(db as unknown as Db, [], { currentTurn: 1 });
    expect(map.size).toBe(0);
  });

  it("ranks wealth globally and forex-normalized (not per country)", async () => {
    const db = createMockDb();
    const usA = new ObjectId();
    const usB = new ObjectId();
    const uk = new ObjectId();
    // Local net worth: usA $1000, usB $500, uk £400. Rates = local per internal
    // unit: US 1, UK 0.5 ⇒ internal usA 1000, usB 500, uk 800. Global order:
    // usA(1000) > uk(800) > usB(500) — which per-country ranking could not produce.
    const chars = [
      ch({ _id: usA, countryId: "US", funds: 1000 }),
      ch({ _id: usB, countryId: "US", funds: 500 }),
      ch({ _id: uk, countryId: "UK", funds: 400 }),
    ];
    db.collection("exchangeRates").find.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { countryId: "US", rate: 1 },
          { countryId: "UK", rate: 0.5 },
        ]),
    });

    const map = await buildSeasonRecaps(db as unknown as Db, chars, { currentTurn: 100 });
    expect(map.get(usA.toString())!.netWorth).toEqual({ value: 1000, rank: 1, total: 3 });
    expect(map.get(uk.toString())!.netWorth).toEqual({ value: 400, rank: 2, total: 3 });
    expect(map.get(usB.toString())!.netWorth).toEqual({ value: 500, rank: 3, total: 3 });
  });
});
