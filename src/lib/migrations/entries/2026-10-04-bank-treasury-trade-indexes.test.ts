import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { migration } from "./2026-10-04-bank-treasury-trade-indexes";
import { runBankTreasuryTradeIndexes } from "../../../../scripts/migrations/2026-10-04-bank-treasury-trade-indexes";

describe("bank treasury trade indexes migration", () => {
  it("is dry-run safe and creates the registered index on apply", async () => {
    const createIndex = vi.fn(async () => "bankTreasuryTrades_status_createdAt_id");
    const collection = vi.fn(() => ({ createIndex }));
    const db = { collection } as unknown as Db;

    const preview = await migration.execute(db, { dryRun: true });
    expect(preview.documentsUpdated).toBe(0);
    expect(createIndex).not.toHaveBeenCalled();
    const defaultPreview = await runBankTreasuryTradeIndexes(db);
    expect(defaultPreview.documentsUpdated).toBe(0);
    expect(createIndex).not.toHaveBeenCalled();

    const applied = await migration.execute(db, { dryRun: false });
    expect(collection).toHaveBeenCalledWith("bankTreasuryTrades");
    expect(createIndex).toHaveBeenCalledWith(
      { status: 1, createdAt: 1, _id: 1 },
      { name: "bankTreasuryTrades_status_createdAt_id", background: true }
    );
    expect(applied.documentsUpdated).toBe(1);
    expect(migration.idempotent).toBe(true);
  });
});
