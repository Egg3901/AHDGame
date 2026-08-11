/**
 * Shared mock database factory for integration tests.
 *
 * Usage in a test file:
 *
 *   import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
 *
 *   vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
 *
 *   let db: MockDb;
 *   beforeEach(async () => {
 *     db = createMockDb();
 *     const { getDb } = await import("@/lib/mongodb");
 *     vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
 *   });
 *
 * Each collection returned by `db.collection(name)` has all common MongoDB
 * collection methods pre-mocked with `vi.fn()`. Override specific methods
 * per test to control return values.
 */

import { vi } from "vitest";
import type { Mock } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMockFn = Mock<(...args: any[]) => any>;

/** A minimal mock of a MongoDB Collection with common CRUD methods. */
export interface MockCollection {
  findOne: AnyMockFn;
  find: AnyMockFn;
  findOneAndUpdate: AnyMockFn;
  findOneAndDelete: AnyMockFn;
  insertOne: AnyMockFn;
  insertMany: AnyMockFn;
  updateOne: AnyMockFn;
  updateMany: AnyMockFn;
  replaceOne: AnyMockFn;
  deleteOne: AnyMockFn;
  deleteMany: AnyMockFn;
  drop: AnyMockFn;
  countDocuments: AnyMockFn;
  distinct: AnyMockFn;
  aggregate: AnyMockFn;
  bulkWrite: AnyMockFn;
  createIndex: AnyMockFn;
}

/** A minimal mock of a MongoDB Db instance. */
export interface MockDb {
  collection: AnyMockFn;
  /** Access a specific collection mock by name for assertions. */
  collectionMocks: Record<string, MockCollection>;
}

function createMockCollection(): MockCollection {
  const cursor = {
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    batchSize: vi.fn().mockReturnThis(),
    // `find().sort().limit(1).next()` is the idiomatic "fetch the single most
    // recent doc" call and route code uses it. Without `next` the chain threw
    // "next is not a function", which surfaced as a 500 rather than as an
    // obviously-missing mock. Delegates to toArray() so a per-test toArray
    // override drives it, same as the async iterator.
    next: vi.fn().mockImplementation(async () => {
      const docs: unknown[] = await cursor.toArray();
      return docs.length > 0 ? docs[0] : null;
    }),
    // Real FindCursors are async iterable (`for await (const doc of cursor)`).
    // Delegate to toArray() so per-test toArray overrides drive iteration too.
    async *[Symbol.asyncIterator]() {
      const docs: unknown[] = await cursor.toArray();
      for (const doc of docs) {
        yield doc;
      }
    },
  };

  const aggregateCursor = {
    toArray: vi.fn().mockResolvedValue([]),
    async *[Symbol.asyncIterator]() {
      const docs: unknown[] = await aggregateCursor.toArray();
      for (const doc of docs) {
        yield doc;
      }
    },
  };

  return {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue(cursor),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    findOneAndDelete: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: "507f1f77bcf86cd799439011" }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    replaceOne: vi.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1, upsertedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    drop: vi.fn().mockResolvedValue(true),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    aggregate: vi.fn().mockReturnValue(aggregateCursor),
    // `upsertedCount`/`upsertedIds` are part of the real BulkWriteResult, and
    // seeders that batch their upserts read `upsertedCount` to report how many
    // docs they created. Omitting it made those read `undefined` and log 0.
    bulkWrite: vi.fn().mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
      upsertedCount: 0,
      upsertedIds: {},
      insertedCount: 0,
      deletedCount: 0,
    }),
    createIndex: vi.fn().mockResolvedValue("index-name"),
  };
}

/**
 * Create a fresh mock Db for each test.
 * Collections are lazily created on first access and cached so repeated
 * calls to `db.collection("same-name")` return the same mock.
 */
export function createMockDb(): MockDb {
  const collectionMocks: Record<string, MockCollection> = {};

  const db: MockDb = {
    collectionMocks,
    collection: vi.fn().mockImplementation((name: string) => {
      if (!collectionMocks[name]) {
        collectionMocks[name] = createMockCollection();
      }
      return collectionMocks[name];
    }),
  };

  return db;
}

/**
 * Mock find() cursor that supports chaining (batchSize/project/sort/limit) and
 * `for await` iteration, yielding the given documents. Use for code that
 * streams a collection instead of calling toArray().
 */
export function createAsyncIterableCursor<T>(docs: T[]) {
  const cursor = {
    batchSize: vi.fn(),
    project: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    toArray: vi.fn().mockResolvedValue(docs),
    // Real cursors expose next(); routes that take only the first row use
    // find().sort().limit(1).next() rather than toArray(). Reads from the head
    // of the same docs array so it stays consistent with toArray().
    next: vi.fn().mockResolvedValue(docs[0] ?? null),
    async *[Symbol.asyncIterator]() {
      for (const doc of docs) {
        yield doc;
      }
    },
  };
  cursor.batchSize.mockReturnValue(cursor);
  cursor.project.mockReturnValue(cursor);
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return cursor;
}

// ── Assertion Helpers ─────────────────────────────────────────────────────────

/**
 * Flatten every `updateOne`/`replaceOne` op recorded across a mock's
 * `bulkWrite` calls into `[filter, update]` pairs — the same shape
 * `updateOne.mock.calls` has, so a batched seeder can be asserted the way a
 * sequential one was.
 *
 * Deliberately NOT a `bulkWrite` that dispatches into the `updateOne` mock:
 * that would keep old assertions green without anyone reading them, and a
 * "was not called" assertion against `updateOne` would then pass for a seeder
 * that writes through `bulkWrite`. Assert on what the code actually calls.
 *
 * Usage:
 *   const ops = bulkOps(db.collectionMocks.unownedSectors.bulkWrite);
 *   expect(ops[0][1].$set.revenue).toBeGreaterThan(0);
 */
export function bulkOps(
  mockFn: AnyMockFn
): Array<[Record<string, unknown>, Record<string, unknown>]> {
  const out: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  for (const call of mockFn.mock.calls as unknown[][]) {
    for (const op of (call[0] ?? []) as Array<Record<string, never>>) {
      const one = (op.updateOne ?? op.replaceOne) as
        | {
            filter: Record<string, unknown>;
            update?: Record<string, unknown>;
            replacement?: Record<string, unknown>;
          }
        | undefined;
      if (!one) continue;
      out.push([one.filter, (one.update ?? one.replacement) as Record<string, unknown>]);
    }
  }
  return out;
}

/**
 * Assert that a mock collection's method was called with a filter
 * matching the given partial object.
 *
 * Usage:
 *   assertCalledWithFilter(db.collectionMocks["bills"]!.updateOne, { _id: billId });
 */
export function assertCalledWithFilter(
  mockFn: AnyMockFn,
  expectedFilter: Record<string, unknown>
): void {
  const calls = mockFn.mock.calls;
  const match = calls.some((call: unknown[]) => {
    const filter = call[0] as Record<string, unknown>;
    return Object.entries(expectedFilter).every(
      ([key, val]) => JSON.stringify(filter[key]) === JSON.stringify(val)
    );
  });
  if (!match) {
    const actualFilters = calls.map((c: unknown[]) => c[0]);
    throw new Error(
      `Expected mock to be called with filter matching ${JSON.stringify(expectedFilter)}, ` +
        `but was called with: ${JSON.stringify(actualFilters)}`
    );
  }
}

/**
 * Assert that a mock collection's updateOne/updateMany was called
 * with a $set containing the given partial fields.
 *
 * Usage:
 *   assertSetFields(db.collectionMocks["bills"]!.updateOne, { status: "failed" });
 */
export function assertSetFields(mockFn: AnyMockFn, expectedFields: Record<string, unknown>): void {
  const calls = mockFn.mock.calls;
  const match = calls.some((call: unknown[]) => {
    const update = call[1] as { $set?: Record<string, unknown> };
    if (!update?.$set) return false;
    return Object.entries(expectedFields).every(
      ([key, val]) => JSON.stringify(update.$set![key]) === JSON.stringify(val)
    );
  });
  if (!match) {
    const actualSets = calls
      .map((c: unknown[]) => (c[1] as { $set?: unknown })?.$set)
      .filter(Boolean);
    throw new Error(
      `Expected mock to be called with $set containing ${JSON.stringify(expectedFields)}, ` +
        `but $set values were: ${JSON.stringify(actualSets)}`
    );
  }
}

/**
 * Get all collection names that were accessed during the test.
 * Useful for verifying a function only touches expected collections.
 *
 * Usage:
 *   const accessed = getAccessedCollections(db);
 *   expect(accessed).toContain("bills");
 *   expect(accessed).not.toContain("users");
 */
export function getAccessedCollections(db: MockDb): string[] {
  return Object.keys(db.collectionMocks);
}
