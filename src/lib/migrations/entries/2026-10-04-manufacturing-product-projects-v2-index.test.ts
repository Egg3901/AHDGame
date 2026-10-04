import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-10-04-manufacturing-product-projects-v2-index";

describe("manufacturing product projects v2 index migration", () => {
  it("creates the unique active project index on apply", async () => {
    const createIndex = vi.fn().mockResolvedValue("created");
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collection).toHaveBeenCalledWith("manufacturingProductProjectsV2");
    expect(createIndex).toHaveBeenCalledWith(
      { activeCorporationId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { activeCorporationId: { $exists: true } },
      })
    );
    expect(result.documentsUpdated).toBe(0);
  });

  it("does not write on a dry run", async () => {
    const createIndex = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ createIndex }) };

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain("Would create");
  });
});
