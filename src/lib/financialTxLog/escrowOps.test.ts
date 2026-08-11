import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { creditCorpShareEscrow, debitCorpShareEscrow } from "./atomicCashGuard";

describe("corp share escrow ops", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
  });

  it("credit increments shareEscrowBalance by the amount", async () => {
    await creditCorpShareEscrow(db as unknown as Db, corpId, 50);
    const call = db.collectionMocks.corporations!.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: corpId });
    expect((call[1] as { $inc: Record<string, number> }).$inc.shareEscrowBalance).toBe(50);
  });

  it("debit decrements shareEscrowBalance (no gate; may go negative)", async () => {
    await debitCorpShareEscrow(db as unknown as Db, corpId, 50);
    const call = db.collectionMocks.corporations!.updateOne.mock.calls[0];
    expect(call[0]).toEqual({ _id: corpId });
    expect((call[1] as { $inc: Record<string, number> }).$inc.shareEscrowBalance).toBe(-50);
  });

  it("ignores non-positive amounts (no write)", async () => {
    await creditCorpShareEscrow(db as unknown as Db, corpId, 0);
    await debitCorpShareEscrow(db as unknown as Db, corpId, -5);
    expect(db.collectionMocks.corporations?.updateOne.mock.calls.length ?? 0).toBe(0);
  });

  it("ignores non-finite amounts (no write)", async () => {
    await creditCorpShareEscrow(db as unknown as Db, corpId, Number.NaN);
    await debitCorpShareEscrow(db as unknown as Db, corpId, Number.POSITIVE_INFINITY);
    expect(db.collectionMocks.corporations?.updateOne.mock.calls.length ?? 0).toBe(0);
  });
});
