import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-10-index-fund-phase-indexes";

describe("2026-08-10-index-fund-phase-indexes migration", () => {
  it("indexes bond holdings by fund, leading with the array field", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    // Leading with holders.fundId is what makes the $elemMatch selective. The
    // existing bonds indexes lead with holders.characterId and do not help.
    expect(createIndex).toHaveBeenCalledWith(
      { "holders.fundId": 1, matured: 1, defaulted: 1 },
      expect.objectContaining({ sparse: true })
    );
    expect(createIndex).toHaveBeenCalledWith(
      { placerFundId: 1, type: 1, status: 1 },
      expect.objectContaining({ sparse: true })
    );
    expect(result.documentsUpdated).toBe(2);
  });

  it("reports the plan without writing in dry-run mode", async () => {
    const createIndex = vi.fn();
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(2);
    expect(result.documentsUpdated).toBe(0);
  });
});
