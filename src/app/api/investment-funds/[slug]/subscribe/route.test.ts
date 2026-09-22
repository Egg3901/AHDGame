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
vi.mock("@/lib/indexFunds/fundTxLog", () => ({ logIndexFundSubscribe: vi.fn() }));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 1) }));
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  resolveFundBySlugOrId: vi.fn(),
  creditFundPosition: vi.fn(),
  getPosition: vi.fn(),
  insertFundTransaction: vi.fn(),
}));

function makeRequest(units: number) {
  return new Request("http://localhost/api/investment-funds/test/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ units }),
  });
}

describe("POST /api/investment-funds/[slug]/subscribe", () => {
  let db: MockDb;
  const characterId = new ObjectId();
  const fundId = new ObjectId();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("indexFunds");
    db.collection("indexFundPositions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getAuthUserWithCharacter } = await import("@/lib/auth");
    vi.mocked(getAuthUserWithCharacter).mockResolvedValue({
      userId: new ObjectId().toString(),
      username: "investor",
      character: { _id: characterId, name: "Investor", countryId: "US" },
    } as never);

    const { resolveFundBySlugOrId, creditFundPosition, getPosition, insertFundTransaction } =
      await import("@/lib/indexFunds/fundQueries");
    vi.mocked(resolveFundBySlugOrId).mockResolvedValue({
      _id: fundId,
      slug: "test",
      name: "Test Fund",
      status: "active",
      quotedNav: 1,
      anchorCurrencyCode: "USD",
      unitSupply: 0,
      cashAnchor: 0,
    } as never);
    vi.mocked(creditFundPosition).mockResolvedValue({} as never);
    vi.mocked(getPosition).mockResolvedValue(null);
    vi.mocked(insertFundTransaction).mockResolvedValue(new ObjectId());
  });

  function subscribe(units: number) {
    return import("./route").then(({ POST }) =>
      POST(makeRequest(units), { params: Promise.resolve({ slug: "test" }) })
    );
  }

  /**
   * The cash amount debited by atomicallyDebitCharacterCash in call order.
   * forex is disabled in these tests, so the legacy `cashOnHand` field is used.
   */
  function debitedCash(): number {
    const call = db.collectionMocks["characters"]!.findOneAndUpdate.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    return -(call.$inc["cashOnHand"] ?? 0);
  }

  it("refunds the character when the position credit throws after the cash debit", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      currencyBalances: { personal: { USD: 100 } },
    });
    const { creditFundPosition } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(creditFundPosition).mockRejectedValueOnce(new Error("position credit down"));

    const response = await subscribe(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    const debited = debitedCash();
    expect(debited).toBeGreaterThan(0);
    // Cash is put back exactly once; no units are minted and no fund cash moves.
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(1);
    const refund = db.collectionMocks["characters"]!.updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    expect(refund.$inc["cashOnHand"]).toBe(debited);
    expect(db.collectionMocks["indexFunds"]!.updateOne).not.toHaveBeenCalled();
  });

  it("reverses every applied leg when the subscription transaction insert throws", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      currencyBalances: { personal: { USD: 100 } },
    });
    const { insertFundTransaction } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(insertFundTransaction).mockRejectedValueOnce(new Error("tx insert down"));

    const response = await subscribe(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    // Fund supply/cash incremented then reversed.
    expect(db.collectionMocks["indexFunds"]!.updateOne).toHaveBeenCalledTimes(2);
    const forward = db.collectionMocks["indexFunds"]!.updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    const reverse = db.collectionMocks["indexFunds"]!.updateOne.mock.calls[1]![1] as {
      $inc: Record<string, number>;
    };
    expect(forward.$inc).toMatchObject({ unitSupply: 10, cashAnchor: 10 });
    expect(reverse.$inc).toMatchObject({ unitSupply: -10, cashAnchor: -10 });
    // Newly-created position deleted, character refunded.
    expect(db.collectionMocks["indexFundPositions"]!.deleteOne).toHaveBeenCalledWith({
      fundId,
      holderKind: "character",
      characterId,
    });
    expect(db.collectionMocks["characters"]!.updateOne).toHaveBeenCalledTimes(1);
    const refund = db.collectionMocks["characters"]!.updateOne.mock.calls[0]![1] as {
      $inc: Record<string, number>;
    };
    expect(refund.$inc["cashOnHand"]).toBe(debitedCash());
  });

  it("restores the exact prior position including average NAV", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      currencyBalances: { personal: { USD: 100 } },
    });
    const prior = {
      _id: new ObjectId(),
      fundId,
      holderKind: "character" as const,
      characterId,
      units: 7,
      avgNavAnchor: 4.25,
      legacyUnits: 3,
      createdAt: new Date(1),
      updatedAt: new Date(2),
    };
    const { getPosition, insertFundTransaction } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(getPosition).mockResolvedValue(prior);
    vi.mocked(insertFundTransaction).mockRejectedValueOnce(new Error("tx insert down"));

    const response = await subscribe(10);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(db.collectionMocks["indexFundPositions"]!.replaceOne).toHaveBeenCalledWith(
      { _id: prior._id },
      prior,
      { upsert: true }
    );
    expect(db.collectionMocks["indexFundPositions"]!.deleteOne).not.toHaveBeenCalled();
  });

  it("mints units and credits fund cash on success", async () => {
    db.collectionMocks["characters"]!.findOneAndUpdate.mockResolvedValue({
      currencyBalances: { personal: { USD: 100 } },
    });

    const response = await subscribe(10);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.units).toBe(10);
    expect(db.collectionMocks["indexFunds"]!.updateOne).toHaveBeenCalledTimes(1);
  });
});
