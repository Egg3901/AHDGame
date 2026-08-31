import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-08-28-equity-liquidity-indexes";

function mockDb() {
  const createIndex = vi.fn().mockResolvedValue("ok");
  return {
    db: { collection: vi.fn(() => ({ createIndex })) } as unknown as Db,
    createIndex,
  };
}

describe("equity liquidity indexes migration", () => {
  it("reports both indexes without writing in dry run", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: true });

    expect(createIndex).not.toHaveBeenCalled();
    expect(result.documentsScanned).toBe(2);
    expect(result.documentsUpdated).toBe(0);
  });

  it("creates both indexes idempotently", async () => {
    const { db, createIndex } = mockDb();
    const result = await migration.execute(db, { dryRun: false });

    expect(createIndex).toHaveBeenCalledTimes(2);
    expect(result.documentsUpdated).toBe(2);
  });
});
