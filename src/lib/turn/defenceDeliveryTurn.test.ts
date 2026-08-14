import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { canSupply, applyDefenceDeliveries } from "./defenceDeliveryTurn";
import { lotsFromSector, rawLotsFromSector } from "@/lib/military/arsenal";

describe("lotsFromSector", () => {
  it("produces nothing from a plant with no revenue", () => {
    expect(lotsFromSector({ strategyId: "munitions", revenue: 0 })).toBe(0);
    expect(lotsFromSector({ strategyId: "munitions", revenue: -5 })).toBe(0);
  });

  it("scales with revenue", () => {
    const small = lotsFromSector({ strategyId: "munitions", revenue: 1_000_000 });
    const big = lotsFromSector({ strategyId: "munitions", revenue: 10_000_000 });
    expect(big).toBeGreaterThan(small);
  });

  // NAMEPLATE, not realizedRevenue. Delivering to an arsenal now diverts output away from
  // the market and lowers realized revenue, so basing military capacity on the realized
  // figure would make a plant's output an input to its own diversion: a fully-contracted
  // plant would deliver everything, earn nothing, therefore produce nothing, therefore
  // deliver nothing, therefore earn again — oscillating every turn.
  it("reads the nameplate, so the diversion leg cannot feed back into output", () => {
    const rich = lotsFromSector({ strategyId: "munitions", revenue: 10_000_000 });
    const poor = lotsFromSector({ strategyId: "munitions", revenue: 1_000_000 });
    expect(rich).toBeGreaterThan(poor);
  });

  it("produces nothing for an unknown strategy", () => {
    expect(lotsFromSector({ strategyId: "not_a_strategy", revenue: 10_000_000 })).toBe(0);
  });

  it("produces whole lots", () => {
    expect(Number.isInteger(lotsFromSector({ strategyId: "munitions", revenue: 1_234_567 }))).toBe(
      true
    );
  });
});

describe("canSupply", () => {
  it("accepts a domestic corp whose currency matches its country", () => {
    expect(canSupply({ countryId: "US", liquidCurrencyCode: "USD" }, "US")).toBe(true);
  });

  it("refuses a foreign corp", () => {
    expect(canSupply({ countryId: "UK", liquidCurrencyCode: "GBP" }, "US")).toBe(false);
  });

  // The trap this guard exists for: pre-forex corps have no currency code and are documented
  // "treat as USD", so a UK corp without one would be paid dollars from a sterling
  // appropriation with no conversion anywhere.
  it("refuses a corp whose absent currency code defaults away from its country's", () => {
    expect(canSupply({ countryId: "UK" }, "UK")).toBe(false);
  });

  it("accepts a pre-forex US corp, whose USD default is correct", () => {
    expect(canSupply({ countryId: "US" }, "US")).toBe(true);
  });
});

interface World {
  contracts: Record<string, unknown>[];
  sector: Record<string, unknown> | null;
  corp: Record<string, unknown> | null;
  appropriation: number;
  arsenalDeposits: { domain: string; lots: number; grade: number }[];
  corpCredits: number[];
  contractUpdates: Record<string, unknown>[];
  sectorOps: Record<string, unknown>[];
  /** Lots the arsenal actually holds, so a guarded draw can come up short. */
  stock: Record<string, number>;
  /** Simulates the arsenal write failing after the buyer has already been debited. */
  failDeposit?: boolean;
  /** Simulates the supplier's payment failing after the lots have landed. */
  failCorpCredit?: boolean;
}

function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "defenceContracts") {
        return {
          find: () => ({
            toArray: async () => w.contracts,
            sort: () => ({ toArray: async () => w.contracts }),
          }),
          findOne: async (f: Record<string, unknown>) => {
            const c = w.contracts.find((x) => String(x._id) === String(f._id));
            if (!c) return null;
            if (f.status && c.status !== f.status) return null;
            return c;
          },
          updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
            w.contractUpdates.push(u);
            const target =
              w.contracts.find((x) => String(x._id) === String(f._id)) ?? w.contracts[0];
            if (!target) return { matchedCount: 0, modifiedCount: 0 };
            const inc = (u.$inc ?? {}) as Record<string, number>;
            if (inc.lotsDelivered) {
              target.lotsDelivered = (target.lotsDelivered as number) + inc.lotsDelivered;
            }
            const set = (u.$set ?? {}) as Record<string, unknown>;
            for (const [k, v] of Object.entries(set)) target[k] = v;
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "corporateSectors") {
        return {
          findOne: async () => w.sector,
          bulkWrite: async (ops: Record<string, unknown>[]) => {
            w.sectorOps.push(...ops);
            return { modifiedCount: ops.length };
          },
        };
      }
      if (name === "corporations") {
        return {
          findOne: async () => w.corp,
          updateOne: async (_f: unknown, u: Record<string, unknown>) => {
            if (w.failCorpCredit) throw new Error("corp credit failed");
            w.corpCredits.push(((u.$inc ?? {}) as Record<string, number>).liquidCapital ?? 0);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "nationalArsenal") {
        return {
          findOne: async () => ({ countryId: "US", stock: w.stock, grade: {} }),
          updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
            const inc = (u.$inc ?? {}) as Record<string, number>;
            const set = (u.$set ?? {}) as Record<string, number>;
            for (const [k, v] of Object.entries(inc)) {
              const domain = k.split(".")[1];
              if (v >= 0) {
                if (w.failDeposit) throw new Error("arsenal deposit failed");
                w.stock[domain] = (w.stock[domain] ?? 0) + v;
                w.arsenalDeposits.push({ domain, lots: v, grade: set[`grade.${domain}`] ?? 0 });
                continue;
              }
              // A draw is guarded: model the `$gte` so it can genuinely come up short rather
              // than silently succeeding against an empty store.
              const need = (f[k] as { $gte?: number } | undefined)?.$gte;
              if (need != null && (w.stock[domain] ?? 0) < need) {
                return { matchedCount: 0, modifiedCount: 0 };
              }
              w.stock[domain] = (w.stock[domain] ?? 0) + v;
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      // federalBudget — the appropriation.
      return {
        findOne: async () => ({
          countryId: "US",
          gdp: 387_000_000_000,
          defenseAppropriation: {
            balance: w.appropriation,
            accruedThroughTurn: 1,
            arrearsRatio: 0,
          },
        }),
        updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
          const need = (f["defenseAppropriation.balance"] as { $gte?: number } | undefined)?.$gte;
          if (need != null && w.appropriation < need) return { matchedCount: 0, modifiedCount: 0 };
          const inc = ((u.$inc ?? {}) as Record<string, number>)["defenseAppropriation.balance"];
          if (inc) w.appropriation += inc;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const SECTOR_ID = new ObjectId();
const CORP_ID = new ObjectId();

function world(over: Partial<World> = {}): World {
  return {
    contracts: [
      {
        _id: new ObjectId(),
        countryId: "US",
        corporationId: CORP_ID,
        sectorId: SECTOR_ID,
        component: "ground",
        lotsOrdered: 1_000_000,
        lotsDelivered: 0,
        pricePerLot: 100,
        status: "active",
      },
    ],
    sector: { _id: SECTOR_ID, strategyId: "munitions", revenue: 10_000_000 },
    corp: { _id: CORP_ID, countryId: "US", liquidCurrencyCode: "USD", unlockedTechNodeIds: [] },
    appropriation: 1_000_000_000,
    arsenalDeposits: [],
    corpCredits: [],
    contractUpdates: [],
    sectorOps: [],
    stock: {},
    ...over,
  };
}

describe("applyDefenceDeliveries", () => {
  it("does nothing for a country with no contracts", async () => {
    const w = world({ contracts: [] });
    expect(await applyDefenceDeliveries(stubDb(w), "US", 1953)).toEqual({
      lots: 0,
      paid: 0,
      stalled: 0,
    });
  });

  it("delivers into the arsenal and pays the corporation", async () => {
    const w = world();
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.lots).toBeGreaterThan(0);
    expect(w.arsenalDeposits[0].domain).toBe("ground");
    expect(w.corpCredits[0]).toBe(r.paid);
  });

  // Procurement has NO overdraft. A country that cannot pay takes fewer lots.
  it("delivers only what the appropriation can cover, never going negative", async () => {
    const w = world({ appropriation: 250 }); // 2 lots at 100 each
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.lots).toBe(2);
    expect(w.appropriation).toBeGreaterThanOrEqual(0);
  });

  it("delivers nothing on an empty appropriation", async () => {
    const w = world({ appropriation: 0 });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.lots).toBe(0);
    expect(w.arsenalDeposits).toHaveLength(0);
  });

  it("never delivers more than the order has outstanding", async () => {
    const w = world();
    w.contracts[0].lotsOrdered = 5;
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.lots).toBe(5);
  });

  it("accumulates sub-lot output across turns instead of discarding it", async () => {
    // Revenue tuned so the plant produces well under one whole lot per turn — the exact case
    // that used to floor to zero and deliver nothing forever.
    const perUnit = rawLotsFromSector({ strategyId: "munitions", revenue: 1 });
    const revenue = 0.3 / perUnit;
    expect(lotsFromSector({ strategyId: "munitions", revenue })).toBe(0); // floors to nothing

    const w = world({ sector: { _id: SECTOR_ID, strategyId: "munitions", revenue } });
    w.contracts[0].lotsOrdered = 5;

    // First turn ships nothing but banks the fractional output as carry.
    const t1 = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(t1.lots).toBe(0);
    expect((w.contracts[0].deliveryCarry as number) > 0).toBe(true);

    // Over enough turns the banked remainder crosses whole lots and the order advances, where
    // the old floor-every-turn behaviour left it stuck at zero indefinitely.
    let total = t1.lots;
    for (let i = 0; i < 30; i++) {
      total += (await applyDefenceDeliveries(stubDb(w), "US", 1953)).lots;
    }
    expect(total).toBeGreaterThan(0);
    expect(w.contracts[0].lotsDelivered).toBe(total);
  });

  it("stalls a contract whose plant has been re-tooled off the component", async () => {
    const w = world({
      sector: { _id: SECTOR_ID, strategyId: "cyber", revenue: 10_000_000 },
    });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.stalled).toBe(1);
    expect(r.lots).toBe(0);
  });

  it("stalls a contract whose supplier is foreign", async () => {
    const w = world({
      corp: { _id: CORP_ID, countryId: "UK", liquidCurrencyCode: "GBP" },
    });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(r.stalled).toBe(1);
    expect(w.corpCredits).toHaveLength(0);
  });

  it("stalls rather than paying when the sector or corp has vanished", async () => {
    expect(
      (await applyDefenceDeliveries(stubDb(world({ sector: null })), "US", 1953)).stalled
    ).toBe(1);
    expect((await applyDefenceDeliveries(stubDb(world({ corp: null })), "US", 1953)).stalled).toBe(
      1
    );
  });

  // The era gate that stops a 1953 world fielding modern kit must win over corp R&D.
  it("clamps delivered grade to the era ceiling", async () => {
    const w = world();
    await applyDefenceDeliveries(stubDb(w), "US", 2029, 1);
    expect(w.arsenalDeposits[0].grade).toBeLessThanOrEqual(1);
  });

  it("delivers at grade 0 from a corporation that has researched nothing", async () => {
    const w = world();
    await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(w.arsenalDeposits[0].grade).toBe(0);
  });
});

// The buyer's money leaves the pot BEFORE the materiel and the supplier's payment land.
// Every failure past that point has to unwind, or the appropriation is simply destroyed.
describe("applyDefenceDeliveries — unwind after a successful debit", () => {
  it("refunds the whole cost when the arsenal deposit fails", async () => {
    const w = world({ failDeposit: true });
    const opening = w.appropriation;

    const res = await applyDefenceDeliveries(stubDb(w), "US", 1953);

    expect(res.lots).toBe(0);
    expect(res.stalled).toBe(1);
    expect(w.appropriation).toBe(opening);
    expect(w.arsenalDeposits).toHaveLength(0);
    expect(w.corpCredits).toHaveLength(0);
  });

  it("reclaims the lots and refunds them when the supplier's payment fails", async () => {
    const w = world({ failCorpCredit: true });
    const opening = w.appropriation;

    const res = await applyDefenceDeliveries(stubDb(w), "US", 1953);

    expect(res.lots).toBe(0);
    expect(res.stalled).toBe(1);
    // Lots deposited, then drawn straight back out, and the buyer made whole.
    expect(w.arsenalDeposits.length).toBeGreaterThan(0);
    expect(w.stock.ground ?? 0).toBe(0);
    expect(w.appropriation).toBe(opening);
  });

  it("keeps the sweep alive for later contracts when one fails", async () => {
    const w = world({ failDeposit: true });
    w.contracts.push({ ...w.contracts[0], _id: new ObjectId() });

    const res = await applyDefenceDeliveries(stubDb(w), "US", 1953);

    // Both contracts were attempted rather than the first throw aborting the country.
    expect(res.stalled).toBe(2);
  });
});

// Output shipped to an arsenal is paid for per lot and must not also be sold on the market.
// The stamp here is what both the cash leg (`sectorTurn`) and the goods leg
// (`computeRawSupplyDemand`) read back to take it off.
describe("applyDefenceDeliveries — diverting output away from the market", () => {
  it("stamps the plant with the share of its output that went to the state", async () => {
    const w = world();
    await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 42);

    expect(w.sectorOps).toHaveLength(1);
    const update = (
      w.sectorOps[0] as {
        updateOne: { update: { $set: Record<string, number> } };
      }
    ).updateOne.update.$set;
    expect(update.militaryDivertedFraction).toBeGreaterThan(0);
    expect(update.militaryDivertedFraction).toBeLessThanOrEqual(1);
    expect(update.militaryDivertedTurn).toBe(42);
  });

  it("stamps nothing when no contract delivered", async () => {
    // An empty appropriation pays for nothing, so no output leaves the market.
    const w = world({ appropriation: 0 });
    await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 42);
    expect(w.sectorOps).toHaveLength(0);
  });

  // One plant can carry several contracts; it is the TOTAL share of its output that leaves
  // the market, not each contract's share counted separately.
  it("sums a plant's contracts into one diversion rather than one per contract", async () => {
    const w = world();
    w.contracts.push({ ...w.contracts[0], _id: new ObjectId() });
    await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 42);

    // Both contracts point at the same sector — one write, not two.
    expect(w.sectorOps).toHaveLength(1);
  });
});
