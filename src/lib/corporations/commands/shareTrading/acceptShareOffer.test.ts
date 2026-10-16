import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { purchasedHoldingTerms } from "@/lib/corporations/rules/holdingTerms";
import { NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION } from "@/lib/db/nonAtomicMoneyFlow";
import { recoverShareFillAttempt } from "./shareFillAudit";
import { cancelShareListingAndRefund } from "@/lib/corporations/cancelShareListing";
import { acceptShareOffer } from "./acceptShareOffer";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/corporations/hostileTakeoverNotifications", () => ({
  notifyHostileTakeoverThresholdIfEligible: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn(), recordAuditBulk: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

async function fixture() {
  const memory = createInMemoryDb();
  const db = memory as unknown as Db;
  const userId = new ObjectId(),
    sellerId = new ObjectId(),
    buyerId = new ObjectId(),
    corporationId = new ObjectId(),
    listingId = new ObjectId(),
    offerId = new ObjectId();
  memory.seed("gameState", [
    { _id: "current", currentTurn: 20, stockHoldingTaxStartTurn: 0, isProcessing: false },
  ]);
  memory.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  memory.seed("characters", [
    { _id: sellerId, userId, name: "Synthetic seller", countryId: "US", cashOnHand: 0 },
    {
      _id: buyerId,
      userId: new ObjectId(),
      name: "Synthetic buyer",
      countryId: "US",
      cashOnHand: 0,
    },
  ]);
  memory.seed("corporations", [
    {
      _id: corporationId,
      name: "Synthetic issuer",
      countryId: "US",
      liquidCurrencyCode: "USD",
      sharePrice: 10,
      totalShares: 10,
      shareholders: [],
    },
  ]);
  memory.seed("shareListings", [
    {
      _id: listingId,
      corporationId,
      sellerCharacterId: sellerId,
      sharesListed: 10,
      sharesRemaining: 10,
      marketPriceAtCreation: 10,
      status: "open",
      expiresAtTurn: 44,
      expiresAt: new Date("2100-01-01"),
      holdingTerms: purchasedHoldingTerms(10, 4, 10),
    },
  ]);
  memory.seed("shareOffers", [
    {
      _id: offerId,
      listingId,
      corporationId,
      buyerCharacterId: buyerId,
      shares: 10,
      pricePerShare: 10,
      escrowAmount: 100,
      status: "pending",
    },
  ]);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toHexString() },
  } as never);
  const accept = () =>
    acceptShareOffer(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sharesToAccept: 4 }),
      }),
      {
        params: Promise.resolve({
          id: corporationId.toHexString(),
          listingId: listingId.toHexString(),
          offerId: offerId.toHexString(),
        }),
      }
    );
  return { memory, db, sellerId, buyerId, corporationId, listingId, offerId, accept };
}
beforeEach(() => vi.clearAllMocks());
describe("private share settlement", () => {
  it("settles prepaid escrow once, preserves remaining age and basis, and credits taxable gains with seller cash", async () => {
    const { db, sellerId, buyerId, listingId, accept } = await fixture();
    expect((await accept()).status).toBe(200);
    const seller = await db.collection("characters").findOne({ _id: sellerId });
    expect(seller).toMatchObject({
      cashOnHand: 40,
      pendingStockTaxReceipts: [{ incomeAmount: 24, capitalAmount: 0, assessmentTurn: 21 }],
    });
    expect(await db.collection("characters").findOne({ _id: buyerId })).toMatchObject({
      cashOnHand: 60,
    });
    expect(await db.collection("shareListings").findOne({ _id: listingId })).toMatchObject({
      sharesRemaining: 6,
      holdingTerms: purchasedHoldingTerms(6, 4, 10),
    });
    expect(
      (await db.collection("shareListings").findOne({ _id: listingId }))!.activeShareFillKey
    ).toBeUndefined();
    expect((await db.collection("corporations").findOne({}))!.shareholders[0]).toMatchObject({
      characterId: buyerId,
      shares: 4,
      holdingTerms: purchasedHoldingTerms(4, 10, 20),
    });
    expect((await accept()).status).toBe(400);
    expect(await db.collection("shareTradeHistory").countDocuments({ kind: "listing_fill" })).toBe(
      1
    );
    expect(await db.collection("financialTxLog").countDocuments({ type: "stock_trade_buy" })).toBe(
      0
    );
  });
  it("taxes matured listing profits as capital gains while the buyer starts a new short-term lot", async () => {
    const { db, sellerId, accept } = await fixture();
    await db.collection("gameState").updateOne({}, { $set: { currentTurn: 58 } });
    await db.collection("shareListings").updateOne({}, { $set: { expiresAtTurn: 100 } });
    expect((await accept()).status).toBe(200);
    expect(
      (await db.collection("characters").findOne({ _id: sellerId }))!.pendingStockTaxReceipts[0]
    ).toMatchObject({ incomeAmount: 0, capitalAmount: 24, assessmentTurn: 59 });
    expect((await db.collection("shareListings").findOne({}))!.holdingTerms).toEqual({
      longTermShares: 6,
      longTermCostBasisAnchor: 24,
      shortTermLots: [],
    });
    expect((await db.collection("corporations").findOne({}))!.shareholders[0].holdingTerms).toEqual(
      purchasedHoldingTerms(4, 10, 58)
    );
  });
  it("defers taxable income until an interrupted private-offer refund recovers", async () => {
    const { memory, db, sellerId, buyerId, listingId, accept } = await fixture();
    const characters = memory.collection("characters");
    const original = characters.updateOne.bind(characters);
    let failed = false;
    vi.spyOn(characters, "updateOne").mockImplementation(async (filter, update, options) => {
      if (
        !failed &&
        filter._id?.toString() === buyerId.toHexString() &&
        JSON.stringify(update).includes('"cashOnHand":60')
      ) {
        failed = true;
        throw new Error("Synthetic refund failure");
      }
      return original(filter, update, options);
    });
    expect((await accept()).status).toBe(500);
    const listing = (await db.collection("shareListings").findOne({ _id: listingId }))!;
    const seller = (await db.collection("characters").findOne({ _id: sellerId }))!;
    expect(seller.cashOnHand).toBe(0);
    expect(seller.pendingStockTaxReceipts ?? []).toEqual([]);
    await recoverShareFillAttempt(db, listing.activeShareFillKey);
    expect((await db.collection("characters").findOne({ _id: sellerId }))!.cashOnHand).toBe(40);
    expect(
      (await db.collection("characters").findOne({ _id: sellerId }))!.pendingStockTaxReceipts
    ).toHaveLength(1);
    expect(
      (await db.collection("shareListings").findOne({ _id: listingId }))!.sharesRemaining
    ).toBe(6);
  });
  it.each([false, true])(
    "recovers the listing-first claim gap safely when buyer cancellation is %s",
    async (cancelled) => {
      const { memory, db, sellerId, buyerId, listingId, offerId, accept } = await fixture();
      vi.spyOn(memory.collection("shareOffers"), "findOneAndUpdate").mockRejectedValueOnce(
        new Error("Interrupted offer claim")
      );
      expect((await accept()).status).toBe(500);
      const listing = (await db.collection("shareListings").findOne({ _id: listingId }))!;
      expect(listing.activeShareFillKey).toEqual(expect.any(String));
      if (cancelled) {
        await db
          .collection("shareOffers")
          .updateOne({ _id: offerId }, { $set: { status: "cancelled" } });
        await db
          .collection("characters")
          .updateOne({ _id: buyerId }, { $inc: { cashOnHand: 100 } });
      }
      await recoverShareFillAttempt(db, listing.activeShareFillKey);
      expect((await db.collection("characters").findOne({ _id: sellerId }))!.cashOnHand).toBe(
        cancelled ? 0 : 40
      );
      expect((await db.collection("characters").findOne({ _id: buyerId }))!.cashOnHand).toBe(
        cancelled ? 100 : 60
      );
      const restored = (await db.collection("shareListings").findOne({ _id: listingId }))!;
      expect(restored.activeShareFillKey).toBeUndefined();
      expect(restored.sharesRemaining).toBe(cancelled ? 10 : 6);
      expect(restored.holdingTerms).toEqual(purchasedHoldingTerms(cancelled ? 10 : 6, 4, 10));
    }
  );
  it("recovers a process death after the listing claim but before the money plan is stored", async () => {
    const { memory, db, sellerId, buyerId, listingId, accept } = await fixture();
    const receipts = memory.collection(NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION);
    const original = receipts.updateOne.bind(receipts);
    let crash = true;
    vi.spyOn(receipts, "updateOne").mockImplementation(async (filter, update, options) => {
      if (crash && JSON.stringify(update).includes('"shareFillMoneyPlan"')) {
        crash = false;
        throw new Error("Synthetic interrupted plan write");
      }
      return original(filter, update, options);
    });
    expect((await accept()).status).toBe(500);
    const listing = await db.collection("shareListings").findOne({ _id: listingId });
    expect(listing!.activeShareFillKey).toEqual(expect.any(String));
    expect(
      await cancelShareListingAndRefund(db, listing as never, new Date(), false)
    ).toMatchObject({ ok: false });
    const result = await recoverShareFillAttempt(db, listing!.activeShareFillKey);
    expect(result.action).toMatch(/audit-/);
    await recoverShareFillAttempt(db, listing!.activeShareFillKey);
    expect((await db.collection("characters").findOne({ _id: sellerId }))!.cashOnHand).toBe(40);
    expect((await db.collection("characters").findOne({ _id: buyerId }))!.cashOnHand).toBe(60);
    expect(
      (await db.collection("characters").findOne({ _id: sellerId }))!.pendingStockTaxReceipts
    ).toHaveLength(1);
    expect(await db.collection("shareTradeHistory").countDocuments({ kind: "listing_fill" })).toBe(
      1
    );
  });
});
