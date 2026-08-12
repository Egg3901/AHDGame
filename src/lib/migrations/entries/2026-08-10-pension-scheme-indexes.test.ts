import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-10-pension-scheme-indexes";

describe("2026-08-10-pension-scheme-indexes migration", () => {
  it("enforces one scheme per union", async () => {
    const createIndex = vi.fn().mockResolvedValue("ok");
    const db = { collection: () => ({ createIndex }) } as unknown as Db;

    const result = await migration.execute(db, { dryRun: false });

    // Two scheme documents for one union would split its assets in half with
    // no error anywhere, so this is a guard and not an optimisation.
    expect(createIndex).toHaveBeenCalledWith(
      { unionId: 1 },
      expect.objectContaining({ unique: true })
    );
    expect(createIndex).toHaveBeenCalledWith(
      { pensionContributionRate: 1, status: 1, expiresAtTurn: 1 },
      expect.objectContaining({ sparse: true })
    );
    expect(result.documentsUpdated).toBe(3);
  });

  it("reports the plan without writing in dry-run mode", async () => {
    const createIndex = vi.fn();
    const db = { collection: () => ({ createIndex }) } as unknown as Db;
    const result = await migration.execute(db, { dryRun: true });
    expect(createIndex).not.toHaveBeenCalled();
    expect(result.notes).toHaveLength(3);
  });
});
