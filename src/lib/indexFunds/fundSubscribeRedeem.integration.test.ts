import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  debitFundPosition,
  enqueueRedemption,
  FUND_POSITION_COLLECTION,
  FUND_REDEMPTION_QUEUE_COLLECTION,
} from "./fundQueries";
import { quoteCashOnlyRedemption, quoteIndexFundSubscription } from "./unitAccounting";
import { remainingRedemptionUnits } from "./fundRedemptionQueue";

describe("index fund subscribe/redeem accounting", () => {
  it("subscription quote mints whole units at NAV", () => {
    const quote = quoteIndexFundSubscription(100, 5);
    expect(quote.costAnchor).toBe(500);
    expect(quote.units).toBe(5);
  });

  it("redeem quote queues remainder when cash is insufficient", () => {
    const quote = quoteCashOnlyRedemption({
      quotedNav: 100,
      requestedUnits: 10,
      cashAnchor: 650,
    });
    expect(quote.redeemableUnits).toBe(6);
    expect(quote.queuedUnits).toBe(4);
    expect(quote.paidAmountAnchor).toBe(600);
    expect(quote.queuedAmountAnchor).toBe(400);
  });

  it("queue entry stores remaining units directly after partial cron payout", () => {
    expect(
      remainingRedemptionUnits({
        units: 4,
        paidAmountAnchor: 200,
        requestedNavAnchor: 100,
      })
    ).toBe(4);
  });
});

describe("fundQueries position mutations", () => {
  it("debits holder units when redeeming", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const characterId = new ObjectId();

    db.collection(FUND_POSITION_COLLECTION);
    // findOneAndUpdate returns the PRE-image (returnDocument: "before"); debiting
    // 4 of 10 leaves a reconstructed post-image of 6.
    db.collectionMocks[FUND_POSITION_COLLECTION]!.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      fundId,
      holderKind: "character",
      characterId,
      units: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await debitFundPosition(db as never, fundId, "character", { characterId }, 4);
    expect(result.ok).toBe(true);
    expect(result.ok && result.position?.units).toBe(6);
  });

  it("reports ok: false when the guarded debit matches no position", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const characterId = new ObjectId();

    db.collection(FUND_POSITION_COLLECTION);
    // Guard failed: no position with >= requested units (e.g. concurrent debit).
    db.collectionMocks[FUND_POSITION_COLLECTION]!.findOneAndUpdate.mockResolvedValue(null);

    const result = await debitFundPosition(db as never, fundId, "character", { characterId }, 4);
    expect(result.ok).toBe(false);
  });

  it("removes the position document and reports ok when units reach zero", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const characterId = new ObjectId();
    const positionId = new ObjectId();

    db.collection(FUND_POSITION_COLLECTION);
    // PRE-image holds exactly the 4 units being redeemed (0 legacy), so the
    // debit zeroes the position and it is removed.
    db.collectionMocks[FUND_POSITION_COLLECTION]!.findOneAndUpdate.mockResolvedValue({
      _id: positionId,
      fundId,
      holderKind: "character",
      characterId,
      units: 4,
      legacyUnits: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await debitFundPosition(db as never, fundId, "character", { characterId }, 4);
    expect(result).toEqual({ ok: true, position: null, legacyUnitsRedeemed: 0 });
    expect(db.collectionMocks[FUND_POSITION_COLLECTION]!.deleteOne).toHaveBeenCalledWith(
      { _id: positionId },
      undefined
    );
  });

  it("reports legacyUnitsRedeemed capped at the position's legacy units (#857 grandfather)", async () => {
    const db = createMockDb();
    const fundId = new ObjectId();
    const characterId = new ObjectId();

    db.collection(FUND_POSITION_COLLECTION);
    // PRE-image (returnDocument: "before"): holds 10 units, 3 of them legacy.
    db.collectionMocks[FUND_POSITION_COLLECTION]!.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      fundId,
      holderKind: "character",
      characterId,
      units: 10,
      legacyUnits: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Redeem 4 units: only 3 are legacy, so legacyUnitsRedeemed === 3, and the
    // reconstructed post-image has units 6 / legacyUnits 0.
    const result = await debitFundPosition(db as never, fundId, "character", { characterId }, 4);
    expect(result.ok).toBe(true);
    expect(result.ok && result.legacyUnitsRedeemed).toBe(3);
    expect(result.ok && result.position?.units).toBe(6);
    expect(result.ok && result.position?.legacyUnits).toBe(0);
  });

  it("enqueueRedemption inserts a queue row", async () => {
    const db = createMockDb();
    const entryId = await enqueueRedemption(db as never, {
      fundId: new ObjectId(),
      holderKind: "character",
      characterId: new ObjectId(),
      units: 3,
      requestedNavAnchor: 100,
      requestedAmountAnchor: 300,
      paidAmountAnchor: 0,
      unitsBurnedAtRequest: true,
      status: "queued",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(entryId).toBeDefined();
    expect(db.collectionMocks[FUND_REDEMPTION_QUEUE_COLLECTION]!.insertOne).toHaveBeenCalled();
  });
});
