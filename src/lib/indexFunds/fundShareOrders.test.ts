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

describe("cancelFundShareOrder", () => {
  it("refunds remaining escrowAnchor to cashAnchor and marks cancelled", async () => {
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    const f = fund();
    const orderId = new ObjectId();
    // Claim returns the pre-image with remaining escrowAnchor.
    (db.collection("shareOrders").findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: orderId,
      placerFundId: f._id,
      escrowAnchor: 300,
      status: "open",
    });

    await cancelFundShareOrder(db as unknown as Db, orderId);

    // Marked cancelled atomically.
    const claimCall = (db.collection("shareOrders").findOneAndUpdate as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(claimCall[1].$set.status).toBe("cancelled");

    // Refund 300 to cashAnchor.
    const refundCall = (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(refundCall[0]).toMatchObject({ _id: f._id });
    expect(refundCall[1].$inc.cashAnchor).toBe(300);
  });

  it("refunds exactly the post-partial-fill residual escrowAnchor (no over-refund)", async () => {
    // Post-partial-fill state: order had 100 sh @ limit 600, 40 filled at market 500.
    // Matcher left sharesRemaining=60, escrowAnchor = 60*600 = 36000.
    // Cancel must refund EXACTLY 36000 (the reserved residual), not the original 60000.
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    const f = fund();
    const orderId = new ObjectId();
    (db.collection("shareOrders").findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: orderId,
      placerFundId: f._id,
      sharesRemaining: 60,
      escrowAnchor: 36000,
      status: "open",
    });

    await cancelFundShareOrder(db as unknown as Db, orderId);

    const claimCall = (db.collection("shareOrders").findOneAndUpdate as ReturnType<typeof vi.fn>)
      .mock.calls[0];
    expect(claimCall[1].$set.status).toBe("cancelled");

    const refundCall = (db.collection("indexFunds").updateOne as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(refundCall[0]).toMatchObject({ _id: f._id });
    expect(refundCall[1].$inc.cashAnchor).toBe(36000);
  });

  it("is a no-op when the order is already closed / missing", async () => {
    const { cancelFundShareOrder } = await import("./fundShareOrders");
    (db.collection("shareOrders").findOneAndUpdate as ReturnType<typeof vi.fn>).mockResolvedValue(
      null
    );

    await cancelFundShareOrder(db as unknown as Db, new ObjectId());

    expect(db.collection("indexFunds").updateOne).not.toHaveBeenCalled();
  });
});
