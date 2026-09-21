/**
 * Advertising-to-product turn seam (issues #2235/#2125): the sector pass's
 * settled marketing spend and delivered advertising value flow through
 * `processAdvertisingTurn` into `processCorporationProductTurn`, so product
 * brand uses settlement results instead of the requested `marketingBudget`.
 * Covers the seam end to end, no money movement, partial/no delivery,
 * replay safety, flag-off neutrality, and the effective brand input.
 */
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { processAdvertisingTurn } from "@/lib/advertising/settlementTurn";
import type { AdvertisingAgreement } from "@/lib/advertising/types";
import {
  buildProductLifecycleCorpInput,
  processCorporationProductTurn,
} from "@/lib/turn/corporation/productLifecycleTurn";
import {
  CORPORATION_PRODUCTS_COLLECTION,
  toProductDocument,
  type CorporationProductDocument,
} from "@/lib/products/persistence";
import { startProductDevelopment } from "@/lib/products/lifecycle";

interface FakeStore {
  agreements: Map<string, Record<string, unknown>>;
  settlements: Map<string, Record<string, unknown>>;
  models: { corporationId: string; operatingModel: string }[];
  products: Map<string, Record<string, unknown>>;
  touched: string[];
}

function newStore(): FakeStore {
  return {
    agreements: new Map(),
    settlements: new Map(),
    models: [],
    products: new Map(),
    touched: [],
  };
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (typeof cond === "object" && cond !== null) {
      const c = cond as Record<string, unknown>;
      if ("$in" in c) return Array.isArray(c.$in) && c.$in.includes(value);
      if ("$lte" in c)
        return typeof value === "number" && typeof c.$lte === "number" && value <= c.$lte;
      if ("$exists" in c) return key in doc === Boolean(c.$exists);
      if ("$ne" in c) return value !== c.$ne;
    }
    return value === cond;
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
      if (
        name !== "advertisingAgreements" &&
        name !== "advertisingSettlements" &&
        name !== "corporationOperatingModels" &&
        name !== CORPORATION_PRODUCTS_COLLECTION
      ) {
        throw new Error(`money movement forbidden in seam test: ${name}`);
      }
      store.touched.push(name);
      if (name === "corporationOperatingModels") {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () => {
              const inCond = (filter.corporationId ?? {}) as { $in?: string[] };
              return store.models.filter(
                (m) => !inCond.$in || inCond.$in.includes(m.corporationId)
              );
            },
          }),
        };
      }
      if (name === CORPORATION_PRODUCTS_COLLECTION) {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () =>
              Array.from(store.products.values()).filter((d) => matches(d, filter)),
          }),
          bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
            for (const op of ops) {
              const { filter, update } = op.updateOne as unknown as {
                filter: Record<string, unknown>;
                update: Record<string, unknown>;
              };
              const doc = store.products.get(String(filter._id));
              if (doc && matches(doc, filter)) applyUpdate(doc, update);
            }
            return { matchedCount: ops.length };
          },
        };
      }
      if (name === "advertisingAgreements") {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () =>
              Array.from(store.agreements.values()).filter((d) => matches(d, filter)),
          }),
          bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
            for (const op of ops) {
              const { filter, update } = op.updateOne as unknown as {
                filter: Record<string, unknown>;
                update: Record<string, unknown>;
              };
              const doc = store.agreements.get(String(filter._id));
              if (doc) applyUpdate(doc, update);
            }
            return { matchedCount: ops.length };
          },
          updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
            let modified = 0;
            for (const doc of store.agreements.values()) {
              if (matches(doc, filter)) {
                applyUpdate(doc, update);
                modified += 1;
              }
            }
            return { matchedCount: modified, modifiedCount: modified };
          },
        };
      }
      return {
        bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
          for (const op of ops) {
            const { filter, update } = op.updateOne as unknown as {
              filter: Record<string, unknown>;
              update: Record<string, unknown>;
            };
            const key = `${String(filter.corporationId)}:${String(filter.turn)}`;
            const existing = store.settlements.get(key) ?? {};
            applyUpdate(existing, update);
            store.settlements.set(key, existing);
          }
          return { matchedCount: ops.length };
        },
      };
    },
  } as unknown as Db;
}

function corp(id: string, overrides: Record<string, unknown> = {}): Corporation {
  return {
    _id: id,
    countryId: "US",
    headquartersState: "US-CA",
    liquidCurrencyCode: "USD",
    liquidCapital: 1_000_000,
    marketingBudget: 4800,
    ...overrides,
  } as unknown as Corporation;
}

const FX = new Map<CurrencyCode, number>([["USD", 1]]);

function activeAgreement(overrides: Record<string, unknown> = {}): AdvertisingAgreement {
  return {
    _id: "ad1",
    buyerCorpId: "buyer",
    supplierCorpId: "supplier",
    allocationShareBps: 10000,
    status: "active",
    startsAtTurn: 90,
    proposedByCorpId: "buyer",
    createdAt: new Date("2026-09-21T00:00:00.000Z"),
    updatedAt: new Date("2026-09-21T00:00:00.000Z"),
    ...overrides,
  };
}

function activeProduct(productId: string, corpId: string): CorporationProductDocument {
  const built = startProductDevelopment({
    enabled: true,
    activeProduct: null,
    draft: {
      id: productId,
      corporationId: corpId,
      kindId: "passenger_car",
      name: "P",
      startedTurn: 90,
    },
  });
  if (!built.ok) throw new Error("fixture draft rejected");
  return toProductDocument(built.product);
}

const CORPS = () =>
  new Map<string, Corporation>([
    ["buyer", corp("buyer")],
    ["supplier", corp("supplier", { marketingBudget: 0 })],
  ]);

async function runSeam(
  store: FakeStore,
  opts: { delivered: number; settled: number; turn?: number }
) {
  const turn = opts.turn ?? 100;
  const db = fakeDb(store);
  const advertising = await processAdvertisingTurn(db, {
    enabled: true,
    turn,
    corpsById: CORPS(),
    sectorsByCorp: new Map(),
    fxByCurrency: FX,
    deliveredAnchorBySellerId: new Map([["supplier", opts.delivered]]),
    settledSpendAnchorByBuyerId: new Map([["buyer", opts.settled]]),
  });
  const products = await processCorporationProductTurn(db, {
    enabled: true,
    turn,
    corpsById: CORPS(),
    fxByCurrency: FX,
    effectiveAdvertisingAnchorByCorpId: advertising.effectiveAnchorByCorpId,
  });
  return { advertising, products };
}

describe("advertising-to-product turn seam", () => {
  it("feeds settlement results (not requested marketingBudget) into product brand", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    store.products.set("p1", activeProduct("p1", "buyer") as unknown as Record<string, unknown>);
    // Requested slice is 4800/24 = 200; the sector pass settled only 100.
    const { advertising } = await runSeam(store, { delivered: 100, settled: 100 });
    expect(advertising.effectiveAnchorByCorpId.get("buyer")).toBe(100);
    const doc = store.products.get("p1")!;
    expect(doc.developmentAdvertisingAnchor).toBe(100);
    expect(doc.lastProcessedTurn).toBe(100);
  });

  it("falls back to the requested slice when no settlement value exists", async () => {
    const store = newStore();
    store.products.set("p1", activeProduct("p1", "buyer") as unknown as Record<string, unknown>);
    const db = fakeDb(store);
    await processCorporationProductTurn(db, {
      enabled: true,
      turn: 100,
      corpsById: CORPS(),
      fxByCurrency: FX,
    });
    expect(store.products.get("p1")!.developmentAdvertisingAnchor).toBe(200);
  });

  it("prefers the effective input in the corp input builder, ignoring hostile values", async () => {
    const buyer = corp("buyer");
    expect(
      buildProductLifecycleCorpInput(buyer, FX, { deliveredAdvertisingAnchor: 100 })
        .deliveredAdvertisingAnchor
    ).toBe(100);
    expect(buildProductLifecycleCorpInput(buyer, FX, {}).deliveredAdvertisingAnchor).toBe(200);
    expect(
      buildProductLifecycleCorpInput(buyer, FX, { deliveredAdvertisingAnchor: NaN })
        .deliveredAdvertisingAnchor
    ).toBe(200);
    expect(
      buildProductLifecycleCorpInput(buyer, FX, { deliveredAdvertisingAnchor: -5 })
        .deliveredAdvertisingAnchor
    ).toBe(200);
  });

  it("treats partial and missing delivery as neutral and moves no money", async () => {
    const store = newStore();
    const buyerBefore = CORPS().get("buyer")!;
    const cashBefore = buyerBefore.liquidCapital;
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    store.products.set("p1", activeProduct("p1", "buyer") as unknown as Record<string, unknown>);
    // Supplier delivered 40 against a 100 claim: neutral beyond delivered claims.
    const { advertising } = await runSeam(store, { delivered: 40, settled: 100 });
    expect(advertising.effectiveAnchorByCorpId.get("buyer")).toBe(100);
    expect(store.products.get("p1")!.developmentAdvertisingAnchor).toBe(100);
    expect(buyerBefore.liquidCapital).toBe(cashBefore);
    // Only advertising + product collections are ever touched: no corp cash movement.
    for (const name of store.touched) {
      expect([
        "advertisingAgreements",
        "advertisingSettlements",
        "corporationOperatingModels",
        CORPORATION_PRODUCTS_COLLECTION,
      ]).toContain(name);
    }

    const empty = newStore();
    empty.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    empty.products.set("p1", activeProduct("p1", "buyer") as unknown as Record<string, unknown>);
    const none = await runSeam(empty, { delivered: 0, settled: 100 });
    expect(none.advertising.effectiveAnchorByCorpId.get("buyer")).toBe(0);
    expect(empty.products.get("p1")!.developmentAdvertisingAnchor).toBe(0);
  });

  it("is replay-safe across both phases", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    store.products.set("p1", activeProduct("p1", "buyer") as unknown as Record<string, unknown>);
    const first = await runSeam(store, { delivered: 100, settled: 100 });
    expect(first.products.advanced).toBe(1);
    const second = await runSeam(store, { delivered: 100, settled: 100 });
    expect(second.advertising.effectiveAnchorByCorpId.get("buyer")).toBe(100);
    expect(second.products.advanced).toBe(0);
    expect(store.products.get("p1")!.developmentAdvertisingAnchor).toBe(100);
    expect(store.settlements.size).toBe(1);
  });

  it("performs zero DB access when the flag is off", async () => {
    const exploding = {
      collection: () => {
        throw new Error("must not touch the database when disabled");
      },
    } as unknown as Db;
    const advertising = await processAdvertisingTurn(exploding, {
      enabled: false,
      turn: 100,
      corpsById: new Map(),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map(),
      settledSpendAnchorByBuyerId: new Map(),
    });
    expect(advertising.enabled).toBe(false);
    const products = await processCorporationProductTurn(exploding, {
      enabled: false,
      turn: 100,
      corpsById: new Map(),
      fxByCurrency: FX,
    });
    expect(products.enabled).toBe(false);
  });
});
