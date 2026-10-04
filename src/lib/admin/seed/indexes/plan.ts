import type { CreateIndexesOptions, Db, IndexSpecification } from "mongodb";
import { seedIndexes } from "../seedIndexes";
import { CORPORATE_SECTOR_IDENTITY_INDEX_KEY, CORPORATE_SECTOR_IDENTITY_INDEX_NAME } from "./core";

/** One index `seedIndexes` creates, as captured without touching a database. */
export type SeedIndexPlanEntry = {
  collection: string;
  key: Record<string, unknown>;
  options: CreateIndexesOptions;
};

/**
 * Every index `seedIndexes` would create, captured by running it against a
 * recording stand-in for the database (#2699).
 *
 * A running world never re-seeds, so an index added to a seed module reaches a
 * live database only through a migration. This plan is the single source for
 * checking a live database against the seed (drift report) and for creating
 * what is missing (reconcile migration). The stand-in answers reads with empty
 * results and reports back the indexes it has recorded, so seed modules that
 * verify their own indexes pass, and modules that repair data find nothing.
 */
export async function collectSeedIndexPlan(): Promise<SeedIndexPlanEntry[]> {
  const plan: SeedIndexPlanEntry[] = [];
  const recorded = (collection: string) => {
    const indexes = plan
      .filter((entry) => entry.collection === collection)
      .map((entry) => ({ v: 2, key: entry.key, name: entry.options.name, ...entry.options }));
    // Model the registered startup migration prerequisite without running data
    // migrations in this recording database. The seeder still records its own
    // ensureIndex call, so the guard remains part of the reconciliation plan.
    if (
      collection === "corporateSectors" &&
      !indexes.some((index) => index.name === CORPORATE_SECTOR_IDENTITY_INDEX_NAME)
    ) {
      indexes.push({
        v: 2,
        key: CORPORATE_SECTOR_IDENTITY_INDEX_KEY,
        name: CORPORATE_SECTOR_IDENTITY_INDEX_NAME,
        unique: true,
      });
    }
    return indexes;
  };
  const emptyCursor = () => {
    const cursor = {
      toArray: async () => [],
      limit: () => cursor,
      project: () => cursor,
      sort: () => cursor,
      skip: () => cursor,
      [Symbol.asyncIterator]: async function* () {},
    };
    return cursor;
  };
  const collection = (name: string) =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "createIndex") {
            return async (key: IndexSpecification, options: CreateIndexesOptions = {}) => {
              plan.push({ collection: name, key: key as Record<string, unknown>, options });
              return options.name ?? JSON.stringify(key);
            };
          }
          if (prop === "createIndexes") {
            return async (
              specs: Array<{ key: Record<string, unknown> } & CreateIndexesOptions>
            ) => {
              for (const { key, ...options } of specs)
                plan.push({ collection: name, key, options });
              return specs.map((s) => s.name ?? JSON.stringify(s.key));
            };
          }
          if (prop === "indexes") return async () => recorded(name);
          if (prop === "listIndexes") return () => ({ toArray: async () => recorded(name) });
          if (prop === "find" || prop === "aggregate") return emptyCursor;
          if (prop === "findOne") return async () => null;
          return async () => ({
            acknowledged: true,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
          });
        },
      }
    );
  const db = {
    collection,
    listCollections: () => ({ toArray: async () => [] }),
    command: async () => ({}),
    createCollection: async () => ({}),
  } as unknown as Db;
  await seedIndexes(db, () => {});
  return plan;
}

export const isTextIndex = (entry: SeedIndexPlanEntry) =>
  Object.values(entry.key).some((direction) => direction === "text");

export const isTtlIndex = (entry: SeedIndexPlanEntry) =>
  typeof entry.options.expireAfterSeconds === "number";

/** Stable identity for comparing a planned index with an existing one. */
export const indexKeySignature = (key: Record<string, unknown>) => JSON.stringify(key);

/** Planned indexes whose key is not present on the live collection. */
export async function findMissingSeedIndexes(
  db: Db,
  plan: SeedIndexPlanEntry[]
): Promise<SeedIndexPlanEntry[]> {
  const byCollection = new Map<string, Set<string>>();
  for (const name of new Set(plan.map((entry) => entry.collection))) {
    const existing = await db
      .collection(name)
      .indexes()
      .catch(() => []);
    byCollection.set(
      name,
      new Set(existing.map((index) => indexKeySignature(index.key as Record<string, unknown>)))
    );
  }
  return plan.filter(
    (entry) => !byCollection.get(entry.collection)?.has(indexKeySignature(entry.key))
  );
}
