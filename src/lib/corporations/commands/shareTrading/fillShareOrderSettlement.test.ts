import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, getAccessedCollections, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation, ShareOrder } from "@/lib/db/types";
import { buildPersonalBalanceInc } from "@/lib/currency/characterFunds";
import {
  deriveLedgerEntries,
  fundMirrorAccount,
  type DerivableTx,
} from "@/lib/ledger/deriveFromTx";

vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditShares: vi.fn(),
  creditSharesToFund: vi.fn(),
  creditSharesToImperial: vi.fn(),
  creditSharesToCorp: vi.fn(),
  debitShares: vi.fn(),
  debitSharesFromCorp: vi.fn(),
  debitSharesFromFund: vi.fn(),
  debitSharesFromImperial: vi.fn(),
}));

vi.mock("@/lib/indexFunds/fundQueries", () => ({
  debitFundHoldingShares: vi.fn(),
  upsertFundHoldingShares: vi.fn(),
}));

vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));

import { creditSellerFundProceeds, settleBuyOrderFill } from "./fillShareOrderSettlement";

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
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

describe("creditSellerFundProceeds — corporation-buyer site", () => {
  it("credits cashAnchor then emits exactly one fund-subject row naming the corp buyer", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const fundId = new ObjectId();
    const buyerId = new ObjectId();
    const corporationId = new ObjectId();
    const orderId = new ObjectId();
    const now = new Date();

    await creditSellerFundProceeds({
      db: db as unknown as Db,
      fundId,
      fundName: "Market Fund",
      fundAnchorCurrency: "USD",
      total: 980,
      buyer: { type: "corporation", id: buyerId, name: "BuyerCorp" },
      corporationId,
      orderId,
      shares: 100,
      pricePerShare: 9.8,
      currentTurn: 7,
      now,
    });

    // Cash moved first, by the exact fill proceeds.
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      { _id: fundId },
      { $inc: { cashAnchor: 980 }, $set: { updatedAt: now } }
    );

    // Exactly one ledger row, on the committed path only.
    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "fund",
      subjectId: fundId,
      subjectName: "Market Fund",
      amount: 980,
      anchorAmount: 980,
      currencyCode: "USD",
      counterpartyType: "corporation",
      counterpartyId: buyerId,
      counterpartyName: "BuyerCorp",
      meta: {
        corporationId: corporationId.toString(),
        orderId: orderId.toString(),
        shares: 100,
        pricePerShare: 9.8,
        source: "order_fill_sell_order",
      },
    });

    // No duplicate mirror: fund-subject rows evidence the fund side directly.
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const entries = deriveLedgerEntries([row as unknown as DerivableTx]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0]).toMatchObject({
      account: `fund:${fundId.toString()}:USD`,
      amount: 980,
      anchorAmount: 980,
      role: "primary",
    });
    expect(entries[0]!.legs[1].account).toBe(`corporation:${buyerId.toString()}:USD`);
  });
});

describe("creditSellerFundProceeds — character-buyer site", () => {
  it("credits cashAnchor then emits exactly one fund-subject row naming the character buyer", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const fundId = new ObjectId();
    const buyerId = new ObjectId();
    const corporationId = new ObjectId();
    const orderId = new ObjectId();
    const now = new Date();

    await creditSellerFundProceeds({
      db: db as unknown as Db,
      fundId,
      fundName: "Market Fund",
      fundAnchorCurrency: "USD",
      total: 490,
      buyer: { type: "character", id: buyerId, name: "Buyer" },
      corporationId,
      orderId,
      shares: 50,
      pricePerShare: 9.8,
      currentTurn: 7,
      now,
    });

    expect(db.collectionMocks.indexFunds.updateOne).toHaveBeenCalledWith(
      { _id: fundId },
      { $inc: { cashAnchor: 490 }, $set: { updatedAt: now } }
    );

    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "fund",
      subjectId: fundId,
      amount: 490,
      anchorAmount: 490,
      currencyCode: "USD",
      counterpartyType: "character",
      counterpartyId: buyerId,
      counterpartyName: "Buyer",
      meta: {
        corporationId: corporationId.toString(),
        orderId: orderId.toString(),
        shares: 50,
        pricePerShare: 9.8,
        source: "order_fill_sell_order",
      },
    });

    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const entries = deriveLedgerEntries([row as unknown as DerivableTx]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0].account).toBe(`fund:${fundId.toString()}:USD`);
    expect(entries[0]!.legs[1].account).toBe(`character:${buyerId.toString()}:USD`);
  });
});

describe("creditSellerFundProceeds — failed credit", () => {
  it("throws before emitting when the fund is gone, so a failed fill books nothing", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    db.collection("indexFunds");
    db.collectionMocks.indexFunds.updateOne.mockResolvedValueOnce({ matchedCount: 0 });

    await expect(
      creditSellerFundProceeds({
        db: db as unknown as Db,
        fundId: new ObjectId(),
        fundName: "Market Fund",
        fundAnchorCurrency: "USD",
        total: 980,
        buyer: { type: "character", id: new ObjectId(), name: "Buyer" },
        corporationId: new ObjectId(),
        orderId: new ObjectId(),
        shares: 100,
        pricePerShare: 9.8,
        currentTurn: 7,
        now: new Date(),
      })
    ).rejects.toThrow("Liquidity-provider fund disappeared during settlement");
    expect(emitTx).not.toHaveBeenCalled();
  });
});

describe("settleBuyOrderFill — fund buy order (peer fill) moves no fund cash", () => {
  it("credits fund shares and releases escrow without touching indexFunds or emitting a fund row", async () => {
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    const { creditSharesToFund } = await import("@/lib/corporations/shareholderOps");
    const { upsertFundHoldingShares } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(debitShares).mockResolvedValue(10);
    vi.mocked(creditSharesToFund).mockResolvedValue(true);
    vi.mocked(upsertFundHoldingShares).mockResolvedValue(undefined);

    const corporationId = new ObjectId();
    const fundId = new ObjectId();
    const fillerId = new ObjectId();
    const orderId = new ObjectId();
    const now = new Date();
    const order: ShareOrder = {
      _id: orderId,
      corporationId,
      placerFundId: fundId,
      liquidityProvider: true,
      type: "buy",
      shares: 50,
      sharesRemaining: 50,
      pricePerShare: 9.8,
      escrowAmount: 490,
      escrowAnchor: 490,
      status: "open",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await settleBuyOrderFill({
      db: db as unknown as Db,
      corporation: corporation(corporationId),
      order,
      orderCharacterId: undefined,
      buyOrderBuyerCorp: null,
      shares: 50,
      total: 490,
      totalInFillerHome: 490,
      fillerId,
      fillerName: "Seller",
      fillerCollectionName: "characters",
      fillerHomeCurrency: "USD",
      isImperialFiller: false,
      forexEnabled: false,
      currentTurn: 7,
      now,
      restoreClaimedOrder: vi.fn(),
    });

    expect(result).toBeNull();

    // No fund cash moves at fill: the escrow moved at placement, so the
    // indexFunds collection is never even read here.
    expect(getAccessedCollections(db)).not.toContain("indexFunds");

    // The fund side of the fill is shares in, at the anchor fill price.
    expect(creditSharesToFund).toHaveBeenCalledWith(
      expect.anything(),
      corporationId,
      fundId,
      50,
      9.8,
      expect.anything()
    );
    expect(upsertFundHoldingShares).toHaveBeenCalledWith(
      expect.anything(),
      fundId,
      corporationId,
      50,
      9.8
    );

    // The filler is released exactly the escrow proceeds in home currency.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: fillerId },
      {
        $inc: buildPersonalBalanceInc(490, "USD", false),
        $set: { updatedAt: now },
      }
    );

    // One ledger row only: the filler's sale against the fund's escrow.
    // Deliberately no fund-subject row — no fund cash moved.
    expect(emitTx).toHaveBeenCalledTimes(1);
    const row = vi.mocked(emitTx).mock.calls[0]![1]!;
    expect(row).toMatchObject({
      type: "stock_trade_sell",
      turn: 7,
      subjectType: "character",
      subjectId: fillerId,
      subjectName: "Seller",
      amount: 490,
      currencyCode: "USD",
      counterpartyType: "system",
      counterpartyName: "Index fund",
      meta: {
        corporationId: corporationId.toString(),
        orderId: orderId.toString(),
        shares: 50,
        pricePerShare: 9.8,
        source: "order_fill_buy_order",
      },
    });
    // The row carries no anchorAmount: the real emitTx stamps it from the FX
    // table at persist time (withAnchorAmount), so derive the persisted shape
    // — exactly one entry, and no mirror for a stock_trade_sell either way.
    expect(fundMirrorAccount(row as unknown as DerivableTx)).toBeNull();
    const stamped = { ...row, anchorAmount: 490 } as unknown as DerivableTx;
    const entries = deriveLedgerEntries([stamped]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.legs[0]).toMatchObject({
      account: `character:${fillerId.toString()}:USD`,
      amount: 490,
      anchorAmount: 490,
    });
  });
});
