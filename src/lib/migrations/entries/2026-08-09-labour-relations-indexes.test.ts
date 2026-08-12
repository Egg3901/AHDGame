import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-09-labour-relations-indexes";

describe("2026-08-09-labour-relations-indexes migration", () => {
  it("creates the campaign uniqueness guard and agreement read indexes", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(10);
    expect(createIndex).toHaveBeenCalledWith(
      { unionId: 1, employerCorporationId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { status: { $in: ["negotiating", "dispute"] } },
      })
    );
    expect(result.documentsUpdated).toBe(10);
  });

  it("reports the complete plan without writing in dry-run mode", async () => {
    const createIndex = vi.fn();
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(10);
    expect(result.documentsUpdated).toBe(0);
  });
});
