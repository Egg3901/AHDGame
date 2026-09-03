import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation, ShareOrder } from "@/lib/db/types";

const settlementMocks = vi.hoisted(() => ({
  settleBuyOrderFill: vi.fn(),
  reconcileTotalSharesAfterFill: vi.fn(),
}));
vi.mock("./fillShareOrderSettlement", () => settlementMocks);
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));

import { fillBestBuyOrderForMarketSell } from "./fillBestBuyOrder";

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  settlementMocks.settleBuyOrderFill.mockResolvedValue(null);
  settlementMocks.reconcileTotalSharesAfterFill.mockResolvedValue(undefined);
});

function corporation(id: ObjectId): Corporation {
  return {
    _id: id,
    name: "Acme",
    countryId: "US",
    liquidCurrencyCode: "USD",
    sharePrice: 10,
    totalShares: 10_000,
    publicFloat: 1_000,
    shareholders: [],
  } as unknown as Corporation;
}

describe("fillBestBuyOrderForMarketSell", () => {
  it("claims the best active fund bid and pays from its locked anchor escrow", async () => {
    const corporationId = new ObjectId();
    const fundId = new ObjectId();
    const sellerId = new ObjectId();
    const order: ShareOrder = {
      _id: new ObjectId(),
      corporationId,
      placerFundId: fundId,
      liquidityProvider: true,
      type: "buy",
      shares: 100,
      sharesRemaining: 100,
      pricePerShare: 9.8,
      escrowAmount: 980,
      escrowAnchor: 490,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.collection("shareOrders");
    db.collectionMocks.shareOrders.find.mockReturnValue(createAsyncIterableCursor([order]));
    db.collectionMocks.shareOrders.findOneAndUpdate.mockResolvedValue({
      ...order,
      sharesRemaining: 60,
      escrowAmount: 588,
      escrowAnchor: 294,
      status: "open",
    });
    db.collection("indexFunds");
    db.collectionMocks.indexFunds.findOne.mockResolvedValue({
      _id: fundId,
      name: "Market Fund",
      status: "active",
    });

    const result = await fillBestBuyOrderForMarketSell({
      db: db as unknown as Db,
      corporation: corporation(corporationId),
      seller: {
        id: sellerId,
        name: "Seller",
        collectionName: "characters",
        homeCurrency: "USD",
        isImperial: false,
      },
      shares: 40,
      forexEnabled: true,
      sellerFxRate: 2,
      now: new Date(),
      turn: 100,
    });

    expect(result).toMatchObject({
      filled: true,
      shares: 40,
      proceedsAnchor: 196,
      proceedsInHomeCurrency: 392,
      pricePerShareLocal: 9.8,
    });
    expect(db.collectionMocks.shareOrders.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: order._id, sharesRemaining: 100, escrowAnchor: 490 }),
      expect.objectContaining({
        $set: expect.objectContaining({
          sharesRemaining: 60,
          escrowAmount: 588,
          escrowAnchor: 294,
          status: "open",
        }),
      }),
      { returnDocument: "after" }
    );
    expect(settlementMocks.settleBuyOrderFill).toHaveBeenCalledWith(
      expect.objectContaining({
        shares: 40,
        total: 196,
        totalInFillerHome: 392,
        fillerId: sellerId,
      })
    );
  });

  it("falls through when no single escrowed fund bid covers the requested shares", async () => {
    db.collection("shareOrders");
    db.collectionMocks.shareOrders.find.mockReturnValue(createAsyncIterableCursor([]));

    await expect(
      fillBestBuyOrderForMarketSell({
        db: db as unknown as Db,
        corporation: corporation(new ObjectId()),
        seller: {
          id: new ObjectId(),
          name: "Seller",
          collectionName: "characters",
          homeCurrency: "USD",
          isImperial: false,
        },
        shares: 40,
        forexEnabled: true,
        sellerFxRate: 1,
        now: new Date(),
        turn: 100,
      })
    ).resolves.toEqual({ filled: false });
    expect(settlementMocks.settleBuyOrderFill).not.toHaveBeenCalled();
  });
});
