import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-16-stock-holding-tax-tiers";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
function fixture() {
  const memory = createInMemoryDb();
  const corporationId = new ObjectId(),
    ownerId = new ObjectId(),
    orderId = new ObjectId();
  memory.seed("gameState", [
    { _id: "current", currentTurn: 100, isActive: false, isProcessing: false },
  ]);
  memory.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 2 }]);
  memory.seed("corporations", [
    {
      _id: corporationId,
      countryId: "US",
      liquidCurrencyCode: "USD",
      sharePrice: 20,
      shareholders: [{ characterId: ownerId, shares: 10 }],
    },
  ]);
  memory.seed("shareOrders", [
    {
      _id: orderId,
      corporationId,
      characterId: ownerId,
      type: "sell",
      status: "open",
      sharesRemaining: 5,
      sharesDebitedAtCreation: true,
    },
  ]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      taxRates: { incomeTax: 20, incomeTaxLow: 10, incomeTaxMiddle: 20, incomeTaxHigh: 30 },
      taxRatePhaseIn: { incomeTaxLow: 15 },
      treasuryBalance: 100,
    },
  ]);
  memory.seed("stateBudgets", [
    { _id: "US_CA", countryId: "US", taxRates: { incomeTax: 5 }, balance: 100 },
  ]);
  memory.seed("legislationTypes", [
    {
      _id: "us.tax.incomeTax",
      countryScope: "us",
      name: "Income Tax",
      taxRateChange: { scope: "federal", taxType: "incomeTax" },
      policyOptions: [{ id: "rate:20", rate: 20, budgetCost: 0 }],
    },
  ]);
  memory.seed("statePolicies", [
    {
      _id: new ObjectId(),
      scope: "national",
      stateId: "federal",
      legislationTypeId: "us.tax.incomeTax",
      policyOptionId: "rate:20",
    },
  ]);
  return { memory, db: memory as unknown as Db, corporationId, ownerId, orderId };
}
describe("stock holding tax migration", () => {
  it("dry runs without creating locks, prices, rates or holdings", async () => {
    const { memory, db } = fixture();
    const names = [
      "gameState",
      "corporations",
      "shareOrders",
      "federalBudget",
      "stateBudgets",
      "legislationTypes",
      "statePolicies",
    ];
    const before = JSON.stringify(names.map((name) => memory.collection(name).docs));
    expect((await migration.execute(db, { dryRun: true })).documentsUpdated).toBe(0);
    expect(JSON.stringify(names.map((name) => memory.collection(name).docs))).toBe(before);
  });
  it("reconstructs held and reserved basis, initializes rates and policy records, and is idempotent", async () => {
    const { db, corporationId, ownerId, orderId } = fixture();
    await db.collection("shareTradeHistory").insertOne({
      _id: new ObjectId(),
      corporationId,
      kind: "market_buy",
      turn: 1,
      createdAt: new Date(0),
      shares: 15,
      totalAnchor: 60,
      pricePerShareAnchor: 4,
      from: null,
      to: { characterId: ownerId },
    });
    await migration.execute(db, { dryRun: false });
    expect(
      (await db.collection("corporations").findOne({ _id: corporationId }))!.shareholders[0]
    ).toMatchObject({
      avgCostPerShare: 4,
      holdingTerms: { longTermShares: 10, longTermCostBasisAnchor: 40, shortTermLots: [] },
    });
    expect((await db.collection("shareOrders").findOne({ _id: orderId }))!.holdingTerms).toEqual({
      longTermShares: 5,
      longTermCostBasisAnchor: 20,
      shortTermLots: [],
    });
    expect((await db.collection("federalBudget").findOne({}))!.taxRates).toMatchObject({
      capitalGainsTaxLow: 10,
      capitalGainsTaxMiddle: 20,
      capitalGainsTaxHigh: 30,
    });
    expect(
      await db
        .collection("statePolicies")
        .findOne({ legislationTypeId: "us.tax.incomeTax__capital_low" })
    ).toMatchObject({ policyOptionId: "rate:10" });
    expect(await db.collection("legislationTypes").countDocuments({})).toBe(4);
    expect(await db.collection("gameState").findOne({})).toMatchObject({
      stockHoldingTaxStartTurn: 100,
      isProcessing: false,
      processingKind: null,
    });
    const before = await db.collection("corporations").findOne({});
    await migration.execute(db, { dryRun: false });
    expect(await db.collection("corporations").findOne({})).toEqual(before);
    expect(await db.collection("statePolicies").countDocuments({})).toBe(4);
    expect((await db.collection("federalBudget").findOne({}))!.treasuryBalance).toBe(100);
  });
  it("converts recorded issuer-local averages to anchor while preserving explicitly anchored averages", async () => {
    const { db, corporationId, ownerId } = fixture();
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporationId },
        { $set: { shareholders: [{ characterId: ownerId, shares: 10, avgCostPerShare: 8 }] } }
      );
    await migration.execute(db, { dryRun: false });
    expect((await db.collection("corporations").findOne({}))!.shareholders[0]).toMatchObject({
      avgCostPerShare: 4,
      avgCostBasisUnit: "anchor",
      holdingTerms: { longTermCostBasisAnchor: 40 },
    });
    expect(
      (await db.collection("shareOrders").findOne({}))!.holdingTerms.longTermCostBasisAnchor
    ).toBe(50);
    const anchored = fixture();
    await anchored.db.collection("corporations").updateOne(
      {},
      {
        $set: {
          shareholders: [
            {
              characterId: anchored.ownerId,
              shares: 10,
              avgCostPerShare: 8,
              avgCostBasisUnit: "anchor",
            },
          ],
        },
      }
    );
    await migration.execute(anchored.db, { dryRun: false });
    expect(
      (await anchored.db.collection("corporations").findOne({}))!.shareholders[0].holdingTerms
        .longTermCostBasisAnchor
    ).toBe(80);
  });
  it("preserves register cost and reconstructs distinct reserved cost from complete history", async () => {
    const { db, corporationId, ownerId } = fixture();
    await db.collection("corporations").updateOne(
      {},
      {
        $set: {
          shareholders: [{ characterId: ownerId, shares: 20, avgCostPerShare: 30 }],
        },
      }
    );
    await db.collection("shareOrders").updateOne({}, { $set: { sharesRemaining: 10 } });
    for (const [turn, shares, totalAnchor] of [
      [1, 20, 200],
      [2, 10, 200],
    ]) {
      await db.collection("shareTradeHistory").insertOne({
        _id: new ObjectId(),
        corporationId,
        kind: "market_buy",
        turn,
        createdAt: new Date(turn),
        shares,
        totalAnchor,
        pricePerShareAnchor: totalAnchor / shares,
        from: null,
        to: { characterId: ownerId },
      });
    }
    await migration.execute(db, { dryRun: false });
    expect(
      (await db.collection("corporations").findOne({}))!.shareholders[0].holdingTerms
        .longTermCostBasisAnchor
    ).toBe(300);
    expect(
      (await db.collection("shareOrders").findOne({}))!.holdingTerms.longTermCostBasisAnchor
    ).toBe(100);
  });
  it("grandfathers listing escrow and blocks migration when a private fill owns the listing", async () => {
    const { db, corporationId, ownerId } = fixture();
    const listingId = new ObjectId();
    await db.collection("shareListings").insertOne({
      _id: listingId,
      corporationId,
      sellerCharacterId: ownerId,
      sharesRemaining: 3,
      status: "open",
      activeShareFillKey: "pending-fill",
    });
    await expect(migration.execute(db, { dryRun: true })).rejects.toThrow("pending listing fills");
    await db
      .collection("shareListings")
      .updateOne({ _id: listingId }, { $unset: { activeShareFillKey: "" } });
    await migration.execute(db, { dryRun: false });
    expect((await db.collection("shareListings").findOne({}))!.holdingTerms).toEqual({
      longTermShares: 3,
      longTermCostBasisAnchor: 30,
      shortTermLots: [],
    });
  });
  it("preserves recorded zero basis and independently legislated zero tax rates", async () => {
    const { db, corporationId, ownerId } = fixture();
    await db
      .collection("corporations")
      .updateOne(
        { _id: corporationId },
        { $set: { shareholders: [{ characterId: ownerId, shares: 10, avgCostPerShare: 0 }] } }
      );
    await db
      .collection("federalBudget")
      .updateOne({}, { $set: { "taxRates.capitalGainsTaxLow": 0 } });
    await migration.execute(db, { dryRun: false });
    expect(
      (await db.collection("corporations").findOne({}))!.shareholders[0].holdingTerms
        .longTermCostBasisAnchor
    ).toBe(0);
    expect((await db.collection("federalBudget").findOne({}))!.taxRates.capitalGainsTaxLow).toBe(0);
  });
  it("reuses the frozen anchor rollout price after interrupted application", async () => {
    const { memory, db } = fixture();
    const collection = memory.collection("corporations");
    const original = collection.bulkWrite.bind(collection);
    let failed = false;
    vi.spyOn(collection, "bulkWrite").mockImplementation(async (ops) => {
      if (!failed && JSON.stringify(ops).includes('"holdingTerms"')) {
        failed = true;
        throw new Error("Interrupted holdings write");
      }
      return original(ops);
    });
    await expect(migration.execute(db, { dryRun: false })).rejects.toThrow("Interrupted");
    expect(await db.collection("gameState").findOne({})).toMatchObject({
      isProcessing: false,
      processingKind: "stockTaxMigration",
    });
    expect(
      (await db.collection("gameState").findOne({}))!.stockHoldingTaxStartTurn
    ).toBeUndefined();
    await db.collection("corporations").updateOne({}, { $set: { sharePrice: 1000 } });
    await migration.execute(db, { dryRun: false });
    expect(
      (await db.collection("corporations").findOne({}))!.shareholders[0].holdingTerms
        .longTermCostBasisAnchor
    ).toBe(100);
  });
  it("rejects application while the world or a turn is running", async () => {
    const { db } = fixture();
    await db.collection("gameState").updateOne({}, { $set: { isActive: true } });
    await expect(migration.execute(db, { dryRun: false })).rejects.toThrow("Pause");
    await db
      .collection("gameState")
      .updateOne({}, { $set: { isActive: false, isProcessing: true, processingKind: "turn" } });
    await expect(migration.execute(db, { dryRun: false })).rejects.toThrow("Pause");
    expect((await db.collection("gameState").findOne({}))!.processingKind).toBe("turn");
  });
});
