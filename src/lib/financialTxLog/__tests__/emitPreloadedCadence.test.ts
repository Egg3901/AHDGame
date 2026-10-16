import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_TX_THRESHOLDS } from "@/lib/db/types/financialTxLog";
import { emitTx, emitTxBulk } from "../emit";
import { ObjectId } from "mongodb";

vi.mock("@/lib/ledger/featureFlag", () => ({
  isLedgerShadowEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
  recordAuditBulk: vi.fn(),
}));

describe("emitTx preloaded turn cadence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("adopts taxable income receipts after an applied insert loses its acknowledgement", async () => {
    const db = createMockDb();
    db.collection("financialTxLog");
    db.collection("gameConfig");
    let saved: unknown[] = [];
    db.collectionMocks.financialTxLog.insertMany.mockImplementation(async (docs: unknown[]) => {
      saved = docs;
      throw new Error("Lost acknowledgement");
    });
    db.collectionMocks.financialTxLog.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue(saved),
    }));
    await expect(
      emitTxBulk(
        db as never,
        [
          {
            type: "corp_salary",
            createdAt: new Date("2026-10-16T00:00:00Z"),
            turn: 1,
            subjectType: "character",
            subjectId: new ObjectId(),
            subjectName: "Synthetic taxpayer",
            amount: 100,
            anchorAmount: 100,
            currencyCode: "USD",
          },
        ],
        DEFAULT_TX_THRESHOLDS
      )
    ).resolves.toBeUndefined();
    expect(db.collectionMocks.financialTxLog.insertMany).toHaveBeenCalledOnce();
  });

  it("uses the supplied cadence for expiry without reading gameConfig", async () => {
    const db = createMockDb();
    db.collection("financialTxLog");
    db.collection("gameConfig");
    const createdAt = new Date("2026-09-25T00:00:00Z");

    await emitTx(
      db as never,
      {
        type: "stock_order_escrow",
        turn: 12,
        createdAt,
        subjectType: "fund",
        subjectName: "Test Fund",
        amount: -100,
        anchorAmount: -100,
        currencyCode: "USD",
      },
      DEFAULT_TX_THRESHOLDS,
      { turnLengthMinutes: 30 }
    );

    expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.financialTxLog.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date(createdAt.getTime() + 168 * 30 * 60_000),
      })
    );
  });
});
