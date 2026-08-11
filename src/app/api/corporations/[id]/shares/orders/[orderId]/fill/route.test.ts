import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn((amount: number, currencyCode: string) => ({
    funds: amount,
    [`balances.${currencyCode}`]: amount,
  })),
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
  loadCharacterFxRate: vi.fn().mockResolvedValue({ ok: true, rate: 1 }),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((amount: number) => amount),
  corpLiquidCapitalToAnchor: vi.fn((amount: number) => amount),
  estimateCorpWalletSpend: vi.fn(
    ({
      requiredAmount,
      availableBalance,
    }: {
      requiredAmount: number;
      availableBalance: number;
    }) => ({
      requiredFromAmount: requiredAmount,
      spendAmount: requiredAmount,
      deliveredAmount: requiredAmount,
      spreadFee: 0,
      canAfford: availableBalance >= requiredAmount,
      remainingBalance: Math.max(0, availableBalance - requiredAmount),
    })
  ),
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  loadFxRatesRecord: vi.fn().mockResolvedValue({ USD: 1 }),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditShares: vi.fn().mockResolvedValue(true),
  creditSharesToImperial: vi.fn().mockResolvedValue(true),
  creditSharesToCorp: vi.fn().mockResolvedValue(true),
  debitShares: vi.fn().mockResolvedValue(10),
  debitSharesFromCorp: vi.fn().mockResolvedValue(10),
  debitSharesFromImperial: vi.fn().mockResolvedValue(10),
}));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCharacterCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 900 }),
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
  atomicallyDebitImperialCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 900 }),
  refundImperialCash: vi.fn().mockResolvedValue(undefined),
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 900 }),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/corporations/hostileTakeoverNotifications", () => ({
  notifyHostileTakeoverThresholdIfEligible: vi.fn(),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(14) }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("POST /api/corporations/[id]/shares/orders/[orderId]/fill", () => {
  it("does not feed order-flow windows when a character fills another character's sell order", async () => {
    const userId = new ObjectId();
    const fillerId = new ObjectId();
    const sellerId = new ObjectId();
    const corpId = new ObjectId();
    const orderId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: corpId,
      characterId: sellerId,
      type: "sell",
      status: "open",
      sharesRemaining: 10,
      escrowAmount: 0,
      pricePerShare: 12,
    };

    const corporation = {
      _id: corpId,
      name: "Target Corp",
      sharePrice: 12,
      publicFloat: 100,
      liquidCurrencyCode: "USD",
      shareholders: [{ characterId: sellerId, shares: 25, avgCostPerShare: 7 }],
    };

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation,
    } as never);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].findOne.mockResolvedValue(order as never);
    db.collectionMocks["shareOrders"].findOneAndUpdate.mockResolvedValue(order as never);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: fillerId,
      activeCharacterType: "regular",
    } as never);

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockImplementation(
      async (query: { _id: ObjectId }) => {
        if (query._id?.equals(fillerId)) {
          return {
            _id: fillerId,
            userId,
            countryId: "US",
            name: "Buyer",
          };
        }

        if (query._id?.equals(sellerId)) {
          return {
            _id: sellerId,
            countryId: "US",
            name: "Seller",
          };
        }

        return null;
      }
    );

    const { creditShares, debitShares } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/orders/order/fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 10, fillAsCorporation: false }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "abc", orderId: orderId.toString() }),
    });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      sellerId,
      10,
      { $set: { updatedAt: expect.any(Date) } },
      { requireSufficient: true }
    );
    expect(creditShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      fillerId,
      10,
      { $set: { updatedAt: expect.any(Date) } },
      { pricePerShare: 12 }
    );
  });

  it("does not feed order-flow windows when a character fills another character's buy order", async () => {
    const userId = new ObjectId();
    const fillerId = new ObjectId();
    const buyerId = new ObjectId();
    const corpId = new ObjectId();
    const orderId = new ObjectId();

    const order = {
      _id: orderId,
      corporationId: corpId,
      characterId: buyerId,
      type: "buy",
      status: "open",
      sharesRemaining: 8,
      escrowAmount: 72,
      pricePerShare: 9,
    };

    const corporation = {
      _id: corpId,
      name: "Target Corp",
      sharePrice: 9,
      publicFloat: 100,
      liquidCurrencyCode: "USD",
      shareholders: [{ characterId: fillerId, shares: 20, avgCostPerShare: 6 }],
    };

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation,
    } as never);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].findOne.mockResolvedValue(order as never);
    db.collectionMocks["shareOrders"].findOneAndUpdate.mockResolvedValue(order as never);
    db.collectionMocks["shareOrders"].find.mockReturnValue({ toArray: async () => [] } as never);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: fillerId,
      activeCharacterType: "regular",
    } as never);

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockImplementation(
      async (query: { _id: ObjectId }) => {
        if (query._id?.equals(fillerId)) {
          return {
            _id: fillerId,
            userId,
            countryId: "US",
            name: "Seller",
          };
        }

        if (query._id?.equals(buyerId)) {
          return {
            _id: buyerId,
            countryId: "US",
            name: "Buyer",
          };
        }

        return null;
      }
    );

    const { creditShares, debitShares } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/orders/order/fill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 8, fillAsCorporation: false }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: "abc", orderId: orderId.toString() }),
    });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      fillerId,
      8,
      { $set: { updatedAt: expect.any(Date) } },
      { requireSufficient: true }
    );
    expect(creditShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      buyerId,
      8,
      { $set: { updatedAt: expect.any(Date) } },
      { pricePerShare: 9 }
    );
  });
});
