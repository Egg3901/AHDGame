import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyNavalRepair } from "./navalRepairTurn";
import { FREE_REPAIR_CEILING } from "@/lib/navair/repair";

/**
 * Paid repair, drawn from the national arsenal.
 *
 * The tier that exists because free repair is capped by where a formation is. A fleet
 * holding station can patch itself up but cannot refit itself, so the last stretch of
 * condition is bought with materiel or not at all. `stubDb` mirrors the one in
 * `defenceRefitTurn.test.ts`, so both sweeps are tested against the same fake arsenal.
 */

interface World {
  units: Record<string, unknown>[];
  stock: Record<string, number>;
  writes: { filter: { _id: unknown }; update: { $set: { integrity: number } } }[];
  failWrite?: boolean;
}

function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "militaryUnits") {
        return {
          find: () => ({ toArray: async () => w.units }),
          bulkWrite: async (ops: { updateOne: World["writes"][number] }[]) => {
            if (w.failWrite) throw new Error("write failed");
            for (const op of ops) w.writes.push(op.updateOne);
            return { modifiedCount: ops.length };
          },
        };
      }
      return {
        findOne: async () => ({
          countryId: "UK",
          stock: { ...w.stock },
          grade: { ground: 2, naval: 2, air: 2, rocket: 0, space: 0, marine: 0 },
        }),
        // `drawLots` guards on `stock.<domain>: { $gte }` so it cannot overdraw;
        // `returnLots` filters on countryId alone. Both have to move the store, so the
        // guard is honoured when present and the $inc is applied either way. An earlier
        // version of this stub only applied $inc alongside a guard, which silently
        // swallowed every rollback and made the recovery path look broken.
        updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
          const guardKey = Object.keys(f).find((k) => k.startsWith("stock."));
          if (guardKey) {
            const need = (f[guardKey] as { $gte?: number }).$gte ?? 0;
            const domain = guardKey.split(".")[1];
            if ((w.stock[domain] ?? 0) < need) return { matchedCount: 0, modifiedCount: 0 };
          }
          for (const [key, inc] of Object.entries((u.$inc ?? {}) as Record<string, number>)) {
            if (!key.startsWith("stock.")) continue;
            const domain = key.split(".")[1];
            w.stock[domain] = (w.stock[domain] ?? 0) + inc;
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const hull = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  countryId: "UK",
  domain: "naval",
  type: "Guided-Missile Destroyer",
  equipment: { firepower: 1, protection: 1, support: 1 },
  integrity: 50,
  ...over,
});

describe("applyNavalRepair", () => {
  it("mends a damaged hull and takes the lots from the naval store", async () => {
    const w: World = { units: [hull({ integrity: 20 })], stock: { naval: 50 }, writes: [] };

    const res = await applyNavalRepair(stubDb(w), "UK");

    expect(res.unitsRepaired).toBe(1);
    expect(res.lotsUsed).toBeGreaterThan(0);
    expect(w.stock.naval).toBeLessThan(50);
    expect(w.writes[0].update.$set.integrity).toBeGreaterThan(20);
  });

  // A wreck contributes literally nothing until it is seaworthy, so the marginal value of
  // a lot is highest at the bottom. This is refitOrder's reasoning, inverted.
  it("repairs the worst damaged hull first when the store is short", async () => {
    const bad = hull({ integrity: 5 });
    const mild = hull({ integrity: 80 });
    const w: World = { units: [mild, bad], stock: { naval: 2 }, writes: [] };

    await applyNavalRepair(stubDb(w), "UK");

    expect(w.writes[0].filter._id).toBe(bad._id);
  });

  it("does nothing at all when the store is empty", async () => {
    const w: World = { units: [hull({ integrity: 10 })], stock: { naval: 0 }, writes: [] };

    const res = await applyNavalRepair(stubDb(w), "UK");

    expect(res).toEqual({ unitsRepaired: 0, lotsUsed: 0 });
    expect(w.writes).toHaveLength(0);
  });

  // Only naval and air carry integrity. A ground formation has none and must not be
  // charged lots for repairing a field it does not have.
  it("never touches a ground formation", async () => {
    const w: World = {
      units: [hull({ domain: "ground", type: "Infantry Division", integrity: undefined })],
      stock: { naval: 50, ground: 50 },
      writes: [],
    };

    const res = await applyNavalRepair(stubDb(w), "UK");

    expect(res.unitsRepaired).toBe(0);
  });

  it("leaves an undamaged hull alone", async () => {
    const w: World = { units: [hull({ integrity: 100 })], stock: { naval: 50 }, writes: [] };

    expect(await applyNavalRepair(stubDb(w), "UK")).toEqual({ unitsRepaired: 0, lotsUsed: 0 });
  });

  // A partial draw buys partial condition. Awarding a full restore for a partial draw is
  // the same bug `applyEquipmentLots` exists to avoid on the equipment side.
  it("restores only what the lots actually drawn paid for", async () => {
    const w: World = { units: [hull({ integrity: 0 })], stock: { naval: 1 }, writes: [] };

    await applyNavalRepair(stubDb(w), "UK");

    expect(w.writes[0].update.$set.integrity).toBeGreaterThan(0);
    expect(w.writes[0].update.$set.integrity).toBeLessThan(100);
  });

  // A lot buys one point of condition at 99% and a hundred at zero, and this sweep runs
  // before refit. Left unconditional it would drain the store on scratches and starve the
  // refit pipeline, so materiel is only spent where free repair cannot reach.
  it("spends nothing on a formation above the ceiling free repair reaches", async () => {
    const w: World = {
      units: [hull({ integrity: FREE_REPAIR_CEILING.station + 5 })],
      stock: { naval: 50 },
      writes: [],
    };

    expect(await applyNavalRepair(stubDb(w), "UK")).toEqual({ unitsRepaired: 0, lotsUsed: 0 });
    expect(w.stock.naval).toBe(50);
  });

  // The case the paid tier exists for, and the one a `>=` gate silently excluded. Free
  // repair parks every forward-deployed hull on exactly the ceiling and then stops, so a
  // fleet that mended itself as far as it could while the arsenal was empty has to be
  // able to spend the materiel when it finally arrives.
  it("buys the last stretch for a hull parked exactly on the ceiling", async () => {
    const w: World = {
      units: [hull({ integrity: FREE_REPAIR_CEILING.station })],
      stock: { naval: 500 },
      writes: [],
    };

    const res = await applyNavalRepair(stubDb(w), "UK");

    expect(res.unitsRepaired).toBe(1);
    expect(w.writes[0].update.$set.integrity).toBe(100);
  });

  // Below the ceiling there is no cap. A forward hull bought out of the hole comes all the
  // way back, which is the whole reason the paid tier exists.
  it("carries a hull below the ceiling all the way to full when lots allow", async () => {
    const w: World = { units: [hull({ integrity: 10 })], stock: { naval: 500 }, writes: [] };

    await applyNavalRepair(stubDb(w), "UK");

    expect(w.writes[0].update.$set.integrity).toBe(100);
  });

  // Lots are drawn per unit but written in one batch, so a failed write would otherwise
  // destroy every lot taken this turn with nothing issued for them.
  it("returns every lot it drew when the write fails", async () => {
    const w: World = {
      units: [hull({ integrity: 20 })],
      stock: { naval: 50 },
      writes: [],
      failWrite: true,
    };

    await expect(applyNavalRepair(stubDb(w), "UK")).rejects.toThrow("write failed");
    expect(w.stock.naval).toBe(50);
  });
});
