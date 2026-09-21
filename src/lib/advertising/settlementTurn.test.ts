/**
 * Turn-shell tests: flag-off neutrality (zero DB access), no-delivery zero
 * efficacy, full-coverage bonus, supplier shortfall, expiry finalization,
 * replay safety, and the no-money-movement guarantee (only advertising
 * collections are ever touched).
 */
import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { AD_MAX_COVERAGE_BONUS } from "./rules/coverage";
import { processAdvertisingTurn } from "./settlementTurn";
import type { AdvertisingAgreement } from "./types";

interface FakeStore {
  agreements: Map<string, Record<string, unknown>>;
  settlements: Map<string, Record<string, unknown>>;
  models: { corporationId: string; operatingModel: string }[];
  touched: string[];
  bulkWrites: { collection: string; count: number }[];
}

function newStore(): FakeStore {
  return { agreements: new Map(), settlements: new Map(), models: [], touched: [], bulkWrites: [] };
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (typeof cond === "object" && cond !== null) {
      const c = cond as Record<string, unknown>;
      if ("$in" in c) return Array.isArray(c.$in) && c.$in.includes(value);
      if ("$lte" in c)
        return typeof value === "number" && typeof c.$lte === "number" && value <= c.$lte;
    }
    return value === cond;
  });
}

function applySet(doc: Record<string, unknown>, update: Record<string, unknown>): void {
  const set = (update.$set ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(set)) doc[key] = value;
}

function fakeDb(store: FakeStore): Db {
  return {
    collection: (name: string) => {
      if (name !== "advertisingAgreements" && name !== "advertisingSettlements") {
        throw new Error(`forbidden collection: ${name}`);
      }
      store.touched.push(name);
      if (name === "advertisingAgreements") {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () =>
              Array.from(store.agreements.values()).filter((d) => matches(d, filter)),
          }),
          bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
            store.bulkWrites.push({ collection: name, count: ops.length });
            for (const op of ops) {
              const { filter, update } = op.updateOne as unknown as {
                filter: Record<string, unknown>;
                update: Record<string, unknown>;
              };
              const doc = store.agreements.get(String(filter._id));
              if (doc) applySet(doc, update);
            }
            return { matchedCount: ops.length };
          },
          updateMany: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
            let modified = 0;
            for (const doc of store.agreements.values()) {
              if (matches(doc, filter)) {
                applySet(doc, update);
                modified += 1;
              }
            }
            return { matchedCount: modified, modifiedCount: modified };
          },
        };
      }
      return {
        bulkWrite: async (ops: { updateOne: { filter: never; update: never } }[]) => {
          store.bulkWrites.push({ collection: name, count: ops.length });
          for (const op of ops) {
            const { filter, update } = op.updateOne as unknown as {
              filter: Record<string, unknown>;
              update: Record<string, unknown>;
            };
            const key = `${String(filter.corporationId)}:${String(filter.turn)}`;
            const existing = store.settlements.get(key) ?? {};
            applySet(existing, update);
            store.settlements.set(key, existing);
          }
          return { matchedCount: ops.length };
        },
      };
    },
  } as unknown as Db & { __models: unknown };
}

function modelsDb(store: FakeStore): Db {
  const db = fakeDb(store);
  const orig = (db as unknown as { collection: (name: string) => unknown }).collection.bind(db);
  return {
    collection: (name: string) => {
      if (name === "corporationOperatingModels") {
        store.touched.push(name);
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
      return orig(name);
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
    marketingBudget: 2400,
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

describe("processAdvertisingTurn", () => {
  it("performs zero DB access when the flag is off", async () => {
    const exploding = {
      collection: () => {
        throw new Error("must not touch the database when disabled");
      },
    } as unknown as Db;
    const result = await processAdvertisingTurn(exploding, {
      enabled: false,
      turn: 100,
      corpsById: new Map(),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map(),
      settledSpendAnchorByBuyerId: new Map(),
    });
    expect(result.enabled).toBe(false);
    expect(result.buyers).toBe(0);
    expect(result.effectiveAnchorByCorpId.size).toBe(0);
  });

  it("writes neutral spot settlements with no agreements and moves no money", async () => {
    const store = newStore();
    const result = await processAdvertisingTurn(modelsDb(store), {
      enabled: true,
      turn: 100,
      corpsById: new Map([["buyer", corp("buyer")]]),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map([["supplier", 100]]),
      settledSpendAnchorByBuyerId: new Map([["buyer", 100]]),
    });
    expect(result.buyers).toBe(1);
    expect(result.effectiveAnchorByCorpId.get("buyer")).toBe(100);
    const doc = store.settlements.get("buyer:100") as Record<string, unknown>;
    expect(doc.settledSpendAnchor).toBe(100);
    expect(doc.contractedSpendAnchor).toBe(0);
    expect(doc.spotSpendAnchor).toBe(100);
    expect(doc.effectiveAdvertisingAnchor).toBe(100);
    // Only advertising collections are ever touched: no corp cash movement.
    expect(store.touched).toEqual(["advertisingAgreements", "advertisingSettlements"]);
  });

  it("yields zero efficacy when nothing was delivered", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    const result = await processAdvertisingTurn(modelsDb(store), {
      enabled: true,
      turn: 100,
      corpsById: new Map([
        ["buyer", corp("buyer")],
        ["supplier", corp("supplier", { marketingBudget: 0 })],
      ]),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map(),
      settledSpendAnchorByBuyerId: new Map(),
    });
    expect(result.effectiveAnchorByCorpId.get("buyer")).toBe(0);
    const doc = store.settlements.get("buyer:100") as Record<string, unknown>;
    expect(doc.effectiveAdvertisingAnchor).toBe(0);
  });

  it("pays bounded coverage efficacy on delivered contracted spend", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    store.models.push({ corporationId: "supplier", operatingModel: "television_network" });
    const sectorsByCorp = new Map<
      string,
      { stateId: string; revenue: number; countryId: string }[]
    >([
      ["buyer", [{ stateId: "US-CA", revenue: 1000, countryId: "US" }]],
      ["supplier", [{ stateId: "US-CA", revenue: 1000, countryId: "US" }]],
    ]);
    const result = await processAdvertisingTurn(modelsDb(store), {
      enabled: true,
      turn: 100,
      corpsById: new Map([
        ["buyer", corp("buyer")],
        ["supplier", corp("supplier", { marketingBudget: 0 })],
      ]),
      sectorsByCorp,
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map([["supplier", 100]]),
      settledSpendAnchorByBuyerId: new Map([["buyer", 100]]),
    });
    const effective = result.effectiveAnchorByCorpId.get("buyer")!;
    expect(effective).toBeGreaterThan(100);
    expect(effective).toBeLessThanOrEqual(100 * (1 + AD_MAX_COVERAGE_BONUS));
    const doc = store.settlements.get("buyer:100") as unknown as {
      lines: { supplierCorpId: string; overlap: number }[];
    };
    expect(doc.lines).toHaveLength(1);
    expect(doc.lines[0].supplierCorpId).toBe("supplier");
    expect(doc.lines[0].overlap).toBeGreaterThan(0);
    // Per-agreement stats are stamped for supplier-side inspection.
    const agreement = store.agreements.get("ad1")!;
    expect(agreement.lastSettlementTurn).toBe(100);
    expect(agreement.lastOverlap).toBe(doc.lines[0].overlap);
  });

  it("treats supplier shortfall as neutral beyond delivered claims", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    const result = await processAdvertisingTurn(modelsDb(store), {
      enabled: true,
      turn: 100,
      corpsById: new Map([
        ["buyer", corp("buyer")],
        ["supplier", corp("supplier", { marketingBudget: 0 })],
      ]),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      // Supplier delivered 40 against a 100 claim: 40 bonused at zero
      // overlap (neutral factor) + 60 neutral + 0 spot.
      deliveredAnchorBySellerId: new Map([["supplier", 40]]),
      settledSpendAnchorByBuyerId: new Map([["buyer", 100]]),
    });
    expect(result.effectiveAnchorByCorpId.get("buyer")).toBe(100);
  });

  it("leaves cash, output, and inventory untouched by itself", async () => {
    const store = newStore();
    store.agreements.set("ad1", activeAgreement() as unknown as Record<string, unknown>);
    store.models.push({ corporationId: "supplier", operatingModel: "television_network" });
    const buyer = corp("buyer", { liquidCapital: 1_000_000, marketingBudget: 2400 });
    const supplier = corp("supplier", { liquidCapital: 500_000, marketingBudget: 0 });
    const sectorsByCorp = new Map<
      string,
      { stateId: string; revenue: number; countryId: string }[]
    >([
      ["buyer", [{ stateId: "US-CA", revenue: 1000, countryId: "US" }]],
      ["supplier", [{ stateId: "US-CA", revenue: 1000, countryId: "US" }]],
    ]);
    const before = JSON.stringify({
      buyer,
      supplier,
      sectors: [...sectorsByCorp],
    });
    await processAdvertisingTurn(modelsDb(store), {
      enabled: true,
      turn: 100,
      corpsById: new Map([
        ["buyer", buyer],
        ["supplier", supplier],
      ]),
      sectorsByCorp,
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map([["supplier", 100]]),
      settledSpendAnchorByBuyerId: new Map([["buyer", 100]]),
    });
    // The phase attributes already-settled spend only: corp cash, sector
    // output, and inventory read back byte-identical.
    expect(JSON.stringify({ buyer, supplier, sectors: [...sectorsByCorp] })).toBe(before);
    expect((buyer as unknown as Record<string, unknown>).liquidCapital).toBe(1_000_000);
    expect((supplier as unknown as Record<string, unknown>).liquidCapital).toBe(500_000);
    for (const name of store.touched) {
      expect([
        "advertisingAgreements",
        "advertisingSettlements",
        "corporationOperatingModels",
      ]).toContain(name);
    }
  });

  it("finalizes expiry and is replay-safe", async () => {
    const store = newStore();
    store.agreements.set(
      "ad1",
      activeAgreement({ expiresAtTurn: 100 }) as unknown as Record<string, unknown>
    );
    const args = {
      enabled: true,
      turn: 100,
      corpsById: new Map([["buyer", corp("buyer", { marketingBudget: 0 })]]),
      sectorsByCorp: new Map(),
      fxByCurrency: FX,
      deliveredAnchorBySellerId: new Map(),
      settledSpendAnchorByBuyerId: new Map(),
    } as const;
    const first = await processAdvertisingTurn(modelsDb(store), {
      ...args,
      corpsById: new Map(args.corpsById),
    });
    expect(first.finalized).toBe(1);
    expect(store.agreements.get("ad1")!.status).toBe("expired");
    const second = await processAdvertisingTurn(modelsDb(store), {
      ...args,
      corpsById: new Map(args.corpsById),
    });
    expect(second.finalized).toBe(0);
    expect(second.agreementsSettling).toBe(0);
  });
});
