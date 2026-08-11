import type { Db, CreateIndexesOptions, IndexSpecification } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";

function matchesKey(
  left: IndexSpecification | undefined,
  right: IndexSpecification | undefined
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function isUniqueIndex(options: CreateIndexesOptions | undefined): boolean {
  return !!options?.unique;
}

export async function ensureIndex(
  db: Db,
  collection: string,
  key: IndexSpecification,
  options: CreateIndexesOptions,
  log: (msg: string) => void
) {
  const name = options.name ?? JSON.stringify(key);
  try {
    await db.collection(collection).createIndex(key, options);
    log(`  ✓ ${collection}.${name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("already exists")) {
      log(`  = ${collection}.${name} (already exists)`);
      return;
    }

    // The collection may not exist yet (racing another seed step during
    // bootstrap) — createIndex normally auto-creates it, but a transient
    // failure can leave it absent, and `.indexes()` (listIndexes) throws "ns
    // does not exist" rather than returning an empty list in that case. That
    // throw used to propagate uncaught here and crash the entire seed pass
    // over a single index (seen intermittently on indexFunds/currencyOrders
    // during headless sim bootstrap). Treat it the same as "no existing
    // index found" — falls through to the tolerant logWarning path below.
    const indexes = await db
      .collection(collection)
      .indexes()
      .catch(() => []);
    const existingIndex = indexes.find((index) =>
      matchesKey(index.key as IndexSpecification | undefined, key)
    );

    if (existingIndex && isUniqueIndex(options) === !!existingIndex.unique) {
      log(`  = ${collection}.${existingIndex.name ?? name} (already exists under different name)`);
      return;
    }

    const code = (error as { code?: number }).code;
    if (code === 86 || msg.includes("IndexOptionsConflict")) {
      if (existingIndex?.name) {
        await db.collection(collection).dropIndex(existingIndex.name);
        await db.collection(collection).createIndex(key, options);
        log(`  ~ ${collection}.${name} (recreated with updated options)`);
        return;
      }
    }

    logWarning("Index creation failed", {
      component: "SeedIndexes",
      action: "createIndex",
      metadata: { collection, name, error: msg },
    });
    log(`  ✗ ${collection}.${name}: ${msg}`);
  }
}
