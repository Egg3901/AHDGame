import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION } from "@/lib/db/nonAtomicMoneyFlow";

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
  // Per-match settlement reads the live cap table through findOne before
  // choosing the positional increment vs push variant.
  (corpsColl.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(corpDoc);
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

/** updateOne calls on a collection as { filter, update } pairs. */
function updateCalls(
  name: string
): Array<{ filter: Record<string, unknown>; update: Record<string, unknown> }> {
  return db.collectionMocks[name]!.updateOne.mock.calls.map((call) => ({
    filter: call[0] as Record<string, unknown>,
    update: call[1] as Record<string, unknown>,
  }));
}

function incOf(update: Record<string, unknown>): Record<string, number> {
  return (update.$inc as Record<string, number> | undefined) ?? {};
}

function setOf(update: Record<string, unknown>): Record<string, unknown> {
  return (update.$set as Record<string, unknown> | undefined) ?? {};
}

function pushOf(update: Record<string, unknown>): Record<string, unknown> {
  return (update.$push as Record<string, unknown> | undefined) ?? {};
}

/** Match receipt ids claimed during the run (one durable receipt per match). */
function claimedMatchKeys(): string[] {
  const receipts = db.collectionMocks[NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION]!;
  return receipts.insertOne.mock.calls.map((call) => (call[0] as { _id: string })._id);
}

function completedMatchKeys(): string[] {
  const receipts = db.collectionMocks[NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION]!;
  return receipts.updateOne.mock.calls
    .filter((call) => (call[1] as { $set?: { status?: string } }).$set?.status === "completed")
    .map((call) => (call[0] as { _id: string })._id);
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

    // One durable receipt per match, settled completed.
    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    // Pool dealer leg carries the same economics as the legacy batch commit,
    // now as a keyed updateOne instead of a bulkWrite entry.
    const dealer = updateCalls("equityMarketPools").find(
      (call) => call.filter._id === "USD" && incOf(call.update).cashLocal === 1_020
    );
    expect(dealer).toBeDefined();
    expect(incOf(dealer!.update)["lifetime.purchasesIn"]).toBe(1_020);
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
    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    const dealer = updateCalls("equityMarketPools").find(
      (call) => call.filter._id === "USD" && incOf(call.update).cashLocal === -196
    );
    expect(dealer).toBeDefined();
    expect((dealer!.filter as { cashLocal?: { $gte?: number } }).cashLocal?.$gte).toBe(196);
    expect(incOf(dealer!.update)["lifetime.salesOut"]).toBe(196);
    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).sharesRemaining === 8
    );
    expect(orderClaim).toBeDefined();
    expect(setOf(orderClaim!.update)).toMatchObject({ status: "open", sharesRemaining: 8 });
    const debit = updateCalls("corporations").find(
      (call) => incOf(call.update)["shareholders.$.shares"] === -2
    );
    expect(debit).toBeDefined();
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

    // New cap-table entry arrives as a keyed $push on corporations.updateOne.
    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    const pushCall = updateCalls("corporations").find(
      (call) => pushOf(call.update).shareholders !== undefined
    );
    expect(pushCall).toBeDefined();
    const pushed = pushOf(pushCall!.update).shareholders as { avgCostPerShare?: number };
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
    const pushAnywhere = updateCalls("corporations").some(
      (call) => pushOf(call.update).shareholders !== undefined
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

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    const corpCalls = updateCalls("corporations");
    const shareInc = corpCalls.find((call) => incOf(call.update)["shareholders.$.shares"] === -10);
    expect(shareInc).toBeDefined();

    const floatInc = corpCalls.find((call) => incOf(call.update).publicFloat === 10);
    expect(floatInc).toBeDefined();

    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).sharesRemaining === 999_990
    );
    expect(orderClaim).toBeDefined();
    expect(setOf(orderClaim!.update).status).toBe("open");
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
    const corpId = new ObjectId();
    const fundId = new ObjectId();
    (db.collection("indexFunds").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: fundId,
      holdings: [],
    });

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
    (db.collection("corporations").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(corpDoc);

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    // Fund cap-table credited with 10 shares at the fill price (500) via a
    // keyed $push carrying the fund entry.
    const capPush = updateCalls("corporations").find(
      (call) => pushOf(call.update).shareholders !== undefined
    );
    expect(capPush).toBeDefined();
    expect(pushOf(capPush!.update).shareholders).toMatchObject({ shares: 10 });

    // Fund holdings ledger credited alongside the cap table.
    const holdingsPush = updateCalls("indexFunds").find(
      (call) => pushOf(call.update).holdings !== undefined
    );
    expect(holdingsPush).toBeDefined();

    // Unused escrow refunded to fund cashAnchor (6000 - 5000 = 1000).
    const refund = updateCalls("indexFunds").find((call) => incOf(call.update).cashAnchor === 1000);
    expect(refund).toBeDefined();

    // Order marked filled.
    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).status === "filled"
    );
    expect(orderClaim).toBeDefined();

    // Issuer treasury credited with the buyer payment (10 * 500 = 5000).
    const treasuryCall = updateCalls("corporations").find(
      (call) => incOf(call.update).liquidCapital === 5000
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
    expect(db.collection("shareOrders").updateOne).not.toHaveBeenCalled();
    expect(db.collection("corporations").updateOne).not.toHaveBeenCalled();
    expect(db.collection("indexFunds").updateOne).not.toHaveBeenCalled();
    expect(claimedMatchKeys()).toHaveLength(0);
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

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    // Char refund credit = 4000 (filled shares' savings), not 40000.
    const charIncs = updateCalls("characters").flatMap((call) => Object.values(incOf(call.update)));
    expect(charIncs).toContain(4000);
    expect(charIncs).not.toContain(40000);

    // Order stays open with sharesRemaining=60, escrowAmount=36000.
    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).sharesRemaining === 60
    );
    expect(orderClaim).toBeDefined();
    expect(setOf(orderClaim!.update).status).toBe("open");
    expect(setOf(orderClaim!.update).escrowAmount).toBe(36000);

    // Issuer treasury credited 40 * 500 = 20000.
    const treasuryCall = updateCalls("corporations").find(
      (call) => incOf(call.update).liquidCapital === 20000
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
    (db.collection("corporations").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(corpDoc);
    (db.collection("indexFunds").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: fundId,
      holdings: [],
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    // Fund cash refund = 4000 (not 40000).
    const refund = updateCalls("indexFunds").find((call) => incOf(call.update).cashAnchor === 4000);
    expect(refund).toBeDefined();

    // Residual escrow on the open order: local 36000, anchor 36000, sharesRemaining 60.
    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).sharesRemaining === 60
    );
    expect(orderClaim).toBeDefined();
    expect(setOf(orderClaim!.update).status).toBe("open");
    expect(setOf(orderClaim!.update).escrowAmount).toBe(36000);
    expect(setOf(orderClaim!.update).escrowAnchor).toBe(36000);

    // Issuer treasury credited 40 * 500 = 20000.
    const treasuryCall = updateCalls("corporations").find(
      (call) => incOf(call.update).liquidCapital === 20000
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
    (db.collection("corporations").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(corpDoc);
    (db.collection("indexFunds").findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
      _id: fundId,
      holdings: [],
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 300);

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    const refund = updateCalls("indexFunds").find((call) => incOf(call.update).cashAnchor === 1000);
    expect(refund).toBeDefined();

    const orderClaim = updateCalls("shareOrders").find(
      (call) => setOf(call.update).status === "filled"
    );
    expect(orderClaim).toBeDefined();
    expect(setOf(orderClaim!.update).sharesRemaining).toBe(0);
    expect(setOf(orderClaim!.update).escrowAmount).toBe(0);
    expect(setOf(orderClaim!.update).escrowAnchor).toBe(0);
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

    expect(claimedMatchKeys()).toHaveLength(1);
    expect(completedMatchKeys()).toEqual(claimedMatchKeys());
    const pushCall = updateCalls("corporations").find(
      (call) => pushOf(call.update).shareholders !== undefined
    );
    expect(pushCall).toBeDefined();
    const pushed = pushOf(pushCall!.update).shareholders as { avgCostPerShare?: number };
    expect(pushed.avgCostPerShare).toBe(10);

    const historyColl = db.collectionMocks["shareTradeHistory"]!;
    const doc = historyColl.insertOne.mock.calls[0][0];
    expect(doc.pricePerShareAnchor).toBe(10);
  });

  it("settles two matches sequentially in resolution order with one receipt each", async () => {
    const { fillPendingShareOrders } = await import("./shareOrders");
    const corpId = new ObjectId();
    const buyerA = new ObjectId();
    const buyerB = new ObjectId();
    const orderA = {
      _id: new ObjectId(),
      corporationId: corpId,
      characterId: buyerA,
      type: "buy",
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: 600,
      escrowAmount: 6000,
      status: "open",
    };
    const orderB = {
      _id: new ObjectId(),
      corporationId: corpId,
      characterId: buyerB,
      type: "buy",
      shares: 5,
      sharesRemaining: 5,
      pricePerShare: 600,
      escrowAmount: 3000,
      status: "open",
    };
    (db.collection("shareOrders").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([orderA, orderB]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    const corpDoc = {
      _id: corpId,
      name: "Test Corp",
      sharePrice: 500,
      fundamentalSharePrice: 500,
      publicFloat: 50,
      totalShares: 1_000,
      shareholders: [],
      liquidCapital: 0,
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
    (db.collection("corporations").findOne as ReturnType<typeof vi.fn>).mockResolvedValue(corpDoc);
    (db.collection("characters").find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue([
          { _id: buyerA, name: "Buyer A", countryId: "US" },
          { _id: buyerB, name: "Buyer B", countryId: "US" },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
      })),
    });

    await fillPendingShareOrders(db as unknown as Db, new Date(), 257);

    // One receipt per match, both completed, keyed by pre-fill remainder.
    const claimed = claimedMatchKeys();
    expect(claimed).toHaveLength(2);
    expect(completedMatchKeys().sort()).toEqual(claimed.sort());
    expect(claimed).toContain(`turn-share-match:257:${orderA._id.toHexString()}:10`);
    expect(claimed).toContain(`turn-share-match:257:${orderB._id.toHexString()}:5`);

    // Resolution order preserved: the first order's claim lands first.
    const orderIds = updateCalls("shareOrders").map((call) =>
      (call.filter._id as ObjectId).toHexString()
    );
    expect(orderIds[0]).toBe(orderA._id.toHexString());
    expect(orderIds[1]).toBe(orderB._id.toHexString());

    // Combined treasury effect of both fills (10 + 5 shares at 500).
    const treasuryTotal = updateCalls("corporations")
      .map((call) => incOf(call.update).liquidCapital ?? 0)
      .reduce((sum, delta) => sum + delta, 0);
    expect(treasuryTotal).toBe(7500);
  });
});
