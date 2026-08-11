import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

function makeDb(collectionOverrides: Record<string, unknown>): Db {
  return {
    collection: () => collectionOverrides,
  } as unknown as Db;
}

describe("ensureIndex", () => {
  it("logs success on a clean createIndex", async () => {
    const log = vi.fn();
    const createIndex = vi.fn().mockResolvedValue("idx_name");
    const db = makeDb({ createIndex });

    await ensureIndex(db, "widgets", { a: 1 }, { name: "idx_a" }, log);

    expect(createIndex).toHaveBeenCalledWith({ a: 1 }, { name: "idx_a" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("✓ widgets.idx_a"));
  });

  it("tolerates 'already exists' without calling indexes()", async () => {
    const log = vi.fn();
    const createIndex = vi.fn().mockRejectedValue(new Error("index already exists"));
    const indexes = vi.fn();
    const db = makeDb({ createIndex, indexes });

    await ensureIndex(db, "widgets", { a: 1 }, { name: "idx_a" }, log);

    expect(indexes).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("already exists"));
  });

  it("does not crash when .indexes() throws 'ns does not exist' — falls through to a warning instead", async () => {
    // Regression: a transient race during bootstrap (this collection hasn't
    // been written to yet by another seed step) used to propagate this throw
    // uncaught and crash the entire seedIndexes pass over a single index.
    const log = vi.fn();
    const createIndex = vi.fn().mockRejectedValue(new Error("some other index error"));
    const indexes = vi.fn().mockRejectedValue(new Error("ns does not exist: db.widgets"));
    const db = makeDb({ createIndex, indexes });

    await expect(
      ensureIndex(db, "widgets", { a: 1 }, { name: "idx_a" }, log)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(expect.stringContaining("✗ widgets.idx_a"));
  });

  it("reconciles an existing index found under a different name", async () => {
    const log = vi.fn();
    const createIndex = vi.fn().mockRejectedValue(new Error("some conflict"));
    const indexes = vi
      .fn()
      .mockResolvedValue([{ name: "legacy_name", key: { a: 1 }, unique: false }]);
    const db = makeDb({ createIndex, indexes });

    await ensureIndex(db, "widgets", { a: 1 }, { name: "idx_a" }, log);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("already exists under different name")
    );
  });

  it("drops and recreates on an IndexOptionsConflict (code 86)", async () => {
    const log = vi.fn();
    const createIndex = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("IndexOptionsConflict"), { code: 86 }))
      .mockResolvedValueOnce("idx_a");
    // Uniqueness mismatch (existing: unique, requested: non-unique) is what
    // actually triggers an IndexOptionsConflict — a same-uniqueness match
    // would short-circuit into the "already exists" branch above instead.
    const indexes = vi.fn().mockResolvedValue([{ name: "idx_a", key: { a: 1 }, unique: true }]);
    const dropIndex = vi.fn().mockResolvedValue(undefined);
    const db = makeDb({ createIndex, indexes, dropIndex });

    await ensureIndex(db, "widgets", { a: 1 }, { name: "idx_a", unique: false }, log);

    expect(dropIndex).toHaveBeenCalledWith("idx_a");
    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("recreated with updated options"));
  });
});
