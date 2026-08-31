import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-31-intelligence-indexes";

function mockDb() {
  const createIndex = vi.fn().mockResolvedValue("ok");
  const collection = vi.fn(() => ({ createIndex }));
  const db = { collection } as unknown as Db;
  return { db, createIndex, collection };
}

describe("2026-08-31-intelligence-indexes migration", () => {
  it("creates every planned index", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(5);
    expect(result.documentsUpdated).toBe(5);
    expect(result.notes.every((n) => n.startsWith("created/verified"))).toBe(true);
  });

  it("guards the three invariants the read paths assume, as UNIQUE", async () => {
    // Agencies, networks, and coverage are read as at most one row per key
    // rather than re-checked, so a live world without these can accumulate
    // duplicates the code then picks between at random.
    const { db, createIndex } = mockDb();
    await migration.execute(db, { dryRun: false });

    const unique = createIndex.mock.calls
      .filter((call) => (call[1] as { unique?: boolean }).unique === true)
      .map((call) => (call[1] as { name: string }).name);

    expect(unique).toEqual([
      "intelligenceAgencies_countryId",
      "intelligenceNetworks_owner_target",
      "intelligenceCoverage_owner_target_domain",
    ]);
  });

  it("targets each intelligence collection by name", async () => {
    const { db, collection } = mockDb();
    await migration.execute(db, { dryRun: false });

    expect(collection.mock.calls.map((c) => c[0])).toEqual([
      "intelligenceAgencies",
      "intelligenceNetworks",
      "intelligenceCoverage",
      "intelligenceOpLog",
      "intelligenceOpLog",
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.documentsUpdated).toBe(0);
    expect(result.notes.every((n) => n.startsWith("would create"))).toBe(true);
  });

  it("is declared idempotent, since createIndex on an identical index is a no-op", () => {
    expect(migration.idempotent).toBe(true);
  });
});
