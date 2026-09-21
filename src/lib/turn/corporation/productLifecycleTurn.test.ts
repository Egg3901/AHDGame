/**
 * Turn-shell tests for the corporation product lifecycle phase
 * (issue #2125 slice): flag-off neutrality, bulk replay-safe persistence,
 * launch freeze, auto-retire slot freeing, and hostile-input bounds.
 */
import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import {
  processCorporationProductTurn,
  buildProductLifecycleCorpInput,
} from "./productLifecycleTurn";
import {
  CORPORATION_PRODUCTS_COLLECTION,
  toProductDocument,
  type CorporationProductDocument,
} from "@/lib/products/persistence";
import { startProductDevelopment } from "@/lib/products/lifecycle";

interface FakeStore {
  docs: Map<string, Record<string, unknown>>;
  findCalls: number;
  bulkWriteCalls: number;
  bulkWriteSizes: number[];
  lastOps: Record<string, unknown>[];
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (typeof expected === "object" && expected !== null) {
      const cond = expected as Record<string, unknown>;
      if ("$exists" in cond) return key in doc === Boolean(cond.$exists);
      if ("$ne" in cond) return doc[key] !== cond.$ne;
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  const set = (update.$set ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(set)) doc[key] = value;
  const unset = (update.$unset ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(unset)) delete doc[key];
}

function fakeDb(store: FakeStore): Db {
  return {
    collection: (name: string) => {
      if (name !== CORPORATION_PRODUCTS_COLLECTION) {
        throw new Error(`unexpected collection: ${name}`);
      }
      return {
        find: (filter: Record<string, unknown>) => ({
          toArray: async () => {
            store.findCalls += 1;
            return Array.from(store.docs.values()).filter((d) => matches(d, filter));
          },
        }),
        bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
          store.bulkWriteCalls += 1;
          store.bulkWriteSizes.push(ops.length);
          store.lastOps = ops as unknown as Record<string, unknown>[];
          let matched = 0;
          for (const op of ops) {
            const { filter, update } = op.updateOne as unknown as {
              filter: Record<string, unknown>;
              update: Record<string, unknown>;
            };
            const id = String((filter as Record<string, unknown>)._id);
            const doc = store.docs.get(id);
            if (doc && matches(doc, filter)) {
              applyUpdate(doc, update);
              matched += 1;
            }
          }
          return { matchedCount: matched };
        },
      };
    },
  } as unknown as Db;
}

function newStore(): FakeStore {
  return { docs: new Map(), findCalls: 0, bulkWriteCalls: 0, bulkWriteSizes: [], lastOps: [] };
}

function makeCorp(overrides: Partial<Corporation> & { _id: ObjectId }): Corporation {
  return {
    countryId: "US",
    name: "Test Corp",
    marketingBudget: 0,
    liquidCapital: 0,
    sharePrice: 1,
    totalShares: 1000,
    ...overrides,
  } as Corporation;
}

function makeActiveProduct(
  productId: string,
  corpId: string,
  startedTurn = 100
): CorporationProductDocument {
  const built = startProductDevelopment({
    enabled: true,
    activeProduct: null,
    draft: {
      id: productId,
      corporationId: corpId,
      kindId: "passenger_car",
      name: "P",
      startedTurn,
    },
  });
  if (!built.ok) throw new Error("fixture draft rejected");
  return toProductDocument(built.product);
}

describe("processCorporationProductTurn", () => {
  it("flag-off performs zero product reads or writes", async () => {
    const db = {
      collection: () => {
        throw new Error("must not touch the database when disabled");
      },
    } as unknown as Db;
    const result = await processCorporationProductTurn(db, {
      enabled: false,
      turn: 100,
      corpsById: new Map(),
      fxByCurrency: new Map(),
    });
    expect(result).toEqual({
      enabled: false,
      found: 0,
      advanced: 0,
      retired: 0,
      skippedMissingCorp: 0,
    });
  });

  it("accumulates development spend from converted local budgets", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    // USD at 2 local per 1 anchor: rdBudget 2400 local = 1200 anchor = 50/turn.
    store.docs.set("p1", { ...makeActiveProduct("p1", corpId.toString()), _id: "p1" });
    const db = fakeDb(store);
    const corpsById = new Map([
      [
        corpId.toString(),
        makeCorp({
          _id: corpId,
          liquidCurrencyCode: "USD",
          rdBudget: 2400,
          marketingBudget: 4800,
          averageQuality: 60,
        }),
      ],
    ]);
    const result = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 101,
      corpsById,
      fxByCurrency: new Map([["USD", 2]]),
    });
    expect(result).toEqual({
      enabled: true,
      found: 1,
      advanced: 1,
      retired: 0,
      skippedMissingCorp: 0,
    });
    const doc = store.docs.get("p1")!;
    expect(doc.stage).toBe("development");
    expect(doc.developmentSpendAnchor).toBe(1200 / TURNS_PER_DAY);
    expect(doc.developmentAdvertisingAnchor).toBe(2400 / TURNS_PER_DAY);
    expect(doc.developmentAdvertisingTurns).toBe(1);
    expect(doc.lastProcessedTurn).toBe(101);
    // Allocation view: the phase wrote product state, never corp cash fields.
    expect(store.bulkWriteCalls).toBe(1);
    expect(store.bulkWriteSizes).toEqual([1]);
  });

  it("freezes launch quality and brand at launch, then holds them", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    store.docs.set("p1", { ...makeActiveProduct("p1", corpId.toString(), 100), _id: "p1" });
    const db = fakeDb(store);
    const corpsById = new Map([
      [corpId.toString(), makeCorp({ _id: corpId, rdBudget: 2400, averageQuality: 60 })],
    ]);
    // Turn 106 = startedTurn + PRODUCT_DEVELOPMENT_TURNS: launch.
    await processCorporationProductTurn(db, {
      enabled: true,
      turn: 106,
      corpsById,
      fxByCurrency: new Map(),
    });
    const launched = store.docs.get("p1")!;
    expect(launched.stage).toBe("launch");
    expect(launched.launchedTurn).toBe(106);
    expect(typeof launched.launchQuality).toBe("number");
    expect(typeof launched.productBrand).toBe("number");
    // Next turn: still launch, frozen values untouched.
    await processCorporationProductTurn(db, {
      enabled: true,
      turn: 107,
      corpsById,
      fxByCurrency: new Map(),
    });
    const later = store.docs.get("p1")!;
    expect(later.stage).toBe("launch");
    expect(later.launchQuality).toBe(launched.launchQuality);
    expect(later.productBrand).toBe(launched.productBrand);
    expect(later.lastProcessedTurn).toBe(107);
  });

  it("replays are idempotent and writes carry the concurrency filter", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    store.docs.set("p1", { ...makeActiveProduct("p1", corpId.toString()), _id: "p1" });
    const db = fakeDb(store);
    const corpsById = new Map([[corpId.toString(), makeCorp({ _id: corpId, rdBudget: 2400 })]]);
    const args = { enabled: true, turn: 101, corpsById, fxByCurrency: new Map() } as const;
    const first = await processCorporationProductTurn(db, args);
    expect(first.advanced).toBe(1);
    const filter = (store.lastOps[0] as { updateOne: { filter: unknown } }).updateOne.filter;
    expect(filter).toEqual({ _id: "p1", lastProcessedTurn: { $ne: 101 } });
    // Same turn again: pure replay, no write issued.
    const second = await processCorporationProductTurn(db, args);
    expect(second).toMatchObject({ found: 1, advanced: 0 });
    expect(store.bulkWriteCalls).toBe(1);
    // Spend accumulated exactly once.
    expect(store.docs.get("p1")!.developmentSpendAnchor).toBe(2400 / TURNS_PER_DAY);
  });

  it("auto-retires in the same update that frees the active slot", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    const doc = { ...makeActiveProduct("p1", corpId.toString(), 0), _id: "p1" };
    doc.stage = "decline";
    doc.launchedTurn = 0;
    store.docs.set("p1", doc);
    const db = fakeDb(store);
    const corpsById = new Map([[corpId.toString(), makeCorp({ _id: corpId })]]);
    // Post-launch window is 4+12+24+12 = 52 turns; turn 52 retires.
    const result = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 52,
      corpsById,
      fxByCurrency: new Map(),
    });
    expect(result).toMatchObject({ advanced: 1, retired: 1 });
    const op = store.lastOps[0] as {
      updateOne: { update: { $set: Record<string, unknown>; $unset: Record<string, string> } };
    };
    expect(op.updateOne.update.$set.stage).toBe("retired");
    expect(op.updateOne.update.$unset).toEqual({ activeCorporationId: "" });
    const retiredDoc = store.docs.get("p1")!;
    expect(retiredDoc.stage).toBe("retired");
    expect("activeCorporationId" in retiredDoc).toBe(false);
    // Slot freed: the next turn finds no active products.
    const after = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 53,
      corpsById,
      fxByCurrency: new Map(),
    });
    expect(after).toMatchObject({ found: 0, advanced: 0 });
  });

  it("processes multiple products in a single bulkWrite", async () => {
    const store = newStore();
    const corpA = new ObjectId();
    const corpB = new ObjectId();
    store.docs.set("pa", { ...makeActiveProduct("pa", corpA.toString()), _id: "pa" });
    store.docs.set("pb", { ...makeActiveProduct("pb", corpB.toString()), _id: "pb" });
    const db = fakeDb(store);
    const corpsById = new Map([
      [corpA.toString(), makeCorp({ _id: corpA, rdBudget: 100 })],
      [corpB.toString(), makeCorp({ _id: corpB, rdBudget: 200 })],
    ]);
    const result = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 101,
      corpsById,
      fxByCurrency: new Map(),
    });
    expect(result).toEqual({
      enabled: true,
      found: 2,
      advanced: 2,
      retired: 0,
      skippedMissingCorp: 0,
    });
    expect(store.findCalls).toBe(1);
    expect(store.bulkWriteCalls).toBe(1);
    expect(store.bulkWriteSizes).toEqual([2]);
  });

  it("skips products whose corporation is missing without writing", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    store.docs.set("pa", { ...makeActiveProduct("pa", corpId.toString()), _id: "pa" });
    store.docs.set("ghost", { ...makeActiveProduct("ghost", "missing-corp"), _id: "ghost" });
    const db = fakeDb(store);
    const corpsById = new Map([[corpId.toString(), makeCorp({ _id: corpId, rdBudget: 100 })]]);
    const result = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 101,
      corpsById,
      fxByCurrency: new Map(),
    });
    expect(result).toMatchObject({ found: 2, advanced: 1, skippedMissingCorp: 1 });
    expect(store.bulkWriteSizes).toEqual([1]);
    expect(store.docs.get("ghost")!.lastProcessedTurn).toBeUndefined();
  });

  it("bounds hostile and non-finite economic inputs", async () => {
    const store = newStore();
    const corpId = new ObjectId();
    store.docs.set("p1", { ...makeActiveProduct("p1", corpId.toString()), _id: "p1" });
    const db = fakeDb(store);
    const corpsById = new Map([
      [
        corpId.toString(),
        makeCorp({
          _id: corpId,
          rdBudget: Number.NaN,
          marketingBudget: Number.POSITIVE_INFINITY,
          averageQuality: 9999,
          unlockedTechNodeIds: [123 as unknown as string, "tech-x"],
        }),
      ],
    ]);
    const result = await processCorporationProductTurn(db, {
      enabled: true,
      turn: 101,
      corpsById,
      fxByCurrency: new Map(),
    });
    expect(result.advanced).toBe(1);
    const doc = store.docs.get("p1")!;
    for (const value of Object.values(doc)) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
    expect(doc.developmentSpendAnchor).toBe(0);
    expect(doc.developmentAdvertisingAnchor).toBe(0);
  });

  it("builds per-turn anchor inputs from stored local budgets", () => {
    const corpId = new ObjectId();
    const input = buildProductLifecycleCorpInput(
      makeCorp({
        _id: corpId,
        liquidCurrencyCode: "USD",
        rdBudget: 2400,
        marketingBudget: 1200,
        averageQuality: 70,
        unlockedTechNodeIds: ["tech-a"],
      }),
      new Map([["USD", 2]])
    );
    expect(input).toEqual({
      corpId: corpId.toString(),
      sectorQuality: 70,
      productRnDAnchor: 1200 / TURNS_PER_DAY,
      deliveredAdvertisingAnchor: 600 / TURNS_PER_DAY,
      unlockedTechnologyIds: ["tech-a"],
    });
  });
});
