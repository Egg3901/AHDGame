import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { canSupply, applyDefenceDeliveries } from "./defenceDeliveryTurn";
import { lotsFromSector, rawLotsFromSector } from "@/lib/military/arsenal";
import { emitTx } from "@/lib/financialTxLog/emit";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";

vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

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

  // Missing liquidCurrencyCode is inferred from the corp's country (same as
  // resolveCorpLiquidCurrencyCode), not treated as USD. Defaulting to USD hid every
  // non-US domestic plant — including Soviet state industry — from the award picker.
  it("accepts a domestic corp whose currency is inferred from its country", () => {
    expect(canSupply({ countryId: "UK" }, "UK")).toBe(true);
    expect(canSupply({ countryId: "RU" }, "RU")).toBe(true);
  });

  it("accepts a pre-forex US corp, whose inferred currency is USD", () => {
    expect(canSupply({ countryId: "US" }, "US")).toBe(true);
  });

  it("still refuses an explicit currency that does not match the buyer", () => {
    expect(canSupply({ countryId: "RU", liquidCurrencyCode: "USD" }, "RU")).toBe(false);
  });
});

interface World {
  contracts: Record<string, unknown>[];
  sector: Record<string, unknown> | null;
  corp: Record<string, unknown> | null;
  appropriation: number;
  /** Local currency already committed to live contracts. */
  encumbered: number;
  /** Claim records already taken (full docs, as Mongo keeps them), so a re-run turn cannot pay twice. */
  claims: Map<string, Record<string, unknown>>;
  /** Live commodity book. Empty leaves every recipe at its nominal input share. */
  commodityPrices?: CommodityPrice[];
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
  /** Enacted annual defence line. Omitted, the budget falls back to its GDP fraction. */
  defenceLine?: number;
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
      if (name === "commodityPrices") {
        // Live commodity ratios now drive the build cost. An empty book leaves every recipe at
        // its nominal share, which is the pre-wiring behaviour and the right default here.
        return {
          find: () => ({ toArray: async () => w.commodityPrices ?? [] }),
        };
      }
      if (name === MONEY_MOVE_COLLECTION) {
        // The shared money primitive's claim record. A unique `_id` insert is the only atomic
        // guarantee it relies on, so the stub models exactly that and nothing else.
        return {
          findOne: async (f: { _id: string }) => w.claims.get(f._id) ?? null,
          insertOne: async (doc: { _id: string }) => {
            if (w.claims.has(doc._id)) {
              throw Object.assign(new Error("duplicate key"), { code: 11000 });
            }
            // The FULL document, exactly as Mongo would keep it: completeMoneyMove reads the
            // claim back and maps over its legs, so a stub that stored only the key made
            // every completion throw and every delivery reverse itself.
            w.claims.set(doc._id, doc as unknown as Record<string, unknown>);
            return { insertedId: doc._id };
          },
          updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
          deleteOne: async (f: { _id: string }) => {
            w.claims.delete(f._id);
            return { deletedCount: 1 };
          },
        };
      }
      // federalBudget — the appropriation.
      return {
        findOne: async () => ({
          countryId: "US",
          gdp: 387_000_000_000,
          // The per-turn payout cap is a rate against the enacted defence line, so the stub has
          // to be able to state one. Omitted, `resolveDefenseLineFrom` falls back to the GDP
          // fraction, which is what every case written before the cap existed assumes.
          ...(w.defenceLine != null
            ? { spending: { byCategory: { defense: w.defenceLine } } }
            : {}),
          defenseAppropriation: {
            balance: w.appropriation,
            encumbered: w.encumbered,
            accruedThroughTurn: 1,
            arrearsRatio: 0,
          },
        }),
        updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
          // Three filter shapes reach this collection, and the stub honours all three or the
          // guards it is meant to be testing are not being tested at all:
          //   1. `$expr` uncommitted check - a new obligation must fit inside balance minus
          //      what is already committed;
          //   2. explicit `$gte` on balance and/or encumbered - a settlement drawing a
          //      commitment down;
          //   3. no guard - a refund, which must never be refused.
          const expr = f.$expr as { $gte?: [unknown, number] } | undefined;
          if (expr?.$gte) {
            const need = expr.$gte[1];
            if (w.appropriation - w.encumbered < need) {
              return { matchedCount: 0, modifiedCount: 0 };
            }
          }
          const needBalance = (f["defenseAppropriation.balance"] as { $gte?: number } | undefined)
            ?.$gte;
          if (needBalance != null && w.appropriation < needBalance) {
            return { matchedCount: 0, modifiedCount: 0 };
          }
          const needEncumbered = (
            f["defenseAppropriation.encumbered"] as { $gte?: number } | undefined
          )?.$gte;
          if (needEncumbered != null && w.encumbered < needEncumbered) {
            return { matchedCount: 0, modifiedCount: 0 };
          }
          const inc = (u.$inc ?? {}) as Record<string, number>;
          if (inc["defenseAppropriation.balance"]) {
            w.appropriation += inc["defenseAppropriation.balance"];
          }
          if (inc["defenseAppropriation.encumbered"]) {
            w.encumbered += inc["defenseAppropriation.encumbered"];
          }
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
    // Deep pockets on purpose. These cases pin LOT accounting - carry, clamping, the arsenal -
    // and the fixture's nominal price sits below what a munitions lot costs to build, so
    // without this every one of them would stall on the (separately tested) rule that a
    // supplier must be able to fund a loss before it delivers into one.
    corp: {
      _id: CORP_ID,
      countryId: "US",
      liquidCurrencyCode: "USD",
      unlockedTechNodeIds: [],
      liquidCapital: 1e15,
    },
    appropriation: 1_000_000_000,
    encumbered: 0,
    claims: new Map<string, Record<string, unknown>>(),
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
      productionCost: 0,
    });
  });

  it("delivers into the arsenal and pays the corporation", async () => {
    const w = world();
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 42);
    expect(r.lots).toBeGreaterThan(0);
    expect(w.arsenalDeposits[0].domain).toBe("ground");
    // The supplier is credited MARGIN, not the gross contract price: delivery now carries a
    // production cost, so payment can no longer mint cash one-for-one out of the appropriation.
    expect(r.productionCost).toBeGreaterThan(0);
    expect(w.corpCredits[0]).toBe(r.paid - r.productionCost);
    expect(emitTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "defence_contract_payment",
        turn: 42,
        subjectType: "corporation",
        subjectId: CORP_ID,
        amount: r.paid,
      })
    );
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

  // Ticket #1099. A sub-lot plant spent ~10 turns accruing one whole lot, the appropriation
  // could not afford it on the turn it completed, and the finished lot was thrown away because
  // only the sub-lot remainder was banked. The contract sat at zero delivered forever while the
  // plant kept producing. Built output must wait for money, not evaporate.
  it("banks whole lots the appropriation cannot pay for instead of destroying them", async () => {
    const perUnit = rawLotsFromSector({ strategyId: "munitions", revenue: 1 });
    const revenue = 0.3 / perUnit; // well under one lot per turn
    const w = world({
      sector: { _id: SECTOR_ID, strategyId: "munitions", revenue },
      appropriation: 0, // nothing can be paid for yet
    });
    w.contracts[0].lotsOrdered = 3;

    for (let i = 0; i < 20; i++) {
      const r = await applyDefenceDeliveries(stubDb(w), "US", 1953);
      expect(r.lots).toBe(0);
    }
    // Six whole lots' worth of production, banked rather than binned, capped at the order.
    expect(w.contracts[0].lotsDelivered).toBe(0);
    expect(w.contracts[0].deliveryCarry as number).toBe(3);

    // The money arrives and the yard ships everything it has been holding.
    w.appropriation = 1_000_000;
    const paid = await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(paid.lots).toBe(3);
    expect(w.contracts[0].lotsDelivered).toBe(3);
  });

  it("never banks more than the order still needs", async () => {
    const w = world({ appropriation: 0 });
    w.contracts[0].lotsOrdered = 2;
    for (let i = 0; i < 5; i++) await applyDefenceDeliveries(stubDb(w), "US", 1953);
    expect(w.contracts[0].deliveryCarry as number).toBeLessThanOrEqual(2);
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
  // The money now moves BEFORE the arsenal deposit, because the shared primitive guards its own
  // debit and reports a refused move having touched nothing. So the supplier IS paid and then
  // refunded through a paired reversing move, rather than never being paid at all. What must
  // still hold is that both books come back to where they started.
  it("refunds the whole cost when the arsenal deposit fails", async () => {
    const w = world({ failDeposit: true });
    const opening = w.appropriation;

    const res = await applyDefenceDeliveries(stubDb(w), "US", 1953);

    expect(res.lots).toBe(0);
    expect(res.stalled).toBe(1);
    expect(w.appropriation).toBe(opening);
    expect(w.arsenalDeposits).toHaveLength(0);
    // Paid, then reversed: the supplier nets exactly zero.
    expect(w.corpCredits.reduce((a, b) => a + b, 0)).toBe(0);
  });

  // A supplier write that throws now fails INSIDE the money move, before the arsenal is
  // touched. Nothing is delivered, the contract keeps its lots banked, and the half-applied
  // move is left in the repair queue rather than being silently swallowed - which is the whole
  // reason the shared primitive owns this instead of a hand-rolled unwind ladder.
  it("stalls without delivering when the supplier's payment leg throws", async () => {
    const w = world({ failCorpCredit: true });

    const res = await applyDefenceDeliveries(stubDb(w), "US", 1953);

    expect(res.lots).toBe(0);
    expect(res.stalled).toBe(1);
    expect(w.arsenalDeposits).toHaveLength(0);
    expect(w.stock.ground ?? 0).toBe(0);
    // The lot record is reversed, so the contract does not claim materiel nobody received.
    expect(w.contracts[0].lotsDelivered).toBe(0);
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

// Ticket #1134 / the procurement freeze. A delivery pays the supplier the contract price minus
// a production cost that is five orders of magnitude smaller (383,748,809 against 1,091 on the
// live world), so procurement is very nearly a straight transfer of national appropriation into
// one corporation's cash. The award quota already bounds the TOTAL per contracting window; these
// cases pin the RATE, which is what a single high-throughput plant used to be able to empty in
// one turn.
describe("applyDefenceDeliveries — the per-turn appropriation spend cap", () => {
  /** 48bn a year: 450m of procurement accrues per turn, so the country may pay 1.35bn. */
  const DEFENCE_LINE = 48_000_000_000;

  function drainWorld(over: Partial<World> = {}): World {
    return world({
      defenceLine: DEFENCE_LINE,
      // Deep enough that caps 1 to 3 cannot be what stops anything.
      appropriation: 1e15,
      sector: { _id: SECTOR_ID, strategyId: "munitions", revenue: 1e12 },
      ...over,
    });
  }

  function contract(over: Record<string, unknown> = {}) {
    return {
      _id: new ObjectId(),
      countryId: "US",
      corporationId: CORP_ID,
      sectorId: SECTOR_ID,
      component: "ground",
      lotsOrdered: 100,
      lotsDelivered: 0,
      pricePerLot: 500_000_000,
      assignedFactories: 4,
      status: "active",
      ...over,
    };
  }

  it("the plant really could build far more than the cap allows", () => {
    expect(rawLotsFromSector({ strategyId: "munitions", revenue: 1e12 })).toBeGreaterThan(50);
  });

  it("refuses to drain a whole contracting window into one supplier in one turn", async () => {
    const w = drainWorld({ contracts: [contract()] });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 5);
    // Private supplier allowance is a third of 1.35bn = 450m, under one 500m lot, so the
    // country-wide one-lot floor is all this contract gets.
    expect(r.lots).toBe(1);
    expect(r.paid).toBe(500_000_000);
    expect(w.contracts[0].carryReason).toBe("turn_spend_cap");
  });

  it("does not let a second contract on the same supplier take the floor again", async () => {
    const w = drainWorld({ contracts: [contract(), contract()] });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 5);
    expect(r.lots).toBe(1);
    expect(r.paid).toBe(500_000_000);
  });

  // The other half of the brief: this must not replace a one-plant wall with a rate wall. A
  // buyer with real throughput and a real budget ships many lots a turn.
  it("lets a large-budget buyer ship many lots in a single turn", async () => {
    const w = drainWorld({
      contracts: [contract({ pricePerLot: 50_000_000, lotsOrdered: 30 })],
    });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 5);
    // 450m of supplier allowance at 50m a lot.
    expect(r.lots).toBe(9);
    expect(r.paid).toBe(450_000_000);
  });

  it("delivers the whole order over successive turns, so the cap costs no lots", async () => {
    const w = drainWorld({
      contracts: [contract({ pricePerLot: 50_000_000, lotsOrdered: 30 })],
    });
    let total = 0;
    for (let turn = 5; turn < 15; turn++) {
      total += (await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, turn)).lots;
    }
    expect(total).toBe(30);
    expect(w.contracts[0].lotsDelivered).toBe(30);
  });

  it("leaves a country with no enacted defence line able to ship, not deadlocked", async () => {
    const w = drainWorld({
      defenceLine: undefined,
      contracts: [contract({ pricePerLot: 50_000_000, lotsOrdered: 30 })],
    });
    const r = await applyDefenceDeliveries(stubDb(w), "US", 1953, 3, 5);
    expect(r.lots).toBeGreaterThanOrEqual(1);
  });
});
