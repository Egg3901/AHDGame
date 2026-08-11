import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-07-01-union-indexes";

function mockDb() {
  const createIndex = vi.fn().mockResolvedValue("unions_country_sectorType_unique");
  const db = { collection: () => ({ createIndex }) } as unknown as Db;
  return { db, createIndex };
}

describe("2026-07-01-union-indexes migration", () => {
  it("creates a unique compound index on (countryId, sectorType) for the unions collection", async () => {
    const { db, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(1);
    const [keys, options] = createIndex.mock.calls[0];
    expect(keys).toEqual({ countryId: 1, sectorType: 1 });
    expect(options).toMatchObject({ name: "unions_country_sectorType_unique", unique: true });
  });

  it("does not touch the database in dry-run mode", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
  });

  it("is marked idempotent (createIndex with a stable name is a safe re-run)", () => {
    expect(migration.idempotent).toBe(true);
  });
});
