import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-10-05-advertising-agreement-indexes";

describe("advertising agreement indexes", () => {
  it("creates the agreement and settlement indexes", async () => {
    const createIndex = vi.fn().mockResolvedValue("created");
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };
    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collection).toHaveBeenCalledWith("advertisingAgreements");
    expect(db.collection).toHaveBeenCalledWith("advertisingSettlements");
    expect(createIndex).toHaveBeenCalledTimes(3);
    expect(result.documentsUpdated).toBe(0);
  });

  it("is a no-op on dry run", async () => {
    const createIndex = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };
    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain("Would create");
  });
});
