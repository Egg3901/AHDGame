import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpCapital: (amount: number) => amount,
  corpLiquidCapitalToAnchor: (amount: number) => amount,
  fxRateForCorpFromMap: () => 1,
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  resolveCorpLiquidCurrencyCode: () => "USD",
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  creditSharesToFund: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/indexFunds/fundQueries", () => ({
  upsertFundHoldingShares: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

function setupOpenBuyOrder(opts: {
  corpId: ObjectId;
  characterId: ObjectId;
  shares: number;
  orderLimitPrice: number;
  currentSharePrice: number;
  fundamentalSharePrice?: number;
  publicFloat: number;
  totalShares?: number;
  existingShareholders?: { characterId: ObjectId; shares: number }[];
  charName?: string;
}) {
  const orderDoc = {
    _id: new ObjectId(),
    corporationId: opts.corpId,
    characterId: opts.characterId,
    type: "buy",
    shares: opts.shares,
    sharesRemaining: opts.shares,
    pricePerShare: opts.orderLimitPrice,
    escrowAmount: opts.shares * opts.orderLimitPrice,
    status: "open",
  };
  const shareOrdersColl = db.collection("shareOrders");
  (shareOrdersColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue([orderDoc]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  const corpDoc = {
    _id: opts.corpId,
    name: "Test Corp",
    sharePrice: opts.currentSharePrice,
    fundamentalSharePrice: opts.fundamentalSharePrice,
    publicFloat: opts.publicFloat,
    totalShares: opts.totalShares,
    shareholders: opts.existingShareholders ?? [],
    liquidCurrencyCode: "USD",
    countryId: "US",
  };
  const corpsColl = db.collection("corporations");
  (corpsColl.find as ReturnType<typeof vi.fn>).mockImplementation((query: unknown) => {
    const q = query as { _id?: { $in?: ObjectId[] } };
    const ids = q._id?.$in ?? [];
    const results: (typeof corpDoc)[] = ids.some((id) => id.equals(opts.corpId)) ? [corpDoc] : [];
    return {
      toArray: vi.fn().mockResolvedValue(results),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue(results.map((r) => ({ _id: r._id, name: r.name }))),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    };
  });

  const charDocs = opts.charName
    ? [{ _id: opts.characterId, name: opts.charName, countryId: "US" }]
    : [];
  const charsColl = db.collection("characters");
  (charsColl.find as ReturnType<typeof vi.fn>).mockReturnValue({
    toArray: vi.fn().mockResolvedValue(charDocs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue(charDocs),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
    })),
  });
}

function setupOpenSellOrder(opts: {
  corpId: ObjectId;
  characterId: ObjectId;
  shares: number;
  orderLimitPrice: number;
  currentSharePrice: number;
  heldShares: number;
}) {
  const orderDoc = {
    _id: new ObjectId(),
    corporationId: opts.corpId,
    characterId: opts.characterId,
    type: "sell",
    shares: opts.shares,
    sharesRemaining: opts.shares,
    pricePerShare: opts.orderLimitPrice,
    escrowAmount: 0,
    status: "open",
  };
  db.collection("shareOrders").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([orderDoc]),
  });
  const corpDoc = {
    _id: opts.corpId,
    name: "Test Corp",
    sharePrice: opts.currentSharePrice,
    fundamentalSharePrice: opts.currentSharePrice,
    publicFloat: 0,
    totalShares: 1_000,
    shareholders: [{ characterId: opts.characterId, shares: opts.heldShares }],
    liquidCurrencyCode: "USD",
    countryId: "US",
  };
  db.collection("corporations").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([corpDoc]),
    project: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: opts.corpId, name: "Test Corp" }]),
    }),
  });
  db.collection("characters").find.mockReturnValue({
    project: vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: opts.characterId, name: "Seller", countryId: "US" }]),
    }),
  });
}

/**
 * The fill loop reads every pool once up front (`find({})`) rather than one
 * `findOne` per corporation; mock both so either read path sees the pool.
 */
function mockPoolRead(
  pool: { find: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn> },
  doc: Record<string, unknown>
): void {
  pool.findOne.mockResolvedValue(doc);
  pool.find.mockReturnValue({ toArray: async () => [doc] });
}

describe("fillPendingShareOrders", () => {
  it("settles queued public-float buys into the currency pool", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const charId = new ObjectId();
    setupOpenBuyOrder({
      corpId,
      characterId: charId,
      shares: 10,
      orderLimitPrice: 200,
      currentSharePrice: 100,
      fundamentalSharePrice: 100,
      publicFloat: 50,
      totalShares: 1_000,
      existingShareholders: [],
      charName: "Pool Buyer",
    });
    const pool = db.collection("equityMarketPools");
    mockPoolRead(pool, {
      _id: "USD",
      cashLocal: 10_000,
      targetCashLocal: 10_000,
    });
    pool.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 258);

    expect(pool.updateOne).toHaveBeenCalledWith(
      { _id: "USD" },
      expect.objectContaining({
        $inc: expect.objectContaining({
          cashLocal: 1_020,
          "lifetime.purchasesIn": 1_020,
        }),
      })
    );
  });

  it("partially fills queued sells at the pool's bid and finite cash depth", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const sellerId = new ObjectId();
    setupOpenSellOrder({
      corpId,
      characterId: sellerId,
      shares: 10,
      orderLimitPrice: 90,
      currentSharePrice: 100,
      heldShares: 10,
    });
    const pool = db.collection("equityMarketPools");
    mockPoolRead(pool, {
      _id: "USD",
      cashLocal: 245,
      targetCashLocal: 245,
    });
    pool.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 258);

    // Bid is $98, so $245 of cash can absorb two whole shares.
    expect(pool.updateOne).toHaveBeenCalledWith(
      { _id: "USD", cashLocal: { $gte: 196 } },
      expect.objectContaining({
        $inc: expect.objectContaining({ cashLocal: -196, "lifetime.salesOut": 196 }),
      })
    );
    const orderUpdate = db.collection("shareOrders").bulkWrite.mock.calls[0][0][0];
    expect(orderUpdate.updateOne.update.$set).toMatchObject({
      status: "open",
      sharesRemaining: 8,
    });
    const corpOps = db.collection("corporations").bulkWrite.mock.calls[0][0];
    expect(corpOps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          updateOne: expect.objectContaining({
            update: expect.objectContaining({
              $inc: expect.objectContaining({ "shareholders.$.shares": -2 }),
            }),
          }),
        }),
      ])
    );
  });

  it("stamps avgCostPerShare on newly-pushed shareholder entries at current market price", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const charId = new ObjectId();
    setupOpenBuyOrder({
      corpId,
      characterId: charId,
      shares: 10,
      orderLimitPrice: 600, // limit >= sharePrice so order fills
      currentSharePrice: 585.04,
      publicFloat: 50, // float has enough shares
      existingShareholders: [], // no existing entry — forces $push
      charName: "Buyer",
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    // Find the push call on corporations.bulkWrite
    const corpsColl = db.collectionMocks["corporations"]!;
    const bulkCalls = corpsColl.bulkWrite.mock.calls;
    const pushCall = bulkCalls.find((call) =>
      (call[0] as { updateOne?: { update?: { $push?: unknown } } }[]).some(
        (op) => op.updateOne?.update?.$push
      )
    );
    expect(pushCall).toBeDefined();
    const pushOps = pushCall![0] as Array<{
      updateOne: { update: { $push: { shareholders: { avgCostPerShare?: number } } } };
    }>;
    const pushed = pushOps[0].updateOne.update.$push.shareholders;
    expect(pushed.avgCostPerShare).toBe(585.04);
  });

  it("does not stamp avgCostPerShare for sell fills (decrement-only)", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const sellerId = new ObjectId();

    const sellOrder = {
      _id: new ObjectId(),
      corporationId: corpId,
      characterId: sellerId,
      type: "sell",
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 500,
      escrowAmount: 0,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([sellOrder]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 600, // >= order limit, fills
      publicFloat: 0,
      shareholders: [{ characterId: sellerId, shares: 100, avgCostPerShare: 400 }],
      liquidCurrencyCode: "USD",
      countryId: "US",
    };
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([corpDoc]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: corpId, name: "Test Corp" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    });

    (db.collection("characters").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: sellerId, name: "Seller", countryId: "US" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: sellerId, name: "Seller" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    // No $push should occur; the seller already had an existing entry decremented via $inc.
    const corpsColl = db.collectionMocks["corporations"]!;
    const pushAnywhere = corpsColl.bulkWrite.mock.calls.some((call) =>
      (call[0] as { updateOne?: { update?: { $push?: unknown } } }[]).some(
        (op) => op.updateOne?.update?.$push
      )
    );
    expect(pushAnywhere).toBe(false);
  });

  it("caps character sell fills at current holdings after a reverse split (ticket #1154)", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const sellerId = new ObjectId();

    const sellOrder = {
      _id: new ObjectId(),
      corporationId: corpId,
      characterId: sellerId,
      type: "sell",
      shares: 1_000_000,
      sharesRemaining: 1_000_000,
      pricePerShare: 500,
      escrowAmount: 0,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([sellOrder]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 3200, // post-reverse spike; still >= the stale 500 limit
      publicFloat: 0,
      liquidCapital: 10_000_000_000,
      shareholders: [{ characterId: sellerId, shares: 10, avgCostPerShare: 400 }],
      liquidCurrencyCode: "USD",
      countryId: "US",
    };
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([corpDoc]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: corpId, name: "Test Corp" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    });

    (db.collection("characters").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: sellerId, name: "Seller", countryId: "US" }]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: sellerId, name: "Seller" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    const corpsColl = db.collectionMocks["corporations"]!;
    const incOps = corpsColl.bulkWrite.mock.calls.flatMap(
      (call) => call[0] as Array<{ updateOne?: { update?: { $inc?: Record<string, number> } } }>
    );
    const shareInc = incOps.find(
      (op) => op.updateOne?.update?.$inc?.["shareholders.$.shares"] != null
    );
    expect(shareInc?.updateOne?.update?.$inc?.["shareholders.$.shares"]).toBe(-10);

    const floatInc = incOps.find((op) => op.updateOne?.update?.$inc?.publicFloat != null);
    expect(floatInc?.updateOne?.update?.$inc?.publicFloat).toBe(10);

    const ordersColl = db.collectionMocks["shareOrders"]!;
    const orderUpdate = ordersColl.bulkWrite.mock.calls[0][0][0];
    expect(orderUpdate.updateOne.update.$set.sharesRemaining).toBe(999_990);
    expect(orderUpdate.updateOne.update.$set.status).toBe("open");
  });

  it("emits a limit_fill shareTradeHistory entry per fill", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const charId = new ObjectId();
    setupOpenBuyOrder({
      corpId,
      characterId: charId,
      shares: 10,
      orderLimitPrice: 600,
      currentSharePrice: 585.04,
      publicFloat: 50,
      existingShareholders: [],
      charName: "Buyer",
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    const historyColl = db.collectionMocks["shareTradeHistory"]!;
    expect(historyColl.insertOne).toHaveBeenCalledTimes(1);
    const doc = historyColl.insertOne.mock.calls[0][0];
    expect(doc.kind).toBe("limit_fill");
    expect(doc.turn).toBe(257);
    expect(doc.shares).toBe(10);
    expect(doc.pricePerShareAnchor).toBe(585.04);
    expect(doc.from).toBeNull();
    expect(doc.to).toEqual({ characterId: charId, name: "Buyer" });
  });

  it("fills a fund-owned buy order: credits the fund, refunds escrow, applies treasury delta", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const { creditSharesToFund } = await import("@/lib/corporations/shareholderOps");
    const { upsertFundHoldingShares } = await import("@/lib/indexFunds/fundQueries");
    const corpId = new ObjectId();
    const fundId = new ObjectId();

    const fundOrder = {
      _id: new ObjectId(),
      corporationId: corpId,
      placerFundId: fundId,
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 600, // limit above market → fills
      escrowAmount: 6000, // 10 * 600
      escrowAnchor: 6000,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([fundOrder]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 500, // fill price below limit → refund 10*100 = 1000
      publicFloat: 50,
      liquidCapital: 0,
      shareholders: [],
      liquidCurrencyCode: "USD",
      countryId: "US",
    };
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([corpDoc]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: corpId, name: "Test Corp" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    }));

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    // Fund cap-table credited with 10 shares at the ₳ fill price (500).
    expect(creditSharesToFund).toHaveBeenCalledTimes(1);
    const credArgs = vi.mocked(creditSharesToFund).mock.calls[0];
    expect(credArgs[1]).toEqual(corpId); // targetCorpId
    expect(credArgs[2]).toEqual(fundId); // fundId
    expect(credArgs[3]).toBe(10); // shares
    expect(credArgs[4]).toBe(500); // fillPriceAnchor
    expect(upsertFundHoldingShares).toHaveBeenCalledWith(db, fundId, corpId, 10, 500);

    // Unused escrow refunded to fund cashAnchor (6000 - 5000 = 1000).
    const fundsColl = db.collectionMocks["indexFunds"]!;
    const refundCall = fundsColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: { cashAnchor: number } } };
    }>;
    expect(refundCall[0].updateOne.update.$inc.cashAnchor).toBe(1000);

    // Order marked filled.
    const ordersColl = db.collectionMocks["shareOrders"]!;
    const fillOps = ordersColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: { status: string } } };
    }>;
    expect(fillOps[0].updateOne.update.$set.status).toBe("filled");

    // Issuer treasury credited with the buyer payment (10 * 500 = 5000).
    const corpsColl = db.collectionMocks["corporations"]!;
    const treasuryCall = corpsColl.bulkWrite.mock.calls.find((call) =>
      (call[0] as Array<{ updateOne?: { update?: { $inc?: { liquidCapital?: number } } } }>).some(
        (op) => op.updateOne?.update?.$inc?.liquidCapital === 5000
      )
    );
    expect(treasuryCall).toBeDefined();
  });

  it("leaves a fund-owned ask resting for peer execution", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const fundId = new ObjectId();
    const fundAsk = {
      _id: new ObjectId(),
      corporationId: corpId,
      placerFundId: fundId,
      type: "sell",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 490,
      escrowAmount: 0,
      status: "open",
      liquidityProvider: true,
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([fundAsk]),
    });
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: corpId,
          sharePrice: 500,
          publicFloat: 50,
          liquidCapital: 1_000_000,
          shareholders: [{ fundId, shares: 100 }],
          liquidCurrencyCode: "USD",
          countryId: "US",
        },
      ]),
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 301);

    expect(db.collection("shareOrders").bulkWrite).not.toHaveBeenCalled();
    expect(db.collection("corporations").bulkWrite).not.toHaveBeenCalled();
    expect(db.collection("indexFunds").bulkWrite).not.toHaveBeenCalled();
  });

  it("partial char buy fill refunds only filled shares' below-limit savings and reserves unfilled escrow", async () => {
    // 100 sh order, limit 600, market 500, float covers only 40 (fx 1).
    // toFill = min(100, 40) = 40 → partial (filled === false).
    // Correct char refund = 40 * (600 - 500) = 4000 (NOT escrow-actualCost = 60000-20000 = 40000).
    // Residual escrowAmount = 60 * 600 = 36000. Issuer treasury credited 40 * 500 = 20000.
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const charId = new ObjectId();
    setupOpenBuyOrder({
      corpId,
      characterId: charId,
      shares: 100,
      orderLimitPrice: 600,
      currentSharePrice: 500,
      publicFloat: 40, // float covers only 40 of 100
      existingShareholders: [],
      charName: "Buyer",
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    // Char refund credit = 4000 (filled shares' savings), not 40000.
    const charsColl = db.collectionMocks["characters"]!;
    const charBulk = charsColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc?: Record<string, number> } };
    }>;
    // buildPersonalBalanceBulkOp (forex off) writes a flat $inc on the legacy field.
    const incVals = charBulk
      .map((op) => op.updateOne.update.$inc ?? {})
      .flatMap((inc) => Object.values(inc));
    expect(incVals).toContain(4000);
    expect(incVals).not.toContain(40000);

    // Order stays open with sharesRemaining=60, escrowAmount=36000.
    const ordersColl = db.collectionMocks["shareOrders"]!;
    const fillOps = ordersColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(fillOps[0].updateOne.update.$set.status).toBe("open");
    expect(fillOps[0].updateOne.update.$set.sharesRemaining).toBe(60);
    expect(fillOps[0].updateOne.update.$set.escrowAmount).toBe(36000);

    // Issuer treasury credited 40 * 500 = 20000.
    const corpsColl = db.collectionMocks["corporations"]!;
    const treasuryCall = corpsColl.bulkWrite.mock.calls.find((call) =>
      (call[0] as Array<{ updateOne?: { update?: { $inc?: { liquidCapital?: number } } } }>).some(
        (op) => op.updateOne?.update?.$inc?.liquidCapital === 20000
      )
    );
    expect(treasuryCall).toBeDefined();
  });

  it("partial fund buy fill refunds filled savings and reserves unfilled escrow (local+anchor)", async () => {
    // Same numbers, fund-owned order. escrowAmount=60000, escrowAnchor=60000.
    // Refund = 40*(600-500) = 4000. Residual escrowAmount=36000, escrowAnchor=36000.
    // sharesRemaining=60. Treasury credited 40*500 = 20000.
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const fundId = new ObjectId();

    const fundOrder = {
      _id: new ObjectId(),
      corporationId: corpId,
      placerFundId: fundId,
      type: "buy",
      shares: 100,
      sharesRemaining: 100,
      pricePerShare: 600,
      escrowAmount: 60000, // 100 * 600
      escrowAnchor: 60000,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([fundOrder]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 500,
      publicFloat: 40, // covers only 40 of 100
      liquidCapital: 0,
      shareholders: [],
      liquidCurrencyCode: "USD",
      countryId: "US",
    };
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([corpDoc]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: corpId, name: "Test Corp" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    }));

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    // Fund cash refund = 4000 (not 40000).
    const fundsColl = db.collectionMocks["indexFunds"]!;
    const refundCall = fundsColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: { cashAnchor: number } } };
    }>;
    expect(refundCall[0].updateOne.update.$inc.cashAnchor).toBe(4000);

    // Residual escrow on the open order: local 36000, anchor 36000, sharesRemaining 60.
    const ordersColl = db.collectionMocks["shareOrders"]!;
    const fillOps = ordersColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(fillOps[0].updateOne.update.$set.status).toBe("open");
    expect(fillOps[0].updateOne.update.$set.sharesRemaining).toBe(60);
    expect(fillOps[0].updateOne.update.$set.escrowAmount).toBe(36000);
    expect(fillOps[0].updateOne.update.$set.escrowAnchor).toBe(36000);

    // Issuer treasury credited 40 * 500 = 20000.
    const corpsColl = db.collectionMocks["corporations"]!;
    const treasuryCall = corpsColl.bulkWrite.mock.calls.find((call) =>
      (call[0] as Array<{ updateOne?: { update?: { $inc?: { liquidCapital?: number } } } }>).some(
        (op) => op.updateOne?.update?.$inc?.liquidCapital === 20000
      )
    );
    expect(treasuryCall).toBeDefined();
  });

  it("full fund buy fill below limit refunds shares*(limit-market) and zeroes escrow", async () => {
    // 10 sh, limit 600, market 500, float 50 (covers all). filled === true.
    // Refund = 10*(600-500) = 1000. escrowAmount/escrowAnchor → 0. sharesRemaining 0.
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const fundId = new ObjectId();

    const fundOrder = {
      _id: new ObjectId(),
      corporationId: corpId,
      placerFundId: fundId,
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 600,
      escrowAmount: 6000,
      escrowAnchor: 6000,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([fundOrder]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 500,
      publicFloat: 50,
      liquidCapital: 0,
      shareholders: [],
      liquidCurrencyCode: "USD",
      countryId: "US",
    };
    (db.collection("corporations").find as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([corpDoc]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([{ _id: corpId, name: "Test Corp" }]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    }));

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    const fundsColl = db.collectionMocks["indexFunds"]!;
    const refundCall = fundsColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: { cashAnchor: number } } };
    }>;
    expect(refundCall[0].updateOne.update.$inc.cashAnchor).toBe(1000);

    const ordersColl = db.collectionMocks["shareOrders"]!;
    const fillOps = ordersColl.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(fillOps[0].updateOne.update.$set.status).toBe("filled");
    expect(fillOps[0].updateOne.update.$set.sharesRemaining).toBe(0);
    expect(fillOps[0].updateOne.update.$set.escrowAmount).toBe(0);
    expect(fillOps[0].updateOne.update.$set.escrowAnchor).toBe(0);
  });

  it("uses the guarded fundamental execution price for low-float buy fills", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const charId = new ObjectId();
    setupOpenBuyOrder({
      corpId,
      characterId: charId,
      shares: 10,
      orderLimitPrice: 50,
      currentSharePrice: 40,
      fundamentalSharePrice: 10,
      publicFloat: 100,
      totalShares: 10_000,
      existingShareholders: [],
      charName: "Buyer",
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    const corpsColl = db.collectionMocks["corporations"]!;
    const pushCall = corpsColl.bulkWrite.mock.calls.find((call) =>
      (call[0] as { updateOne?: { update?: { $push?: unknown } } }[]).some(
        (op) => op.updateOne?.update?.$push
      )
    );
    expect(pushCall).toBeDefined();
    const pushOps = pushCall![0] as Array<{
      updateOne: { update: { $push: { shareholders: { avgCostPerShare?: number } } } };
    }>;
    expect(pushOps[0].updateOne.update.$push.shareholders.avgCostPerShare).toBe(10);

    const historyColl = db.collectionMocks["shareTradeHistory"]!;
    const doc = historyColl.insertOne.mock.calls[0][0];
    expect(doc.pricePerShareAnchor).toBe(10);
  });
});
