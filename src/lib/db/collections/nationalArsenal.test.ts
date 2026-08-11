import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { getNationalArsenal, depositLots, drawLots, returnLots } from "./nationalArsenal";

interface Capture {
  updates: { filter: Record<string, unknown>; update: Record<string, unknown> }[];
}

/**
 * Emulates the guarded `$inc`: an update only matches when the stored value satisfies the
 * filter's `$gte`, which is the whole point of the movers below. `doc` is mutated so a
 * sequence of calls behaves like a real store rather than a stateless mock.
 */
function stubDb(doc: Record<string, unknown> | null, capture: Capture): Db {
  return {
    collection: () => ({
      findOne: async () => doc,
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        capture.updates.push({ filter, update });
        const guardKey = Object.keys(filter).find((k) => k.startsWith("stock."));
        const need = guardKey
          ? (filter[guardKey] as { $gte?: number } | undefined)?.$gte
          : undefined;
        if (need != null) {
          const stock = (doc?.stock ?? {}) as Record<string, number>;
          const path = guardKey!.split(".")[1];
          if ((stock[path] ?? 0) < need) return { matchedCount: 0, modifiedCount: 0 };
          const inc = (update.$inc ?? {}) as Record<string, number>;
          for (const [k, v] of Object.entries(inc)) {
            const field = k.split(".")[1];
            stock[field] = (stock[field] ?? 0) + v;
          }
        }
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
  } as unknown as Db;
}

const arsenal = (ground: number, grade = 0) => ({
  countryId: "US",
  stock: { ground, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
  grade: { ground: grade, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
});

describe("getNationalArsenal", () => {
  // Unlike the appropriation, an absent document is not a data gap to heal — empty is the
  // correct starting state for every nation, so a read must not write.
  it("returns an empty arsenal without creating a document", async () => {
    const capture: Capture = { updates: [] };
    const a = await getNationalArsenal(stubDb(null, capture), "US");
    expect(a.stock).toEqual({ ground: 0, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 });
    expect(capture.updates).toHaveLength(0);
  });

  it("back-fills a domain missing from a stored document", async () => {
    const partial = { countryId: "US", stock: { ground: 5 }, grade: { ground: 2 } };
    const a = await getNationalArsenal(stubDb(partial, { updates: [] }), "US");
    expect(a.stock.ground).toBe(5);
    expect(a.stock.naval).toBe(0);
    expect(a.grade.naval).toBe(0);
  });
});

describe("drawLots", () => {
  it("takes the full amount when the store covers it", async () => {
    const capture: Capture = { updates: [] };
    expect(await drawLots(stubDb(arsenal(100), capture), "US", "ground", 40)).toBe(40);
    expect(capture.updates[0].update).toMatchObject({ $inc: { "stock.ground": -40 } });
  });

  // A partial draw is normal, not an error: the arsenal issues what it has and the caller
  // equips the unit at the resulting fill.
  it("takes what it has and reports it when the store is short", async () => {
    const capture: Capture = { updates: [] };
    expect(await drawLots(stubDb(arsenal(15), capture), "US", "ground", 40)).toBe(15);
  });

  it("takes nothing from an empty store", async () => {
    expect(await drawLots(stubDb(arsenal(0), { updates: [] }), "US", "ground", 40)).toBe(0);
  });

  it("guards every draw so a concurrent order cannot drive stock negative", async () => {
    const capture: Capture = { updates: [] };
    await drawLots(stubDb(arsenal(100), capture), "US", "ground", 40);
    for (const u of capture.updates) {
      expect(Object.keys(u.filter).some((k) => k.startsWith("stock."))).toBe(true);
    }
  });

  it("is a no-op for a zero or negative request", async () => {
    const capture: Capture = { updates: [] };
    expect(await drawLots(stubDb(arsenal(100), capture), "US", "ground", 0)).toBe(0);
    expect(await drawLots(stubDb(arsenal(100), capture), "US", "ground", -5)).toBe(0);
    expect(capture.updates).toHaveLength(0);
  });

  it("never returns more than was asked for", async () => {
    expect(await drawLots(stubDb(arsenal(1000), { updates: [] }), "US", "ground", 10)).toBe(10);
  });
});

describe("depositLots", () => {
  it("adds stock and re-blends the grade", async () => {
    const capture: Capture = { updates: [] };
    await depositLots(stubDb(arsenal(100, 1), capture), "US", "ground", 100, 3);
    const u = capture.updates.at(-1)!;
    expect(u.update.$inc).toMatchObject({ "stock.ground": 100 });
    // 100 lots at grade 1 blended with 100 at grade 3 -> 2.
    expect((u.update.$set as Record<string, number>)["grade.ground"]).toBeCloseTo(2, 9);
  });

  it("takes the incoming grade when the store was empty", async () => {
    const capture: Capture = { updates: [] };
    await depositLots(stubDb(arsenal(0, 0), capture), "US", "ground", 50, 3);
    expect((capture.updates.at(-1)!.update.$set as Record<string, number>)["grade.ground"]).toBe(3);
  });

  it("is a no-op for a zero delivery", async () => {
    const capture: Capture = { updates: [] };
    await depositLots(stubDb(arsenal(100, 1), capture), "US", "ground", 0, 3);
    expect(capture.updates).toHaveLength(0);
  });

  it("upserts so the first delivery creates the arsenal", async () => {
    const capture: Capture = { updates: [] };
    await depositLots(stubDb(null, capture), "US", "ground", 10, 2);
    expect(capture.updates.at(-1)!.update).toHaveProperty("$setOnInsert");
  });
});

describe("returnLots", () => {
  // The rollback path. Unguarded on purpose: refusing a return would destroy materiel the
  // player was charged for.
  it("returns stock unconditionally", async () => {
    const capture: Capture = { updates: [] };
    await returnLots(stubDb(arsenal(0), capture), "US", "ground", 25);
    expect(capture.updates[0].update).toMatchObject({ $inc: { "stock.ground": 25 } });
    expect(Object.keys(capture.updates[0].filter).some((k) => k.startsWith("stock."))).toBe(false);
  });

  it("is a no-op for a non-positive amount", async () => {
    const capture: Capture = { updates: [] };
    await returnLots(stubDb(arsenal(0), capture), "US", "ground", 0);
    expect(capture.updates).toHaveLength(0);
  });
});
