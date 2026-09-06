import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyStateArmsProduction } from "./stateArmsTurn";

interface World {
  units: Record<string, unknown>[];
  stock: Record<string, number>;
  deposits: { domain: string; lots: number }[];
}

function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "militaryUnits") {
        return { find: () => ({ toArray: async () => w.units }) };
      }
      // nationalArsenal
      return {
        findOne: async () => ({
          countryId: "RU",
          stock: { ...w.stock },
          grade: { ground: 0, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 },
        }),
        updateOne: async (_f: unknown, u: Record<string, unknown>) => {
          const inc = (u.$inc ?? {}) as Record<string, number>;
          for (const [key, amount] of Object.entries(inc)) {
            const domain = key.split(".")[1];
            w.stock[domain] = (w.stock[domain] ?? 0) + amount;
            w.deposits.push({ domain, lots: amount });
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const unit = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  countryId: "RU",
  domain: "ground",
  type: "Infantry Division",
  equipment: { firepower: 0, protection: 0, support: 0 },
  ...over,
});

describe("state arms production", () => {
  it("produces nothing for a market economy whose store still holds something", async () => {
    const w: World = { units: [unit({ countryId: "US" })], stock: { ground: 5 }, deposits: [] };
    const res = await applyStateArmsProduction(stubDb(w), "US");
    expect(res.lots).toBe(0);
    expect(w.deposits).toEqual([]);
  });

  it("gives a market economy one emergency lot when its store has reached zero", async () => {
    // The floor, not a rate. A planned economy's equipment can never reach zero because
    // its factories run every turn; a market economy's only route in is a defence
    // contract, and the United States finished the War for Germany on 0/0/0. One lot
    // into an empty store is the way back, and it stops as soon as the store is not
    // empty, and the test above is that same country on the following turn.
    const w: World = { units: [unit({ countryId: "US" })], stock: {}, deposits: [] };
    const res = await applyStateArmsProduction(stubDb(w), "US");
    expect(res.lots).toBe(1);
    expect(w.deposits).toHaveLength(1);
    expect(w.deposits[0].domain).toBe("ground");
  });

  it("keeps the floor well below planned production", async () => {
    // Planned economies must keep their whole advantage: the floor is a third of the
    // Soviet rate, so this is not a back door to a defence industry.
    const market: World = { units: [unit({ countryId: "US" })], stock: {}, deposits: [] };
    const planned: World = { units: [unit({ countryId: "RU" })], stock: {}, deposits: [] };
    const m = await applyStateArmsProduction(stubDb(market), "US");
    const p = await applyStateArmsProduction(stubDb(planned), "RU");
    expect(m.lots).toBeLessThan(p.lots);
  });

  it("credits the store of a planned economy every turn", async () => {
    const w: World = { units: [unit(), unit(), unit()], stock: {}, deposits: [] };
    const res = await applyStateArmsProduction(stubDb(w), "RU");
    expect(res.lots).toBeGreaterThan(0);
    expect(w.deposits).toHaveLength(1);
    expect(w.deposits[0].domain).toBe("ground");
  });

  it("feeds the hungrier of two domains first", async () => {
    // One stripped ground formation against an air wing that is already fully equipped.
    const w: World = {
      units: [
        unit(),
        unit({
          domain: "air",
          type: "Fighter Wing",
          equipment: { firepower: 3, protection: 3, support: 3 },
        }),
      ],
      stock: {},
      deposits: [],
    };
    await applyStateArmsProduction(stubDb(w), "RU");
    expect(w.deposits[0].domain).toBe("ground");
  });

  it("stops once the reserve reaches a full re-equip of the roster", async () => {
    // A single infantry division: bank one spare set and then produce nothing further.
    const w: World = { units: [unit()], stock: {}, deposits: [] };
    const db = stubDb(w);
    for (let turn = 0; turn < 200; turn++) await applyStateArmsProduction(db, "RU");
    const banked = w.stock.ground ?? 0;
    expect(banked).toBeGreaterThan(0);

    const before = banked;
    await applyStateArmsProduction(db, "RU");
    expect(w.stock.ground).toBe(before);
  });

  it("writes nothing for a country with no formations", async () => {
    const w: World = { units: [], stock: {}, deposits: [] };
    const res = await applyStateArmsProduction(stubDb(w), "RU");
    expect(res.lots).toBe(0);
    expect(w.deposits).toEqual([]);
  });
});
