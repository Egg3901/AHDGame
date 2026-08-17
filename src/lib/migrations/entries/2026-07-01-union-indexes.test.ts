import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-07-01-union-indexes";

function mockDb(dropBehaviour: "ok" | "missing" = "ok") {
  const createIndex = vi.fn().mockResolvedValue("unions_country_sectorType_seeded_unique");
  const dropIndex =
    dropBehaviour === "ok"
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error("index not found with name [x]"));
  const db = { collection: () => ({ createIndex, dropIndex }) } as unknown as Db;
  return { db, createIndex, dropIndex };
}

describe("2026-07-01-union-indexes migration", () => {
  it("creates a PARTIAL unique index scoped to seeded unions", async () => {
    const { db, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(1);
    const [keys, options] = createIndex.mock.calls[0];
    expect(keys).toEqual({ countryId: 1, sectorType: 1 });
    expect(options).toMatchObject({
      name: "unions_country_sectorType_seeded_unique",
      unique: true,
      // Founded rivals are excluded, so any number may share an industry while
      // the lazy-upsert race on seeded unions stays guarded.
      partialFilterExpression: { foundedByCharacterId: { $exists: false } },
    });
  });

  it("drops the old outright-unique index first, so a rival union can be founded", async () => {
    const { db, createIndex, dropIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(dropIndex).toHaveBeenCalledWith("unions_country_sectorType_unique");
    // Order matters: creating the partial index while the outright unique one
    // still exists would leave founding broken.
    expect(dropIndex.mock.invocationCallOrder[0]).toBeLessThan(
      createIndex.mock.invocationCallOrder[0]
    );
  });

  it("still creates the index when the old one was never there", async () => {
    const { db, createIndex } = mockDb("missing");
    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(1);
    expect(result.notes.some((n) => n.includes("not present"))).toBe(true);
  });

  it("does not touch the database in dry-run mode", async () => {
    const { db, createIndex, dropIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(dropIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("is marked idempotent (drop-if-present then createIndex is a safe re-run)", () => {
    expect(migration.idempotent).toBe(true);
  });
});
