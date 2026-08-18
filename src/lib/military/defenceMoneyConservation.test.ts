import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyDefenceDeliveries } from "@/lib/turn/defenceDeliveryTurn";
import { lotProductionCost } from "@/lib/military/defenceLotEconomics";

vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));

/**
 * Money conservation across the whole procurement lifecycle.
 *
 * The exploit this rework closes was a conservation failure: the appropriation fell and the
 * supplier's cash rose by the SAME figure, with nothing produced or consumed in between, so
 * the contract price was pure money creation and an unbounded order emptied the budget into a
 * private balance. The invariants that must hold now:
 *
 *   1. what the buyer pays = what the supplier receives + what the goods cost to build;
 *   2. an obligation is committed at award and only ever drawn down or handed back - the
 *      commitment plus the cash paid never exceeds the order;
 *   3. every step is idempotent under retry, because Mongo has no transactions here and a
 *      turn can genuinely be re-run.
 */

const SECTOR_ID = new ObjectId();
const CORP_ID = new ObjectId();

interface Ledger {
  balance: number;
  encumbered: number;
  corpCash: number;
  claims: Set<string>;
  contracts: Record<string, unknown>[];
  stock: Record<string, number>;
}

function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    balance: 1_000_000,
    encumbered: 0,
    corpCash: 0,
    claims: new Set<string>(),
    contracts: [],
    stock: {},
    ...over,
  };
}

function stubDb(l: Ledger): Db {
  return {
    collection: (name: string) => {
      if (name === "defenceContracts") {
        return {
          find: () => ({
            toArray: async () => l.contracts,
            sort: () => ({ toArray: async () => l.contracts }),
          }),
          findOne: async (f: Record<string, unknown>) => {
            const c = l.contracts.find((x) => String(x._id) === String(f._id));
            if (!c) return null;
            if (f.status && c.status !== f.status) return null;
            return c;
          },
          updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
            const t = l.contracts.find((x) => String(x._id) === String(f._id)) ?? l.contracts[0];
            if (!t) return { matchedCount: 0, modifiedCount: 0 };
            for (const [k, v] of Object.entries((u.$inc ?? {}) as Record<string, number>)) {
              t[k] = ((t[k] as number) ?? 0) + v;
            }
            for (const [k, v] of Object.entries((u.$set ?? {}) as Record<string, unknown>)) {
              t[k] = v;
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "corporateSectors") {
        return {
          findOne: async () => ({ _id: SECTOR_ID, strategyId: "heavy_armor", revenue: 10_000_000 }),
          bulkWrite: async (ops: unknown[]) => ({ modifiedCount: ops.length }),
        };
      }
      if (name === "corporations") {
        return {
          findOne: async () => ({
            _id: CORP_ID,
            countryId: "US",
            liquidCurrencyCode: "USD",
            unlockedTechNodeIds: [],
          }),
          updateOne: async (_f: unknown, u: Record<string, unknown>) => {
            l.corpCash += ((u.$inc ?? {}) as Record<string, number>).liquidCapital ?? 0;
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "nationalArsenal") {
        return {
          findOne: async () => ({ countryId: "US", stock: l.stock, grade: {} }),
          updateOne: async (_f: unknown, u: Record<string, unknown>) => {
            for (const [k, v] of Object.entries((u.$inc ?? {}) as Record<string, number>)) {
              const domain = k.split(".")[1];
              l.stock[domain] = (l.stock[domain] ?? 0) + v;
            }
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "defenceMoneyClaims") {
        return {
          insertOne: async (doc: { _id: string }) => {
            if (l.claims.has(doc._id)) {
              throw Object.assign(new Error("duplicate key"), { code: 11000 });
            }
            l.claims.add(doc._id);
            return { insertedId: doc._id };
          },
          deleteOne: async (f: { _id: string }) => {
            l.claims.delete(f._id);
            return { deletedCount: 1 };
          },
        };
      }
      // federalBudget
      return {
        findOne: async () => ({
          countryId: "US",
          gdp: 387_000_000_000,
          defenseAppropriation: {
            balance: l.balance,
            encumbered: l.encumbered,
            accruedThroughTurn: 1,
            arrearsRatio: 0,
          },
        }),
        updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
          const expr = f.$expr as { $gte?: [unknown, number] } | undefined;
          if (expr?.$gte && l.balance - l.encumbered < expr.$gte[1]) {
            return { matchedCount: 0, modifiedCount: 0 };
          }
          const needB = (f["defenseAppropriation.balance"] as { $gte?: number } | undefined)?.$gte;
          if (needB != null && l.balance < needB) return { matchedCount: 0, modifiedCount: 0 };
          const needE = (f["defenseAppropriation.encumbered"] as { $gte?: number } | undefined)
            ?.$gte;
          if (needE != null && l.encumbered < needE) return { matchedCount: 0, modifiedCount: 0 };
          const inc = (u.$inc ?? {}) as Record<string, number>;
          l.balance += inc["defenseAppropriation.balance"] ?? 0;
          l.encumbered += inc["defenseAppropriation.encumbered"] ?? 0;
          return { matchedCount: 1, modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

const PRICE = 1_000;

function contract(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    corporationId: CORP_ID,
    sectorId: SECTOR_ID,
    component: "ground",
    lotsOrdered: 10,
    lotsDelivered: 0,
    pricePerLot: PRICE,
    encumberedAmount: 10 * PRICE,
    amountPaid: 0,
    productionCostPaid: 0,
    assignedFactories: 4,
    status: "active",
    ...over,
  };
}

describe("defence procurement money conservation", () => {
  let l: Ledger;

  beforeEach(() => {
    l = ledger();
    l.contracts = [contract()];
    // Award already happened: the full order is committed against the appropriation.
    l.encumbered = 10 * PRICE;
  });

  // INVARIANT 1. The buyer's outlay equals the supplier's gain plus the real cost of the
  // goods. Before the cost leg existed those two were EQUAL, which is money creation.
  it("pays the supplier margin, not the whole price", async () => {
    const openingBalance = l.balance;
    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(10);
    expect(openingBalance - l.balance).toBe(r.paid);
    expect(l.corpCash).toBe(r.paid - r.productionCost);
    expect(r.productionCost).toBeGreaterThan(0);
    expect(r.productionCost).toBeCloseTo(lotProductionCost("heavy_armor")! * r.lots, -1);
  });

  // INVARIANT 2. Delivery DRAWS THE COMMITMENT DOWN rather than spending afresh. A completed
  // order leaves nothing committed, so the budget it reserved is spendable again.
  it("draws the encumbrance down as it pays and releases the residue on completion", async () => {
    await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(l.contracts[0].status).toBe("complete");
    expect(l.contracts[0].lotsDelivered).toBe(10);
    expect(l.contracts[0].amountPaid).toBe(10 * PRICE);
    expect(l.contracts[0].encumberedAmount).toBe(0);
    expect(l.encumbered).toBe(0);
  });

  // INVARIANT 2, partial case. A half-delivered order still holds exactly what it still owes.
  it("holds the commitment for lots that have not shipped yet", async () => {
    l.contracts = [contract({ lotsOrdered: 1_000, encumberedAmount: 1_000 * PRICE })];
    l.encumbered = 1_000 * PRICE;
    l.balance = 1_000 * PRICE;

    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBeGreaterThan(0);
    expect(r.lots).toBeLessThan(1_000);
    // Everything not yet delivered is still committed, to the penny.
    expect(l.encumbered).toBe(1_000 * PRICE - r.paid);
    expect(l.contracts[0].encumberedAmount).toBe(1_000 * PRICE - r.paid);
  });

  // THE EXPLOIT, directly. An order far larger than the appropriation cannot drain it: the
  // sweep is bounded by the money the contract actually reserved.
  it("cannot pay out more than the contract committed, however large the order", async () => {
    l.contracts = [contract({ lotsOrdered: 1_000_000, encumberedAmount: 5 * PRICE })];
    l.encumbered = 5 * PRICE;

    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.paid).toBeLessThanOrEqual(5 * PRICE);
    expect(l.balance).toBeGreaterThanOrEqual(0);
  });

  // INVARIANT 3. Mongo has no transactions here, so a re-run turn is a real scenario. The
  // claim key is taken BEFORE the money moves, so the retry is a no-op rather than a repeat.
  it("is idempotent when the same turn is settled twice", async () => {
    // A long order, so the retry genuinely re-attempts a delivery rather than finding the
    // contract closed. The guard under test is the CLAIM KEY, not the status.
    l.contracts = [contract({ lotsOrdered: 1_000, encumberedAmount: 1_000 * PRICE })];
    l.encumbered = 1_000 * PRICE;
    l.balance = 1_000 * PRICE;

    const first = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);
    const balanceAfter = l.balance;
    const cashAfter = l.corpCash;
    const deliveredAfter = l.contracts[0].lotsDelivered;

    const second = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(first.paid).toBeGreaterThan(0);
    expect(second.paid).toBe(0);
    expect(l.balance).toBe(balanceAfter);
    expect(l.corpCash).toBe(cashAfter);
    expect(l.contracts[0].lotsDelivered).toBe(deliveredAfter);
    expect(l.contracts[0].carryReason).toBe("already_settled_this_turn");
  });

  // A NEW turn is a new key, so idempotency does not become a permanent stall.
  it("settles again on the next turn", async () => {
    l.contracts = [contract({ lotsOrdered: 1_000, encumberedAmount: 1_000 * PRICE })];
    l.encumbered = 1_000 * PRICE;
    l.balance = 1_000 * PRICE;

    const t5 = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);
    const t6 = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 6);

    expect(t5.paid).toBeGreaterThan(0);
    expect(t6.paid).toBeGreaterThan(0);
  });

  // A legacy contract carries no reservation, so it must fall back to spending uncommitted
  // budget rather than stalling forever on a commitment it was never given.
  it("still delivers a contract awarded before encumbrance existed", async () => {
    l.contracts = [contract({ encumberedAmount: undefined })];
    l.encumbered = 0;

    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(10);
    expect(l.balance).toBe(1_000_000 - r.paid);
  });

  // A legacy contract must not be able to eat budget another contract has committed.
  it("keeps a legacy contract out of money already committed elsewhere", async () => {
    l.contracts = [contract({ encumberedAmount: undefined })];
    l.balance = 10 * PRICE;
    l.encumbered = 8 * PRICE; // another order holds most of the pot

    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(2);
    expect(l.balance - l.encumbered).toBeGreaterThanOrEqual(0);
  });
});
