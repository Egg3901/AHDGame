import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { cancelPendingShareOfferAndRefund } from "./cleanupShareMarketActivity";

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(9),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

describe("cancelPendingShareOfferAndRefund", () => {
  it("does not cancel the offer before validating buyer FX availability", async () => {
    const offerId = new ObjectId();
    const listingCorpId = new ObjectId();
    const buyerId = new ObjectId();

    db.collection("shareOffers");
    db.collectionMocks["shareOffers"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: listingCorpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: buyerId,
      countryId: "UK",
      name: "Buyer",
    });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY") {
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        }
        return Promise.resolve(null);
      }
    );

    await expect(
      cancelPendingShareOfferAndRefund(
        db as never,
        {
          _id: offerId,
          listingId: new ObjectId(),
          corporationId: listingCorpId,
          buyerCharacterId: buyerId,
          shares: 10,
          pricePerShare: 1000,
          escrowAmount: 10_000,
          status: "pending",
          createdAt: new Date(),
        } as never,
        new Date(),
        true
      )
    ).rejects.toThrow("Exchange rate unavailable");

    expect(db.collectionMocks["shareOffers"].updateOne).not.toHaveBeenCalled();
  });

  it("emits a refund tx when cleanup returns escrow to a buyer", async () => {
    const offerId = new ObjectId();
    const listingCorpId = new ObjectId();
    const buyerId = new ObjectId();

    db.collection("shareOffers");
    db.collectionMocks["shareOffers"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: listingCorpId,
      countryId: "JP",
      liquidCurrencyCode: "JPY",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: buyerId,
      countryId: "US",
      name: "Buyer",
    });
    db.collectionMocks["characters"].updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collection("exchangeRates");
    db.collectionMocks["exchangeRates"].findOne.mockImplementation(
      (filter: { currencyCode?: string }) => {
        if (filter?.currencyCode === "JPY") {
          return Promise.resolve({ currencyCode: "JPY", rate: 100 });
        }
        return Promise.resolve(null);
      }
    );

    const { emitTx } = await import("@/lib/financialTxLog/emit");

    const result = await cancelPendingShareOfferAndRefund(
      db as never,
      {
        _id: offerId,
        listingId: new ObjectId(),
        corporationId: listingCorpId,
        buyerCharacterId: buyerId,
        shares: 10,
        pricePerShare: 1000,
        escrowAmount: 10_000,
        status: "pending",
        createdAt: new Date(),
      } as never,
      new Date(),
      false
    );

    expect(result).toBe(true);
    expect(emitTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "share_listing_refund",
        subjectType: "character",
        subjectId: buyerId,
      })
    );
  });
});

describe("cleanupShareMarketActivityForCharacters excludeCorporationIds", () => {
  let edb: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    edb = createMockDb();
    // All three collections return no open/pending docs → no cancel side effects.
    for (const name of ["shareOrders", "shareListings", "shareOffers"]) {
      edb.collection(name).find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    }
  });

  it("adds a $nin corporation filter to orders, listings and offers queries", async () => {
    const charId = new ObjectId();
    const exemptCorp = new ObjectId();

    const { cleanupShareMarketActivityForCharacters } =
      await import("./cleanupShareMarketActivity");
    const result = await cleanupShareMarketActivityForCharacters(
      edb as unknown as Db,
      [charId],
      new Date(),
      false,
      { excludeCorporationIds: [exemptCorp] }
    );

    expect(result).toEqual({ ordersCancelled: 0, listingsCancelled: 0, offersCancelled: 0 });
    expect(edb.collection("shareOrders").find).toHaveBeenCalledWith({
      status: "open",
      characterId: { $in: [charId] },
      corporationId: { $nin: [exemptCorp] },
    });
    expect(edb.collection("shareListings").find).toHaveBeenCalledWith({
      status: "open",
      sellerCharacterId: { $in: [charId] },
      corporationId: { $nin: [exemptCorp] },
    });
    expect(edb.collection("shareOffers").find).toHaveBeenCalledWith({
      status: "pending",
      buyerCharacterId: { $in: [charId] },
      corporationId: { $nin: [exemptCorp] },
    });
  });

  it("omits the corporation filter when no exclude option is given", async () => {
    const charId = new ObjectId();

    const { cleanupShareMarketActivityForCharacters } =
      await import("./cleanupShareMarketActivity");
    await cleanupShareMarketActivityForCharacters(
      edb as unknown as Db,
      [charId],
      new Date(),
      false
    );

    expect(edb.collection("shareOrders").find).toHaveBeenCalledWith({
      status: "open",
      characterId: { $in: [charId] },
    });
  });
});
