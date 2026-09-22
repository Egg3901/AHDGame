import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import {
  ACTIVE_PRODUCT_INDEX_NAME,
  OPERATING_MODEL_INDEX_NAME,
  addOperatingModelPersistent,
  ensureCorporationProductIndexes,
  getActiveProduct,
  listOperatingModels,
  retireProductPersistent,
  startProductPersistent,
} from "./persistence";
import type { ProductDraft } from "./types";

interface FakeCollection {
  docs: Map<string, Record<string, unknown>>;
  createdIndexes: { key: unknown; options: unknown }[];
  enforceSlot: boolean;
}

function duplicateKey(index: string, keyPattern: Record<string, unknown>): Error {
  return Object.assign(
    new Error(
      `E11000 duplicate key error collection: test.corporationProducts index: ${index} dup key`
    ),
    { code: 11000, keyPattern }
  );
}

function fakeDb(opts?: { explodeOnUse?: boolean }): {
  db: Db;
  products: FakeCollection;
  models: FakeCollection;
} {
  const products: FakeCollection = { docs: new Map(), createdIndexes: [], enforceSlot: true };
  const models: FakeCollection = { docs: new Map(), createdIndexes: [], enforceSlot: false };

  function collectionFor(table: FakeCollection, name: string) {
    const matches = (doc: Record<string, unknown>, filter: Record<string, unknown>) =>
      Object.entries(filter).every(([key, expected]) => {
        if (typeof expected === "object" && expected !== null && "$exists" in expected) {
          return key in doc === Boolean((expected as { $exists: unknown }).$exists);
        }
        return doc[key] === expected;
      });
    return {
      createIndex: async (key: unknown, options: unknown) => {
        table.createdIndexes.push({ key, options });
        return name;
      },
      insertOne: async (doc: Record<string, unknown>) => {
        const id = String(doc._id);
        if (table.docs.has(id)) throw duplicateKey("_id_", { _id: 1 });
        if (table.enforceSlot && typeof doc.activeCorporationId === "string") {
          for (const existing of table.docs.values()) {
            if (existing.activeCorporationId === doc.activeCorporationId) {
              throw duplicateKey(ACTIVE_PRODUCT_INDEX_NAME, { activeCorporationId: 1 });
            }
          }
        }
        if (!table.enforceSlot) {
          for (const existing of table.docs.values()) {
            if (
              existing.corporationId === doc.corporationId &&
              existing.operatingModel === doc.operatingModel
            ) {
              throw duplicateKey(OPERATING_MODEL_INDEX_NAME, {
                corporationId: 1,
                operatingModel: 1,
              });
            }
          }
        }
        table.docs.set(id, { ...doc });
        return { acknowledged: true, insertedId: doc._id };
      },
      findOne: async (filter: Record<string, unknown> = {}) => {
        for (const doc of table.docs.values()) {
          if (matches(doc, filter)) return { ...doc };
        }
        return null;
      },
      updateOne: async (
        filter: Record<string, unknown>,
        update: Record<string, Record<string, unknown>>
      ) => {
        for (const [id, doc] of table.docs) {
          if (!matches(doc, filter)) continue;
          const next = { ...doc, ...(update.$set ?? {}) };
          for (const k of Object.keys(update.$unset ?? {})) delete next[k];
          table.docs.set(id, next);
          return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      },
      find: (filter: Record<string, unknown> = {}) => ({
        toArray: async () =>
          [...table.docs.values()].filter((doc) =>
            Object.entries(filter).every(([k, v]) => doc[k] === v)
          ),
      }),
    };
  }

  const db = {
    collection: (name: string) => {
      if (opts?.explodeOnUse) throw new Error(`db must not be touched (collection ${name})`);
      if (name === "corporationProducts") return collectionFor(products, name);
      if (name === "corporationOperatingModels") return collectionFor(models, name);
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, products, models };
}

function draft(overrides: Partial<ProductDraft> = {}): ProductDraft {
  return {
    id: "product-1",
    corporationId: "corp-1",
    kindId: "passenger_car",
    name: "Model One",
    startedTurn: 100,
    ...overrides,
  };
}

describe("product persistence flag gating", () => {
  it("writes nothing when the flag is false or unset", async () => {
    for (const enabled of [false, Boolean(undefined)]) {
      const { db, products, models } = fakeDb({ explodeOnUse: true });
      expect(await startProductPersistent(db, { enabled, draft: draft() })).toEqual({
        ok: false,
        reason: "feature_disabled",
      });
      expect(
        await addOperatingModelPersistent(db, {
          enabled,
          corporationId: "corp-1",
          operatingModel: "newspaper",
          turn: 100,
        })
      ).toEqual({ ok: false, reason: "feature_disabled" });
      expect(products.docs.size).toBe(0);
      expect(models.docs.size).toBe(0);
    }
  });

  it("writes nothing for unknown kinds or models", async () => {
    const { db, products, models } = fakeDb();
    expect(
      await startProductPersistent(db, {
        enabled: true,
        draft: draft({ kindId: "bus" }),
      })
    ).toEqual({ ok: false, reason: "unknown_product_kind" });
    expect(
      await addOperatingModelPersistent(db, {
        enabled: true,
        corporationId: "corp-1",
        operatingModel: "printing_press",
        turn: 100,
      })
    ).toEqual({ ok: false, reason: "unknown_operating_model" });
    expect(products.docs.size).toBe(0);
    expect(models.docs.size).toBe(0);
  });
});

describe("operating models", () => {
  it("lets one corporation own multiple media operating models", async () => {
    const { db } = fakeDb();
    for (const operatingModel of ["newspaper", "television_network", "radio_network"]) {
      const result = await addOperatingModelPersistent(db, {
        enabled: true,
        corporationId: "corp-1",
        operatingModel,
        turn: 100,
      });
      expect(result.ok).toBe(true);
    }
    const owned = await listOperatingModels(db, "corp-1");
    expect(owned.map((m) => m.operatingModel).sort()).toEqual([
      "newspaper",
      "radio_network",
      "television_network",
    ]);
    expect(await listOperatingModels(db, "corp-2")).toEqual([]);
  });
});

describe("one active product per corporation", () => {
  it("rejects a second non-retired product for the same corporation", async () => {
    const { db, products } = fakeDb();
    expect((await startProductPersistent(db, { enabled: true, draft: draft() })).ok).toBe(true);
    expect(
      await startProductPersistent(db, {
        enabled: true,
        draft: draft({ id: "product-2", kindId: "truck", name: "Model Two" }),
      })
    ).toEqual({ ok: false, reason: "active_product" });
    expect(products.docs.size).toBe(1);
    expect(await getActiveProduct(db, "corp-1")).toMatchObject({ _id: "product-1" });
  });

  it("allows different corporations to each hold one active product", async () => {
    const { db } = fakeDb();
    expect((await startProductPersistent(db, { enabled: true, draft: draft() })).ok).toBe(true);
    expect(
      (
        await startProductPersistent(db, {
          enabled: true,
          draft: draft({ id: "product-2", corporationId: "corp-2" }),
        })
      ).ok
    ).toBe(true);
  });

  it("frees the slot on retirement so a new product can start", async () => {
    const { db } = fakeDb();
    expect((await startProductPersistent(db, { enabled: true, draft: draft() })).ok).toBe(true);
    const retired = await retireProductPersistent(db, { productId: "product-1", turn: 120 });
    expect(retired.ok).toBe(true);
    if (retired.ok) {
      expect(retired.product.stage).toBe("retired");
      expect(retired.product.activeCorporationId).toBeUndefined();
    }
    expect(await getActiveProduct(db, "corp-1")).toBeNull();
    expect(
      (
        await startProductPersistent(db, {
          enabled: true,
          draft: draft({ id: "product-2", kindId: "truck", name: "Model Two" }),
        })
      ).ok
    ).toBe(true);
  });

  it("reports not_found and already_retired without writes", async () => {
    const { db } = fakeDb();
    expect(await retireProductPersistent(db, { productId: "missing", turn: 120 })).toEqual({
      ok: false,
      reason: "not_found",
    });
    await startProductPersistent(db, { enabled: true, draft: draft() });
    await retireProductPersistent(db, { productId: "product-1", turn: 120 });
    expect(await retireProductPersistent(db, { productId: "product-1", turn: 121 })).toEqual({
      ok: false,
      reason: "already_retired",
    });
  });

  it("lets only one concurrent retirement free the active slot", async () => {
    const { db } = fakeDb();
    await startProductPersistent(db, { enabled: true, draft: draft() });

    const results = await Promise.all([
      retireProductPersistent(db, { productId: "product-1", turn: 120 }),
      retireProductPersistent(db, { productId: "product-1", turn: 121 }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "already_retired" },
    ]);
  });
});

describe("retry and idempotency", () => {
  it("treats a same-draft retry as an idempotent success with one stored doc", async () => {
    const { db, products } = fakeDb();
    expect((await startProductPersistent(db, { enabled: true, draft: draft() })).ok).toBe(true);
    const retry = await startProductPersistent(db, { enabled: true, draft: draft() });
    expect(retry).toMatchObject({ ok: true, idempotent: true });
    expect(products.docs.size).toBe(1);
  });

  it("treats re-adding an owned operating model as idempotent", async () => {
    const { db, models } = fakeDb();
    const args = {
      enabled: true,
      corporationId: "corp-1",
      operatingModel: "newspaper",
      turn: 100,
    };
    expect((await addOperatingModelPersistent(db, args)).ok).toBe(true);
    const retry = await addOperatingModelPersistent(db, args);
    expect(retry).toMatchObject({ ok: true, idempotent: true });
    expect(models.docs.size).toBe(1);
  });
});

describe("index enforcement", () => {
  it("creates unique standalone-safe indexes for the slot and operating models", async () => {
    const { db, products, models } = fakeDb();
    await expect(ensureCorporationProductIndexes(db)).resolves.toEqual([
      ACTIVE_PRODUCT_INDEX_NAME,
      OPERATING_MODEL_INDEX_NAME,
    ]);
    expect(products.createdIndexes).toEqual([
      {
        key: { activeCorporationId: 1 },
        options: {
          name: ACTIVE_PRODUCT_INDEX_NAME,
          unique: true,
          partialFilterExpression: { activeCorporationId: { $exists: true } },
        },
      },
    ]);
    expect(models.createdIndexes).toEqual([
      {
        key: { corporationId: 1, operatingModel: 1 },
        options: { name: OPERATING_MODEL_INDEX_NAME, unique: true },
      },
    ]);
  });
});
