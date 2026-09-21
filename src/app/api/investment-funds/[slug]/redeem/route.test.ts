import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUserWithCharacter: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({
  isIndexFundsEnabled: vi.fn(async () => true),
  isIndexFundsFullMode: vi.fn(async () => true),
  INDEX_FUNDS_DISABLED_MESSAGE: "Index funds are disabled",
  INDEX_FUNDS_PARTIAL_MESSAGE: "Index funds are in partial mode",
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn(async () => false) }));
// Force the standalone/sequential path so the route's own compensation runs.
vi.mock("@/lib/db/transactionWithRetry", () => ({
  runTransactionWithSessionRetry: vi.fn(
    (_getClient: unknown, run: (session?: undefined) => Promise<unknown>) => run(undefined)
  ),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(
    (retryAfter: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      })
  ),
}));
vi.mock("@/lib/api/rejectDuringTurn", () => ({ rejectDuringTurn: vi.fn(async () => null) }));
vi.mock("@/lib/indexFunds/redemptionLock", () => ({
  claimFundRedemptionLock: vi.fn(async () => vi.fn(async () => {})),
}));
vi.mock("@/lib/indexFunds/fundRedemptionLiquidity", () => ({
  sellFundHoldingsForRedemptionCash: vi.fn(async () => ({
    cashRaisedAnchor: 0,
    sharesSold: 0,
    salesExecuted: 0,
  })),
}));
vi.mock("@/lib/indexFunds/fundValuation", () => ({
  getQueuedRedemptionLiabilityAnchor: vi.fn(async () => 0),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 1) }));
vi.mock("@/lib/indexFunds/fundTxLog", () => ({
  logIndexFundRedeem: vi.fn(),
  logIndexFundRedeemActivity: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  resolveFundBySlugOrId: vi.fn(),
  getPosition: vi.fn(),
  debitFundPosition: vi.fn(),
  insertFundTransaction: vi.fn(),
  enqueueRedemption: vi.fn(),
}));

function makeRequest(units: number) {
  return new Request("http://localhost/api/investment-funds/test/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ units }),
  });
}

/** Pull the `$inc` payload of the nth call to a mock. */
function incOf(mock: { mock: { calls: unknown[][] } }, index: number): Record<string, number> {
  return (mock.mock.calls[index]![1] as { $inc: Record<string, number> }).$inc;
}

describe("POST /api/investment-funds/[slug]/redeem", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const fundId = new ObjectId();
  const positionId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("indexFunds");
    db.collection("indexFundPositions");
    db.collection("indexFundRedemptionQueue");
    db.collection("indexFundTransactions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: new ObjectId().toString(),
      username: "investor",
      character: { _id: characterId, name: "Investor", countryId: "US" },
    } as never);

    const {
      resolveFundBySlugOrId,
      getPosition,
      debitFundPosition,
      insertFundTransaction,
      enqueueRedemption,
    } = await import("@/lib/indexFunds/fundQueries");

    vi.mocked(resolveFundBySlugOrId).mockResolvedValue({
      _id: fundId,
      slug: "test",
      name: "Test Fund",
      status: "active",
      quotedNav: 1,
      anchorCurrencyCode: "USD",
      unitSupply: 1000,
      cashAnchor: 1000,
      holdings: [],
    } as never);

    vi.mocked(getPosition).mockResolvedValue({
      _id: positionId,
      fundId,
      holderKind: "character",
      characterId,
      units: 100,
      avgNavAnchor: 1,
      legacyUnits: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    vi.mocked(debitFundPosition).mockResolvedValue({
      ok: true,
      position: null,
      legacyUnitsRedeemed: 0,
    } as never);
    vi.mocked(insertFundTransaction).mockResolvedValue(new ObjectId());
    vi.mocked(enqueueRedemption).mockResolvedValue(new ObjectId());
  });

  function redeem(units: number) {
    return import("./route").then(({ POST }) =>
      POST(makeRequest(units), { params: Promise.resolve({ slug: "test" }) })
    );
  }

  it("reverses the position, unit supply and cash when the redemption insert throws", async () => {
    const { insertFundTransaction } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(insertFundTransaction).mockRejectedValueOnce(new Error("tx insert down"));

    const response = await redeem(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    // Fund cash debited then refunded; unit supply burned then restored.
    const fundEdits = db.collectionMocks["indexFunds"]!.updateOne.mock.calls.map(
      (c) => (c[1] as { $inc: Record<string, number> }).$inc
    );
    expect(fundEdits).toContainEqual(expect.objectContaining({ unitSupply: -10 }));
    expect(fundEdits).toContainEqual(expect.objectContaining({ unitSupply: 10 }));
    expect(fundEdits).toContainEqual(expect.objectContaining({ cashAnchor: -10 }));
    expect(fundEdits).toContainEqual(expect.objectContaining({ cashAnchor: 10 }));

    // Character credited then debited back (net zero).
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(2);
    expect(incOf(db.collectionMocks["characters"]!.updateOne, 0)).toMatchObject({ cashOnHand: 10 });
    expect(incOf(db.collectionMocks["characters"]!.updateOne, 1)).toMatchObject({
      cashOnHand: -10,
    });

    // Exact pre-debit position restored.
    expect(db.collectionMocks["indexFundPositions"]!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("restores the pre-debit position and refunds cash when the character credit throws", async () => {
    db.collectionMocks["characters"]!.updateOne.mockRejectedValueOnce(new Error("credit down"));

    const response = await redeem(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    // The cash debit is refunded and the burned supply restored.
    const fundEdits = db.collectionMocks["indexFunds"]!.updateOne.mock.calls.map(
      (c) => (c[1] as { $inc: Record<string, number> }).$inc
    );
    expect(fundEdits).toContainEqual(expect.objectContaining({ cashAnchor: 10 }));
    expect(fundEdits).toContainEqual(expect.objectContaining({ unitSupply: 10 }));

    // The pre-debit position (100 units) is written back.
    const restoreCall = db.collectionMocks["indexFundPositions"]!.updateOne.mock.calls[0]!;
    expect((restoreCall[1] as { $set: Record<string, unknown> }).$set).toMatchObject({
      units: 100,
    });
    expect(restoreCall[2]).toMatchObject({ upsert: true });
  });

  it("pays the holder and burns units on success", async () => {
    const response = await redeem(10);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.redeemedUnits).toBe(10);
    // One supply burn, one cash debit, one character credit, one tx insert.
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("reverses liquidity sales when a later payout write fails", async () => {
    const { resolveFundBySlugOrId, insertFundTransaction } =
      await import("@/lib/indexFunds/fundQueries");
    const fundBase = {
      _id: fundId,
      slug: "test",
      name: "Test Fund",
      status: "active",
      quotedNav: 1,
      anchorCurrencyCode: "USD",
      unitSupply: 1000,
      holdings: [{ corporationId: new ObjectId(), shares: 20, avgCostPerShare: 1 }],
    };
    vi.mocked(resolveFundBySlugOrId)
      .mockResolvedValueOnce({ ...fundBase, cashAnchor: 0 } as never)
      .mockResolvedValueOnce({ ...fundBase, cashAnchor: 0 } as never)
      .mockResolvedValueOnce({ ...fundBase, cashAnchor: 10 } as never);
    const undoLiquidity = vi.fn(async () => {});
    const { sellFundHoldingsForRedemptionCash } =
      await import("@/lib/indexFunds/fundRedemptionLiquidity");
    vi.mocked(sellFundHoldingsForRedemptionCash).mockResolvedValueOnce({
      cashRaisedAnchor: 10,
      sharesSold: 10,
      salesExecuted: 1,
      undo: undoLiquidity,
    });
    vi.mocked(insertFundTransaction).mockRejectedValueOnce(new Error("payout tx down"));

    const response = await redeem(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(undoLiquidity).toHaveBeenCalledTimes(1);
  });
});
