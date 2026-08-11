import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
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
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
  bulkFetchCharacterNames: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
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
  shareTradeAnchorValue: vi.fn((shares: number, corporation: { sharePrice: number }) => {
    return shares * corporation.sharePrice;
  }),
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditShares: vi.fn().mockResolvedValue(true),
  debitShares: vi.fn().mockResolvedValue(95),
  creditSharesToCorp: vi.fn().mockResolvedValue(true),
  debitSharesFromCorp: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(14) }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCharacterCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 450 }),
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  refundCorpLiquidCapital: vi.fn(),
  creditCorpLiquidCapital: vi.fn().mockResolvedValue(0),
  decrementCorpIssuanceProceeds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/corporations/hostileTakeoverNotifications", () => ({
  notifyHostileTakeoverThresholdIfEligible: vi.fn(),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({
  recordShareTrade: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("POST /api/corporations/[id]/shares/orders", () => {
  it("rolls back an immediate character buy fill if settlement fails after shares credit", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Buyer",
      countryId: "US",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Target Corp",
        sharePrice: 10,
        publicFloat: 100,
        liquidCurrencyCode: "USD",
      },
    } as any);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockRejectedValueOnce(new Error("ledger failed"));

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    const { refundCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "buy",
        shares: 5,
        pricePerShare: 10,
        placeAsCorporation: false,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      5,
      {
        $inc: { publicFloat: 5, orderFlowWindowBuyValue: -50 },
        $set: expect.any(Object),
      },
      { requireSufficient: true }
    );
    expect(refundCharacterCash).toHaveBeenCalledWith(expect.anything(), charId, "USD", 50, false);
  });

  it("uses the fundamental execution price for low-float immediate buy fills", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Buyer",
      countryId: "US",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Target Corp",
        sharePrice: 40,
        fundamentalSharePrice: 10,
        totalShares: 10_000,
        publicFloat: 100,
        liquidCurrencyCode: "USD",
        ceoId: new ObjectId(),
      },
    } as any);

    const { atomicallyDebitCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");
    const { emitTx } = await import("@/lib/financialTxLog/emit");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "buy",
        shares: 5,
        pricePerShare: 10,
        placeAsCorporation: false,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(atomicallyDebitCharacterCash).toHaveBeenCalledWith(
      expect.anything(),
      charId,
      "USD",
      50,
      false
    );
    expect(emitTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        meta: expect.objectContaining({ pricePerShare: 10 }),
      })
    );
  });

  it("restores reserved shares if a pending sell order insert fails", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Seller",
      countryId: "US",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Target Corp",
        sharePrice: 10,
        publicFloat: 100,
        liquidCurrencyCode: "USD",
        shareholders: [{ characterId: charId, shares: 100, avgCostPerShare: 7 }],
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });
    db.collectionMocks["shareOrders"].insertOne.mockRejectedValueOnce(new Error("insert failed"));

    const { creditShares } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sell",
        shares: 5,
        pricePerShare: 20,
        placeAsCorporation: false,
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(creditShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      5,
      { $set: expect.any(Object) },
      { pricePerShare: 7 }
    );
  });
});
