import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-10-index-listing-petition-indexes";

describe("2026-08-10-index-listing-petition-indexes migration", () => {
  it("guards one PENDING petition per corporation, not one ever", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(4);
    expect(createIndex).toHaveBeenCalledWith(
      { corporationId: 1 },
      expect.objectContaining({
        unique: true,
        // A plain unique index would refuse the second petition a corporation
        // ever files, not the second one it has open.
        partialFilterExpression: { status: "pending" },
      })
    );
    expect(result.documentsUpdated).toBe(4);
  });

  it("reports the complete plan without writing in dry-run mode", async () => {
    const createIndex = vi.fn();
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(4);
    expect(result.documentsUpdated).toBe(0);
  });
});
