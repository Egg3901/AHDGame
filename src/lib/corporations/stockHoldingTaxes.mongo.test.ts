/** Opt-in, owned local mongod only. No configured URI or player records are used. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, MongoClient, BSON, type Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import { migration } from "@/lib/migrations/entries/2026-10-16-stock-holding-tax-tiers";
import { updatePersonalHolding } from "./personalHoldingOps";
import { holdingCostBasis, mergeHoldingTerms, purchasedHoldingTerms } from "./rules/holdingTerms";
import { pendingStockTaxReceipt } from "./rules/stockTaxReceipt";
import {
  executeShareFillMoneyFlow,
  type ShareFillMoneyPlan,
} from "./commands/shareTrading/shareFillMoney";
import { processPlayerIncomeTax } from "@/lib/budget/playerIncomeTax";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

describe.skipIf(!REAL_MONGO_ENABLED)("real Mongo stock holding and tax settlement", () => {
  let handle: IsolatedMongod | null = null;
  let db: Db;
  let measuredClient: MongoClient;
  let measuring = false;
  let commandCount = 0,
    responseBsonBytes = 0,
    cursorCommands = 0;
  const corporationId = new ObjectId(),
    sellerId = new ObjectId(),
    buyerId = new ObjectId();
  beforeAll(async () => {
    handle = await startIsolatedMongod("ahd-stock-tax-");
    measuredClient = new MongoClient(handle.uri, { monitorCommands: true });
    await measuredClient.connect();
    db = measuredClient.db(handle.dbName);
    measuredClient.on("commandSucceeded", (event) => {
      if (measuring) {
        commandCount++;
        if (event.commandName === "getMore") cursorCommands++;
        responseBsonBytes += BSON.calculateObjectSize(event.reply as Record<string, unknown>);
      }
    });
  }, 60000);
  afterAll(async () => {
    await measuredClient?.close();
    await stopIsolatedMongod(handle);
  }, 30000);
  beforeEach(async () => {
    await db.dropDatabase();
    await db.collection("gameState").insertOne({
      _id: "current" as never,
      currentTurn: 100,
      isActive: false,
      isProcessing: false,
    });
    await db.collection("exchangeRates").insertOne({ currencyCode: "USD", rate: 2 });
    await db.collection("federalBudget").insertOne({
      _id: "federal" as never,
      countryId: "US",
      currencyCode: "USD",
      taxRates: { incomeTax: 20, incomeTaxLow: 20, incomeTaxMiddle: 20, incomeTaxHigh: 20 },
      treasuryBalance: 0,
      treasuryCashLocal: 0,
    });
    await db.collection("stateBudgets").insertOne({
      _id: "US_TEST" as never,
      countryId: "US",
      taxRates: { incomeTax: 5 },
      balance: 0,
    });
    await db
      .collection("macroMetrics")
      .insertOne({ _id: "US_TEST" as never, economic: { medianIncome: { value: 1000 } } });
    await db.collection("characters").insertMany([
      {
        _id: sellerId,
        name: "Synthetic seller",
        countryId: "US",
        homeState: "US_TEST",
        incomeTaxStartTurn: 1,
        incomeTier: "low",
        cashOnHand: 0,
      },
      {
        _id: buyerId,
        name: "Synthetic buyer",
        countryId: "US",
        homeState: "US_TEST",
        cashOnHand: 0,
      },
    ]);
    await db.collection("corporations").insertOne({
      _id: corporationId,
      countryId: "US",
      liquidCurrencyCode: "USD",
      sharePrice: 20,
      shareholders: [{ characterId: sellerId, shares: 10, avgCostPerShare: 8 }],
      totalShares: 10,
      publicFloat: 0,
    });
  });
  it("migrates native cost units and preserves inventory through concurrent purchases and exact compensation", async () => {
    await migration.execute(db, { dryRun: true });
    expect(
      (await db.collection("corporations").findOne({ _id: corporationId }))!.shareholders[0]
        .holdingTerms
    ).toBeUndefined();
    await migration.execute(db, { dryRun: false });
    const input = {
      db,
      corporationId,
      ownerId: sellerId,
      ownerKey: "characterId" as const,
      credit: true,
      shares: 5,
    };
    expect(
      await Promise.all([
        updatePersonalHolding({
          ...input,
          pricePerShare: 6,
          change: { turn: 100 },
          key: "purchase-a",
        }),
        updatePersonalHolding({
          ...input,
          pricePerShare: 8,
          change: { turn: 100 },
          key: "purchase-b",
        }),
      ])
    ).not.toContain(null);
    let holder = (await db.collection("corporations").findOne({ _id: corporationId }))!
      .shareholders[0];
    expect(holder.shares).toBe(20);
    expect(holdingCostBasis(holder.holdingTerms)).toBe(110);
    await updatePersonalHolding({
      ...input,
      credit: false,
      change: { turn: 101, remove: purchasedHoldingTerms(5, 6, 100) },
      key: "compensation-a",
    });
    await updatePersonalHolding({
      ...input,
      credit: false,
      change: { turn: 101, remove: purchasedHoldingTerms(5, 6, 100) },
      key: "compensation-a",
    });
    holder = (await db.collection("corporations").findOne({ _id: corporationId }))!.shareholders[0];
    expect(holder.shares).toBe(15);
    expect(holder.holdingTerms).toEqual({
      longTermShares: 10,
      longTermCostBasisAnchor: 40,
      shortTermLots: [{ acquiredTurn: 100, shares: 5, costBasisAnchor: 40 }],
    });
  });
  it("atomically credits both tax receipts, settles the two levies, and conserves cash under replay", async () => {
    await migration.execute(db, { dryRun: false });
    await db
      .collection("characters")
      .updateMany({}, { $set: { "currencyBalances.personal.USD": 0 } });
    await db
      .collection("corporations")
      .updateOne({ _id: corporationId }, { $set: { totalShares: 6, shareholders: [] } });
    const kinds = [
      { longTermShares: 3, longTermCostBasisAnchor: 12, shortTermLots: [] },
      purchasedHoldingTerms(3, 6, 100),
    ];
    for (const [i, terms] of kinds.entries()) {
      const receipt = pendingStockTaxReceipt({
        id: "synthetic-sale-" + i,
        currencyCode: "USD",
        holdingTerms: terms,
        proceedsAnchor: 30,
        proceedsCredited: 60,
        saleTurn: 100,
        assessmentTurn: 101,
      });
      const plan: ShareFillMoneyPlan = {
        version: 1,
        fillKey: "synthetic-fill-" + i,
        orderIdHex: new ObjectId().toHexString(),
        corpIdHex: corporationId.toHexString(),
        direction: "listing-fill",
        shares: 3,
        turn: 100,
        nowIso: new Date().toISOString(),
        fillerDebit: null,
        fillerCredit: null,
        sellerDebit: null,
        fundInventoryDebit: null,
        buyerHoldingsCredit: null,
        buyerCredit: {
          field: "characterId",
          idHex: buyerId.toHexString(),
          pricePerShare: 10,
          holdingTurn: 100,
        },
        sellerProceeds: {
          collection: "characters",
          idHex: sellerId.toHexString(),
          field: "currencyBalances.personal.USD",
          amount: 60,
          stockTaxReceipt: receipt,
        },
      };
      await executeShareFillMoneyFlow(db, plan);
      await executeShareFillMoneyFlow(db, plan);
    }
    const state = { forexEnabled: true, resetWorldId: "synthetic", stockHoldingTaxStartTurn: 100 };
    await processPlayerIncomeTax(db, 101, new Date(), state, true, true);
    await processPlayerIncomeTax(db, 101, new Date(), state, true, true);
    expect(
      (await db.collection("characters").findOne({ _id: sellerId }))!.currencyBalances.personal.USD
    ).toBe(107);
    expect((await db.collection("federalBudget").findOne({}))!.treasuryCashLocal).toBe(11);
    expect((await db.collection("stateBudgets").findOne({}))!.balance).toBe(2);
    expect(
      await db.collection("playerIncomeTaxAssessments").countDocuments({ status: "paid" })
    ).toBe(2);
    expect(
      (await db.collection("corporations").findOne({ _id: corporationId }))!.shareholders[0]
        .holdingTerms
    ).toEqual(purchasedHoldingTerms(6, 10, 100));
    expect(await db.collection("ledgerEntries").countDocuments({})).toBe(4);
    expect(mergeHoldingTerms(kinds[0], kinds[1], 148).shortTermLots).toEqual([]);
  });
  it("measures real Mongo command and response-byte scaling before and after stock taxation", async () => {
    const results = [];
    for (const active of [false, true])
      for (const players of [1, 10, 100]) {
        await db
          .collection("federalBudget")
          .updateMany({}, { $unset: { incomeTaxBatchReceipt: "" } });
        await db
          .collection("stateBudgets")
          .updateMany({}, { $unset: { incomeTaxBatchReceipt: "" } });
        await db.collection("characters").deleteMany({});
        await db.collection("financialTxLog").deleteMany({});
        await db.collection("playerIncomeTaxAssessments").deleteMany({});
        await db.collection("playerIncomeTaxBatches").deleteMany({});
        const actors = Array.from({ length: players }, (_, i) => ({
          _id: new ObjectId(),
          name: "Synthetic taxpayer",
          countryId: "US",
          homeState: "US_TEST",
          incomeTaxStartTurn: 1,
          cashOnHand: 100000,
          ...(active
            ? {
                pendingStockTaxReceipts: [
                  pendingStockTaxReceipt({
                    id: "synthetic:" + i,
                    currencyCode: "USD",
                    holdingTerms: {
                      longTermShares: 10,
                      longTermCostBasisAnchor: 900,
                      shortTermLots: [],
                    },
                    proceedsAnchor: 1000,
                    proceedsCredited: 2000,
                    saleTurn: 1,
                    assessmentTurn: 1,
                  }),
                ],
              }
            : {}),
        }));
        await db.collection("characters").insertMany(actors);
        await db.collection("financialTxLog").insertMany(
          actors.map((actor) => ({
            _id: new ObjectId(),
            subjectType: "character",
            subjectId: actor._id,
            type: "corp_salary",
            turn: 1,
            amount: 1000,
            anchorAmount: 500,
            currencyCode: "USD",
          }))
        );
        commandCount = 0;
        responseBsonBytes = 0;
        cursorCommands = 0;
        measuring = true;
        await processPlayerIncomeTax(
          db,
          1,
          new Date(),
          {
            forexEnabled: false,
            resetWorldId: "perf-" + active + "-" + players,
            ...(active ? { stockHoldingTaxStartTurn: 0 } : {}),
          },
          true
        );
        measuring = false;
        results.push({
          active,
          players,
          commands: commandCount,
          cursorCommands,
          responseBsonBytes,
        });
      }
    console.info("STOCK_TAX_MONGO_PROFILE " + JSON.stringify(results));
    for (const active of [false, true]) {
      const rows = results.filter((row) => row.active === active);
      expect(
        rows.every(
          (row) => row.commands - row.cursorCommands === rows[0].commands - rows[0].cursorCommands
        )
      ).toBe(true);
    }
  });
});
