import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  // anchor == local in tests (fxRate 1)
  corpLiquidCapitalToAnchor: (amount: number) => amount,
}));

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  insertFundTransaction: vi.fn().mockResolvedValue(new ObjectId()),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function fund() {
  return { _id: new ObjectId(), name: "Top 50", anchorCurrencyCode: "USD" as const };
}
function corp() {
  return { _id: new ObjectId(), liquidCurrencyCode: "USD" as const, countryId: "US" as const };
}

describe("placeFundShareBuyOrder", () => {
  it("debits cashAnchor by the anchor escrow and inserts an open buy order with placerFundId", async () => {
    const { placeFundShareBuyOrder } = await import("./fundShareOrders");
    const f = fund();
    const c = corp();
    // Atomic debit succeeds.
    (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const result = await placeFundShareBuyOrder(db as unknown as Db, {
      fund: f,
      corp: c,
      shares: 10,
      limitPriceLocal: 50,
      fxRate: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.orderId).toBeInstanceOf(ObjectId);

    // Debit gated on cashAnchor >= escrow, $inc -500.
    const debitCall = (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(debitCall[0]).toMatchObject({ _id: f._id, cashAnchor: { $gte: 500 } });
    expect(debitCall[1].$inc.cashAnchor).toBe(-500);

    // Order inserted with placerFundId and no characterId.
    const insertCall = (db.collection("shareOrders").insertOne as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(insertCall.placerFundId).toEqual(f._id);
    expect(insertCall.characterId).toBeUndefined();
    expect(insertCall.type).toBe("buy");
    expect(insertCall.status).toBe("open");
    expect(insertCall.escrowAmount).toBe(500);
    expect(insertCall.escrowAnchor).toBe(500);
    expect(insertCall.pricePerShare).toBe(50);
  });

  it("returns not-ok and does not insert when cashAnchor is insufficient", async () => {
    const { placeFundShareBuyOrder } = await import("./fundShareOrders");
    (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const result = await placeFundShareBuyOrder(db as unknown as Db, {
      fund: fund(),
      corp: corp(),
      shares: 10,
      limitPriceLocal: 50,
      fxRate: 1,
    });

    expect(result.ok).toBe(false);
    expect(db.collection("shareOrders").insertOne).not.toHaveBeenCalled();
  });
});

describe("placeFundShareSellOrder", () => {
  it("places a bounded fund ask only against unreserved holdings", async () => {
    const { placeFundShareSellOrder } = await import("./fundShareOrders");
    const c = corp();
    const f = {
      ...fund(),
      holdings: [{ corporationId: c._id, shares: 100 }],
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ sharesRemaining: 20 }]),
    });

    const result = await placeFundShareSellOrder(db as unknown as Db, {
      fund: f,
      corp: c,
      shares: 25,
      limitPriceLocal: 51,
      liquidityQuote: { turn: 44, referencePrice: 50 },
    });

    expect(result.ok).toBe(true);
    const inserted = (db.collection("shareOrders").insertOne as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(inserted).toMatchObject({
      placerFundId: f._id,
      corporationId: c._id,
      type: "sell",
      sharesRemaining: 25,
      pricePerShare: 51,
      liquidityProvider: true,
      liquidityQuotedTurn: 44,
      liquidityReferencePrice: 50,
    });
  });

  it("refuses an ask that exceeds holdings after open-order reservations", async () => {
    const { placeFundShareSellOrder } = await import("./fundShareOrders");
    const c = corp();
    const f = {
      ...fund(),
      holdings: [{ corporationId: c._id, shares: 100 }],
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ sharesRemaining: 80 }]),
    });

    const result = await placeFundShareSellOrder(db as unknown as Db, {
      fund: f,
      corp: c,
      shares: 25,
      limitPriceLocal: 51,
    });

    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/unreserved/) });
    expect(db.collection("shareOrders").insertOne).not.toHaveBeenCalled();
  });
});

describe("cancelFundShareOrder", () => {
  function fundOrder(overrides: Record<string, unknown> = {}) {
    const f = fund();
    const c = corp();
    const orderId = new ObjectId();
    return {
      f,
      orderId,
      order: {
        _id: orderId,
        corporationId: c._id,
        placerFundId: f._id,
        type: "buy",
        shares: 100,
        sharesRemaining: 100,
        pricePerShare: 50,
        escrowAmount: 5000,
        escrowAnchor: 300,
        status: "open",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      },
    };
  }

  it("refunds the stored anchor remainder through the keyed flow", async () => {
    // escrowAmount (5000) deliberately differs from escrowAnchor (300) so a
    // recompute-from-local regression would credit 5000, not 300.
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    const { f, orderId, order } = fundOrder();
    (db.collection("shareOrders").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(order);
    (db.collection("indexFunds").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: f._id,
    });

    await cancelFundShareOrder(db as unknown as Db, orderId);

    // CAS claim stamps the order cancelled.
    const claimCall = (db.collection("shareOrders").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(claimCall[0]).toMatchObject({ _id: orderId, status: "open" });
    expect(claimCall[1].$set).toMatchObject({ status: "cancelled" });

    // Refund 300 (stored anchor) to cashAnchor under the legacy subkey so a
    // legacy-applied refund converges instead of double-applying.
    const refundCall = (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(refundCall[0]).toMatchObject({ _id: f._id });
    expect(refundCall[1].$inc.cashAnchor).toBe(300);
  });

  it("refunds exactly the post-partial-fill residual escrowAnchor (no over-refund)", async () => {
    // Post-partial-fill state: sharesRemaining=60 with residual anchor 36000
    // while escrowAmount drifted to 40000. Cancel must refund EXACTLY 36000.
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    const { f, orderId, order } = fundOrder({
      sharesRemaining: 60,
      escrowAmount: 40000,
      escrowAnchor: 36000,
    });
    (db.collection("shareOrders").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(order);
    (db.collection("indexFunds").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: f._id,
    });

    await cancelFundShareOrder(db as unknown as Db, orderId);

    const refundCall = (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(refundCall[0]).toMatchObject({ _id: f._id });
    expect(refundCall[1].$inc.cashAnchor).toBe(36000);
  });

  it("is a no-op when the order is already closed / missing", async () => {
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    (db.collection("shareOrders").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await cancelFundShareOrder(db as unknown as Db, new ObjectId());

    expect(db.collection("indexFunds").updateOne).not.toHaveBeenCalled();
    expect(db.collection("nonAtomicMoneyFlowReceipts").insertOne).not.toHaveBeenCalled();
  });

  it("leaves non-fund orders untouched", async () => {
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    const orderId = new ObjectId();
    (db.collection("shareOrders").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: orderId,
      corporationId: new ObjectId(),
      characterId: new ObjectId(),
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 5,
      escrowAmount: 50,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await cancelFundShareOrder(db as unknown as Db, orderId);

    expect(db.collection("shareOrders").updateOne).not.toHaveBeenCalled();
    expect(db.collection("indexFunds").updateOne).not.toHaveBeenCalled();
  });
});

describe("placeFundShareBuyOrder — insert-failure compensation (issue #1672)", () => {
  const KEY = "test-bid-key-release";

  it("refunds the escrow and releases the debit subkey so a retry re-debits exactly once", async () => {
    const { placeFundShareBuyOrder } = await import("./fundShareOrders");
    const { deriveMoneyFlowKey, keyedInsertId } = await import("@/lib/db/nonAtomicMoneyFlow");
    const f = fund();
    const c = corp();
    const debitSubkey = deriveMoneyFlowKey(KEY, "escrow", "500");

    const updateOne = db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>;
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const insertOne = db.collection("shareOrders").insertOne as ReturnType<typeof vi.fn>;
    insertOne.mockRejectedValueOnce(new Error("order insert failed"));
    insertOne.mockResolvedValueOnce({ insertedId: keyedInsertId(KEY, "indexfund-bid-order:500") });

    await expect(
      placeFundShareBuyOrder(db as unknown as Db, {
        fund: f,
        corp: c,
        shares: 10,
        limitPriceLocal: 50,
        fxRate: 1,
        keyOptions: { idempotencyKey: KEY },
      })
    ).rejects.toThrow("order insert failed");

    // Compensation refunds the full escrow in the same atomic update that
    // releases the debit subkey, guarded on the debit still outstanding.
    const refundCall = updateOne.mock.calls[1];
    expect(refundCall[0]).toMatchObject({ _id: f._id, appliedMoneyFlowKeys: debitSubkey });
    expect(refundCall[1].$inc.cashAnchor).toBe(500);
    expect(refundCall[1].$pull).toMatchObject({ appliedMoneyFlowKeys: debitSubkey });
    expect(JSON.stringify(refundCall[1].$push)).toContain("compensate");

    // Retry re-debits (the released key no longer reads already-applied) and
    // lands the order under the deterministic id: no free order, no double debit.
    const result = await placeFundShareBuyOrder(db as unknown as Db, {
      fund: f,
      corp: c,
      shares: 10,
      limitPriceLocal: 50,
      fxRate: 1,
      keyOptions: { idempotencyKey: KEY },
    });
    expect(result.ok).toBe(true);
    expect(result.orderId).toEqual(keyedInsertId(KEY, "indexfund-bid-order:500"));
    expect(updateOne.mock.calls.filter((call) => call[1].$inc?.cashAnchor === -500)).toHaveLength(
      2
    );
    expect(insertOne).toHaveBeenCalledTimes(2);
  });

  it("does not refund under a concurrent same-key attempt that already landed the order", async () => {
    const { placeFundShareBuyOrder } = await import("./fundShareOrders");
    const f = fund();
    const c = corp();

    const updateOne = db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>;
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    (db.collection("shareOrders").insertOne as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("E11000 duplicate key error")
    );
    // The order-absence check finds the concurrent attempt's row: no refund.
    (db.collection("shareOrders").findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      _id: new ObjectId(),
      status: "open",
    });

    await expect(
      placeFundShareBuyOrder(db as unknown as Db, {
        fund: f,
        corp: c,
        shares: 10,
        limitPriceLocal: 50,
        fxRate: 1,
        keyOptions: { idempotencyKey: KEY },
      })
    ).rejects.toThrow("E11000");

    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  it("skipTx suppresses the escrow audit row while the default path writes it", async () => {
    const { placeFundShareBuyOrder } = await import("./fundShareOrders");
    const { insertFundTransaction } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(insertFundTransaction).mockClear();

    (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    (db.collection("shareOrders").insertOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      insertedId: new ObjectId(),
    });

    await placeFundShareBuyOrder(db as unknown as Db, {
      fund: fund(),
      corp: corp(),
      shares: 10,
      limitPriceLocal: 50,
      fxRate: 1,
      skipTx: true,
    });
    expect(insertFundTransaction).not.toHaveBeenCalled();

    await placeFundShareBuyOrder(db as unknown as Db, {
      fund: fund(),
      corp: corp(),
      shares: 10,
      limitPriceLocal: 50,
      fxRate: 1,
    });
    expect(insertFundTransaction).toHaveBeenCalledTimes(1);
  });
});
