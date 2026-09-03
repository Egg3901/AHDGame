import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  applyFloatBuyCredit,
  settleFloatSellDebit,
  reverseFloatSellDebit,
  onFloatSellCommitted,
} from "./shareEscrowSettlement";

const ESCROW = { _id: new ObjectId(), shareBuybackMode: "escrow" as const };
const INSTANT = { _id: new ObjectId() }; // unset ⇒ instant

function incOf(call: unknown[]): Record<string, number> {
  return (call[1] as { $inc: Record<string, number> }).$inc;
}

describe("shareEscrowSettlement", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  describe("finite equity pool", () => {
    beforeEach(() => {
      db.collection("equityMarketPools");
      db.collectionMocks.equityMarketPools.findOne.mockResolvedValue({
        _id: "USD",
        cashLocal: 5_000,
        targetCashLocal: 5_000,
      });
    });

    it("routes float purchases to pool cash, never the issuer", async () => {
      await applyFloatBuyCredit(db as unknown as Db, INSTANT, 1_000);
      expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenCalledWith(
        { _id: "USD" },
        expect.objectContaining({
          $inc: { cashLocal: 1_000, "lifetime.purchasesIn": 1_000 },
        }),
        expect.anything()
      );
      expect(db.collectionMocks.corporations?.findOneAndUpdate).toBeUndefined();
    });

    it("routes float sales through the pool's atomic cash gate", async () => {
      db.collectionMocks.equityMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 4_000 });
      const result = await settleFloatSellDebit(db as unknown as Db, INSTANT, 1_000);
      expect(result).toEqual({ ok: true });
      expect(db.collectionMocks.equityMarketPools.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: "USD", cashLocal: { $gte: 1_000 } },
        expect.objectContaining({
          $inc: { cashLocal: -1_000, "lifetime.salesOut": 1_000 },
        }),
        expect.anything()
      );
    });

    it("refunds the pool and leaves legacy issuance accounting untouched", async () => {
      await reverseFloatSellDebit(db as unknown as Db, INSTANT, 1_000);
      await onFloatSellCommitted(db as unknown as Db, INSTANT, 1_000);
      expect(db.collectionMocks.equityMarketPools.updateOne).toHaveBeenCalledWith(
        { _id: "USD" },
        expect.objectContaining({
          $inc: { cashLocal: 1_000, "lifetime.salesOut": -1_000 },
        }),
        undefined
      );
      expect(db.collectionMocks.corporations?.updateOne).toBeUndefined();
    });
  });

  describe("applyFloatBuyCredit", () => {
    it("escrow mode credits shareEscrowBalance via updateOne", async () => {
      await applyFloatBuyCredit(db as unknown as Db, ESCROW, 1000);
      const corp = db.collectionMocks.corporations!;
      expect(incOf(corp.updateOne.mock.calls[0]).shareEscrowBalance).toBe(1000);
      expect(corp.findOneAndUpdate.mock.calls.length).toBe(0);
    });

    it("instant mode credits liquidCapital + tracks issuance proceeds via findOneAndUpdate", async () => {
      await applyFloatBuyCredit(db as unknown as Db, INSTANT, 1000);
      const corp = db.collectionMocks.corporations!;
      const inc = incOf(corp.findOneAndUpdate.mock.calls[0]);
      expect(inc.liquidCapital).toBe(1000);
      expect(inc.shareIssuanceProceeds).toBe(1000);
      expect(corp.updateOne.mock.calls.length).toBe(0);
    });
  });

  describe("settleFloatSellDebit", () => {
    it("escrow mode floors escrow at zero via a pipeline update and is always ok (no gate)", async () => {
      db.collection("corporations");
      const corp = db.collectionMocks.corporations!;
      // pre-state escrow fully covers the sell → split is all escrow, no treasury
      corp.findOneAndUpdate.mockResolvedValue({ shareEscrowBalance: 3000 });
      const res = await settleFloatSellDebit(db as unknown as Db, ESCROW, 1000);
      expect(res.ok).toBe(true);
      expect(res.split).toEqual({ escrowDebited: 1000, treasuryDebited: 0 });
      // uses an aggregation-pipeline findOneAndUpdate (array), not a plain $inc
      expect(Array.isArray(corp.findOneAndUpdate.mock.calls[0][1])).toBe(true);
      expect(corp.updateOne.mock.calls.length).toBe(0);
    });

    it("escrow mode spills the shortfall onto liquidCapital when escrow can't cover", async () => {
      db.collection("corporations");
      const corp = db.collectionMocks.corporations!;
      corp.findOneAndUpdate.mockResolvedValue({ shareEscrowBalance: 200 });
      const res = await settleFloatSellDebit(db as unknown as Db, ESCROW, 1000);
      expect(res.split).toEqual({ escrowDebited: 200, treasuryDebited: 800 });
    });

    it("escrow mode draws entirely from treasury when escrow is already negative", async () => {
      db.collection("corporations");
      const corp = db.collectionMocks.corporations!;
      corp.findOneAndUpdate.mockResolvedValue({ shareEscrowBalance: -50000 });
      const res = await settleFloatSellDebit(db as unknown as Db, ESCROW, 1000);
      // max(0, -50000) = 0 → nothing from escrow, all real treasury; escrow can't sink further
      expect(res.split).toEqual({ escrowDebited: 0, treasuryDebited: 1000 });
    });

    it("instant mode gates against liquidCapital via findOneAndUpdate", async () => {
      const corp = db.collectionMocks; // force creation
      db.collection("corporations");
      corp.corporations!.findOneAndUpdate.mockResolvedValue({ liquidCapital: 5000 });
      const res = await settleFloatSellDebit(db as unknown as Db, INSTANT, 1000);
      expect(res.ok).toBe(true);
      const inc = incOf(corp.corporations!.findOneAndUpdate.mock.calls[0]);
      expect(inc.liquidCapital).toBe(-1000);
    });

    it("instant mode returns ok:false when treasury can't cover (findOneAndUpdate null)", async () => {
      const res = await settleFloatSellDebit(db as unknown as Db, INSTANT, 1000);
      expect(res.ok).toBe(false);
    });
  });

  describe("reverseFloatSellDebit", () => {
    it("escrow mode with a split reverses BOTH legs exactly (escrow + treasury)", async () => {
      await reverseFloatSellDebit(db as unknown as Db, ESCROW, 1000, {
        split: { escrowDebited: 200, treasuryDebited: 800 },
      });
      const calls = db.collectionMocks.corporations!.updateOne.mock.calls;
      const incs = calls.map(incOf);
      expect(incs).toContainEqual(expect.objectContaining({ shareEscrowBalance: 200 }));
      expect(incs).toContainEqual(expect.objectContaining({ liquidCapital: 800 }));
    });

    it("escrow mode with an all-escrow split touches only escrow", async () => {
      await reverseFloatSellDebit(db as unknown as Db, ESCROW, 1000, {
        split: { escrowDebited: 1000, treasuryDebited: 0 },
      });
      const calls = db.collectionMocks.corporations!.updateOne.mock.calls;
      expect(calls.length).toBe(1);
      expect(incOf(calls[0]).shareEscrowBalance).toBe(1000);
    });

    it("escrow mode without a split falls back to crediting escrow the full amount", async () => {
      await reverseFloatSellDebit(db as unknown as Db, ESCROW, 1000);
      expect(
        incOf(db.collectionMocks.corporations!.updateOne.mock.calls[0]).shareEscrowBalance
      ).toBe(1000);
    });

    it("instant mode refunds liquidCapital", async () => {
      await reverseFloatSellDebit(db as unknown as Db, INSTANT, 1000);
      expect(incOf(db.collectionMocks.corporations!.updateOne.mock.calls[0]).liquidCapital).toBe(
        1000
      );
    });
  });

  describe("onFloatSellCommitted", () => {
    it("instant mode decrements shareIssuanceProceeds", async () => {
      await onFloatSellCommitted(db as unknown as Db, INSTANT, 1000);
      expect(
        incOf(db.collectionMocks.corporations!.updateOne.mock.calls[0]).shareIssuanceProceeds
      ).toBe(-1000);
    });

    it("escrow mode is a no-op (no issuance-proceeds tracking)", async () => {
      await onFloatSellCommitted(db as unknown as Db, ESCROW, 1000);
      expect(db.collectionMocks.corporations?.updateOne.mock.calls.length ?? 0).toBe(0);
    });
  });
});
