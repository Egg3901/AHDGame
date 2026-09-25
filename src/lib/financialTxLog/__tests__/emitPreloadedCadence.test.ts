import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_TX_THRESHOLDS } from "@/lib/db/types/financialTxLog";
import { emitTx } from "../emit";

vi.mock("@/lib/ledger/featureFlag", () => ({
  isLedgerShadowEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/audit/recordAudit", () => ({
  recordAudit: vi.fn(),
  recordAuditBulk: vi.fn(),
}));

describe("emitTx preloaded turn cadence", () => {
  beforeEach(() => vi.clearAllMocks());

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
