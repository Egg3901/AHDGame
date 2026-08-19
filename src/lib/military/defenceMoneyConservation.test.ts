import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyDefenceDeliveries } from "@/lib/turn/defenceDeliveryTurn";
import { lotProductionCost, GRADE_PRICE_SCALE } from "@/lib/military/defenceLotEconomics";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";

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
  claims: Map<string, Record<string, unknown>>;
  contracts: Record<string, unknown>[];
  stock: Record<string, number>;
  commodityPrices?: CommodityPrice[];
  /** Opening liquid capital on the supplier, which gates delivery at a loss. */
  corpCapital?: number;
}

function ledger(over: Partial<Ledger> = {}): Ledger {
  return {
    balance: 1_000_000_000,
    corpCapital: 1e15,
    encumbered: 0,
    corpCash: 0,
    claims: new Map<string, Record<string, unknown>>(),
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
            // Read off the ledger: whether a supplier can fund a loss is now a real gate on
            // delivery, so the fixture has to be able to say how much cash it has.
            liquidCapital: l.corpCapital ?? 0,
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
      if (name === "commodityPrices") {
        // Live commodity ratios now drive the build cost. An empty book leaves every recipe at
        // its nominal share, which is the pre-wiring behaviour and the right default here.
        return {
          find: () => ({ toArray: async () => l.commodityPrices ?? [] }),
        };
      }
      if (name === MONEY_MOVE_COLLECTION) {
        // The shared money primitive's claim record. A unique `_id` insert is the only atomic
        // guarantee it relies on, so the stub models exactly that and nothing else.
        return {
          findOne: async (f: { _id: string }) => l.claims.get(f._id) ?? null,
          insertOne: async (doc: { _id: string }) => {
            if (l.claims.has(doc._id)) {
              throw Object.assign(new Error("duplicate key"), { code: 11000 });
            }
            // Full doc, as Mongo keeps it: completeMoneyMove maps over the claim's legs.
            l.claims.set(doc._id, doc as unknown as Record<string, unknown>);
            return { insertedId: doc._id };
          },
          updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
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

// A realistic struck price: comfortably above what a lot costs to build, the way the award
// band guarantees at signing. A price below cost is now a real (and separately tested) outcome
// rather than the default, since live input prices can overtake a contract after it is signed.
// Cost is a share of price now (ticket #1134), so the anchor leads and cost follows. Kept in
// the same order of magnitude the struck price always had here: this file tests MONEY
// CONSERVATION, and a ten-lot order large enough to trip the per-turn payout cap would deliver
// eight lots and fail on the wrong subject.
const ANCHOR = 100_000;
const PRICE = Math.ceil(lotProductionCost("heavy_armor", ANCHOR)! * 1.5);

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
    // A contract awarded under the current rules. Without the stamp it would be grandfathered
    // onto the pre-#1134 cost model (see `contractLotProductionCost`), which is covered by its
    // own boundary tests; this file is about the economics new orders settle on.
    costBasis: "margin",
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
    // Build cost is graded to the delivered grade (grade 0 here: nothing researched), the
    // same scale the contract's price band charged.
    expect(r.productionCost).toBeCloseTo(
      lotProductionCost("heavy_armor", PRICE)! * GRADE_PRICE_SCALE[0] * r.lots,
      -1
    );
    // Legs net to zero: the appropriation's outlay is exactly the supplier's gain plus the
    // inputs burned building the materiel.
    expect(openingBalance - l.balance).toBe(l.corpCash + r.productionCost);
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

    const openingBalance = l.balance;
    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(10);
    expect(openingBalance - l.balance).toBe(r.paid);
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

/**
 * Live input prices mean a contract can go UNDERWATER after it is signed: the band's floor held
 * on the day it was struck, and then steel moved. That is a real economic outcome rather than an
 * error, so it is modelled explicitly instead of being clamped away - and conservation has to
 * hold in that direction too.
 */
describe("a contract the commodity market has overtaken", () => {
  const DEAR_STEEL = new Map([["steel", 9]]) as never;

  function underwater(over: Record<string, unknown> = {}) {
    const l = ledger({ balance: 1_000_000_000 });
    // Struck well BELOW what a lot now costs to build.
    //
    // Necessarily a PRE-#1134 contract. Under the margin basis build cost is
    // `price x min(0.85 x index, MAX_COST_SHARE_OF_PRICE)` and that share is capped below 1,
    // so a shortage squeezes the supplier's margin toward the floor but can never take it
    // negative. Going underwater is now only reachable on the grandfathered cost model, where
    // cost was computed with no reference to the price at all - which is exactly the case the
    // 37 live contracts are settling under, so the guard still has to work.
    l.contracts = [
      contract({
        lotsOrdered: 10,
        pricePerLot: 1_000,
        encumberedAmount: 10 * 1_000,
        costBasis: undefined,
        ...over,
      }),
    ];
    l.encumbered = 10 * 1_000;
    l.commodityPrices = [
      { commodity: "steel", globalPrice: COMMODITY_BASE_PRICES.steel * 9 } as never,
    ];
    void DEAR_STEEL;
    return l;
  }

  it("delivers at a loss the supplier funds, and the legs still net to zero", async () => {
    const l = underwater();
    l.corpCash = 0;
    const openingBalance = l.balance;

    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(10);
    expect(r.productionCost).toBeGreaterThan(r.paid);
    // The supplier ends POORER: it was paid the contract price and spent more than that on
    // inputs. Conservation is unchanged - the buyer's outlay plus the supplier's loss is
    // exactly what the inputs cost.
    expect(l.corpCash).toBeLessThan(0);
    expect(openingBalance - l.balance).toBe(r.paid);
    expect(l.corpCash).toBe(r.paid - r.productionCost);
  });

  // The guard that keeps a half-applied move out of the repair queue: a supplier with no cash
  // cannot deliver into a debit it cannot fund, so the sweep refuses BEFORE anything moves.
  // The flip side, and a real property of the rework: a contract awarded under the margin
  // basis cannot be driven underwater by the commodity market at all, because its cost is a
  // capped share of its own price. The worst a shortage can do is take the supplier down to
  // the minimum contract margin.
  it("cannot drive a margin-basis contract underwater however dear inputs get", async () => {
    const l = underwater({ costBasis: "margin" });
    l.corpCash = 0;
    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(10);
    expect(r.productionCost).toBeLessThan(r.paid);
    expect(l.corpCash).toBeGreaterThan(0);
    expect(l.corpCash).toBe(r.paid - r.productionCost);
  });

  it("refuses to deliver when the supplier cannot fund the loss", async () => {
    const l = underwater();
    l.corpCapital = 0;
    const openingBalance = l.balance;
    const r = await applyDefenceDeliveries(stubDb(l), "US", 1953, 3, 5);

    expect(r.lots).toBe(0);
    expect(r.stalled).toBe(1);
    expect(l.balance).toBe(openingBalance);
    expect(l.corpCash).toBe(0);
    expect(l.contracts[0].lotsDelivered).toBe(0);
    expect(l.contracts[0].carryReason).toBe("supplier_cannot_fund_loss");
  });
});
