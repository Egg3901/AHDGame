import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-07-01-union-indexes";

function mockDb(dropBehaviour: "ok" | "missing" | "fails" = "ok") {
  const createIndex = vi.fn().mockResolvedValue("unions_country_sectorType_seeded_unique");
  const dropIndex =
    dropBehaviour === "ok"
      ? vi.fn().mockResolvedValue(undefined)
      : dropBehaviour === "missing"
        ? vi.fn().mockRejectedValue(
            Object.assign(new Error("index not found with name [x]"), {
              code: 27,
              codeName: "IndexNotFound",
            })
          )
        : vi.fn().mockRejectedValue(Object.assign(new Error("not authorized"), { code: 13 }));
  const updateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });
  const countDocuments = vi.fn().mockResolvedValue(3);
  const db = {
    collection: () => ({ createIndex, dropIndex, updateMany, countDocuments }),
  } as unknown as Db;
  return { db, createIndex, dropIndex, updateMany, countDocuments };
}

describe("2026-07-01-union-indexes migration", () => {
  it("backfills an explicit founder null before building the partial index", async () => {
    const { db, updateMany, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    // The partial filter only covers documents that carry the field, so the
    // backfill has to land first or the guard silently covers nothing.
    expect(updateMany).toHaveBeenCalledWith(
      { foundedByCharacterId: { $exists: false } },
      { $set: { foundedByCharacterId: null } }
    );
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      createIndex.mock.invocationCallOrder[0]
    );
  });

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
      // A partial index cannot test for an absent field, so seeded unions carry
      // an explicit null and the filter matches on its type.
      partialFilterExpression: { foundedByCharacterId: { $type: "null" } },
    });
  });

  it("drops the old outright-unique index, so a rival union can be founded", async () => {
    const { db, createIndex, dropIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(dropIndex).toHaveBeenCalledWith("unions_country_sectorType_unique");
    // Order matters: the new partial index is built BEFORE the legacy guard is
    // dropped, so a failed build (e.g. E11000 on a world with duplicate seeded
    // docs) aborts with the old protection still standing.
    expect(createIndex.mock.invocationCallOrder[0]).toBeLessThan(
      dropIndex.mock.invocationCallOrder[0]
    );
  });

  it("still creates the index when the old one was never there", async () => {
    const { db, createIndex } = mockDb("missing");
    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(1);
    expect(result.notes?.some((n) => n.includes("not present"))).toBe(true);
  });

  it("fails loudly when the drop fails for any reason other than IndexNotFound", async () => {
    // Swallowing e.g. a permissions error would leave the legacy outright
    // unique index in place, silently blocking founding while the migration
    // reported success.
    const { db } = mockDb("fails");
    await expect(migration.execute(db, { dryRun: false })).rejects.toThrow("not authorized");
  });

  it("does not touch the database in dry-run mode", async () => {
    const { db, createIndex, dropIndex, updateMany } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(dropIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("is marked idempotent (create then drop-if-present is a safe re-run)", () => {
    expect(migration.idempotent).toBe(true);
  });
});
