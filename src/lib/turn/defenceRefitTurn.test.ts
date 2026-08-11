import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyDefenceRefit } from "./defenceRefitTurn";
import { EQUIPMENT_TRACK_MAX } from "@/lib/military/arsenal";

interface World {
  units: Record<string, unknown>[];
  stock: Record<string, number>;
  writes: { filter: { _id: unknown }; update: { $set: { equipment: Record<string, number> } } }[];
}

function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "militaryUnits") {
        return {
          find: () => ({ toArray: async () => w.units }),
          bulkWrite: async (ops: World["writes"][number][] | { updateOne: unknown }[]) => {
            for (const op of ops as { updateOne: World["writes"][number] }[]) {
              w.writes.push(op.updateOne);
            }
            return { modifiedCount: ops.length };
          },
        };
      }
      // nationalArsenal
      return {
        findOne: async () => ({
          countryId: "US",
          stock: { ...w.stock },
          grade: { ground: 2, naval: 2, air: 2, rocket: 0, space: 0, marine: 0 },
        }),
        updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
          const guardKey = Object.keys(f).find((k) => k.startsWith("stock."));
          if (guardKey) {
            const need = (f[guardKey] as { $gte?: number }).$gte ?? 0;
            const domain = guardKey.split(".")[1];
            if ((w.stock[domain] ?? 0) < need) return { matchedCount: 0, modifiedCount: 0 };
            const inc = ((u.$inc ?? {}) as Record<string, number>)[guardKey] ?? 0;
            w.stock[domain] = (w.stock[domain] ?? 0) + inc;
          }
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const unit = (over: Record<string, unknown> = {}) => ({
  _id: new ObjectId(),
  countryId: "US",
  domain: "ground",
  type: "Infantry Division",
  equipment: { firepower: 0, protection: 0, support: 0 },
  ...over,
});

const emptyStock = { ground: 0, naval: 0, air: 0, rocket: 0, space: 0, marine: 0 };

describe("applyDefenceRefit", () => {
  it("does nothing for a country with no units", async () => {
    const w: World = { units: [], stock: { ...emptyStock, ground: 999 }, writes: [] };
    expect(await applyDefenceRefit(stubDb(w), "US")).toEqual({ unitsRefitted: 0, lotsUsed: 0 });
  });

  it("does nothing when every store is empty", async () => {
    const w: World = { units: [unit()], stock: { ...emptyStock }, writes: [] };
    expect(await applyDefenceRefit(stubDb(w), "US")).toEqual({ unitsRefitted: 0, lotsUsed: 0 });
    expect(w.writes).toHaveLength(0);
  });

  // The headline: nothing in the game raised `equipment` before this step existed.
  it("raises a hollow unit's equipment from the arsenal", async () => {
    const w: World = { units: [unit()], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    const r = await applyDefenceRefit(stubDb(w), "US");
    expect(r.unitsRefitted).toBe(1);
    expect(w.writes[0].update.$set.equipment.firepower).toBeGreaterThan(0);
  });

  it("does not exceed the per-track maximum", async () => {
    const w: World = { units: [unit()], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    await applyDefenceRefit(stubDb(w), "US");
    for (const v of Object.values(w.writes[0].update.$set.equipment)) {
      expect(v).toBeLessThanOrEqual(EQUIPMENT_TRACK_MAX);
    }
  });

  it("leaves an already fully-equipped unit alone", async () => {
    const full = unit({
      equipment: {
        firepower: EQUIPMENT_TRACK_MAX,
        protection: EQUIPMENT_TRACK_MAX,
        support: EQUIPMENT_TRACK_MAX,
      },
    });
    const w: World = { units: [full], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    expect((await applyDefenceRefit(stubDb(w), "US")).unitsRefitted).toBe(0);
  });

  it("consumes stock as it refits", async () => {
    const w: World = { units: [unit()], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    await applyDefenceRefit(stubDb(w), "US");
    expect(w.stock.ground).toBeLessThan(9_999);
  });

  // A per-domain arsenal means a full armoury does not help a starved navy.
  it("does not spend one domain's stock on another's units", async () => {
    const w: World = {
      units: [unit({ domain: "naval", type: "Guided-Missile Destroyer" })],
      stock: { ...emptyStock, ground: 9_999 },
      writes: [],
    };
    expect((await applyDefenceRefit(stubDb(w), "US")).unitsRefitted).toBe(0);
    expect(w.stock.ground).toBe(9_999);
  });

  // Nearest-to-complete first, so scarce lots produce usable formations rather than raising
  // everything a little and leaving nothing effective.
  it("refits the nearest-to-complete unit first", async () => {
    const near = unit({ equipment: { firepower: 2, protection: 2, support: 2 } });
    const far = unit({ equipment: { firepower: 0, protection: 0, support: 0 } });
    const w: World = { units: [far, near], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    await applyDefenceRefit(stubDb(w), "US");
    expect(String(w.writes[0].filter._id)).toBe(String(near._id));
  });

  it("skips a unit whose archetype is unknown rather than guessing its needs", async () => {
    const w: World = {
      units: [unit({ type: "Nonexistent Formation" })],
      stock: { ...emptyStock, ground: 9_999 },
      writes: [],
    };
    expect((await applyDefenceRefit(stubDb(w), "US")).unitsRefitted).toBe(0);
  });

  it("tolerates a legacy unit with no equipment field", async () => {
    const legacy = unit({ equipment: undefined });
    const w: World = { units: [legacy], stock: { ...emptyStock, ground: 9_999 }, writes: [] };
    await expect(applyDefenceRefit(stubDb(w), "US")).resolves.toBeDefined();
  });

  // Tier is the grade of the materiel a unit was ISSUED with; topping up racks does not turn
  // a legacy formation into a modern one.
  it("never changes techTier", async () => {
    const w: World = {
      units: [unit({ techTier: 1 })],
      stock: { ...emptyStock, ground: 9_999 },
      writes: [],
    };
    await applyDefenceRefit(stubDb(w), "US");
    expect(w.writes[0].update.$set).not.toHaveProperty("techTier");
  });
});
