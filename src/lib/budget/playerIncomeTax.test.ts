import { describe, expect, it, vi } from "vitest";
import type { Character } from "@/lib/db/types";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { processPlayerIncomeTax } from "./playerIncomeTax";
import { settlePlayerIncomeTaxAssessments } from "./playerIncomeTaxSettlement";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function fixture() {
  const memory = createInMemoryDb();
  const id = new ObjectId();
  memory.seed("characters", [
    {
      _id: id,
      name: "Test Taxpayer",
      countryId: "US",
      homeState: "US_CA",
      incomeTier: "low",
      initialIncomeTier: "low",
      incomeTaxStartTurn: 1,
      cashOnHand: 10000,
      currencyBalances: { personal: { USD: 10000 }, savings: { USD: 1000 } },
    },
  ]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      taxRates: { incomeTax: 20, incomeTaxLow: 10, incomeTaxMiddle: 20, incomeTaxHigh: 30 },
      treasuryBalance: 100,
      treasuryCashLocal: 100,
    },
  ]);
  memory.seed("stateBudgets", [
    { _id: "US_CA", countryId: "US", taxRates: { incomeTax: 5 }, balance: 10 },
  ]);
  memory.seed("macroMetrics", [{ _id: "US_CA", economic: { medianIncome: { value: 1000 } } }]);
  memory.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  memory.seed("financialTxLog", [
    {
      _id: new ObjectId(),
      subjectId: id,
      subjectType: "character",
      type: "corp_salary",
      turn: 1,
      amount: 100,
      currencyCode: "USD",
      anchorAmount: 100,
    },
  ]);
  return { memory, db: memory as unknown as Db, id };
}
const now = new Date("2026-10-16T00:00:00Z");
const state = { forexEnabled: true, resetWorldId: "test-world", stockHoldingTaxStartTurn: 0 };
async function seedStockTaxCredit(db: Db, id: ObjectId, assessmentTurn: number) {
  await db.collection<Character>("characters").updateOne(
    { _id: id },
    {
      $push: {
        pendingStockTaxReceipts: {
          id: "synthetic-sale",
          saleTurn: 1,
          version: 1 as const,
          assessmentTurn,
          incomeAmount: 0,
          capitalAmount: 1000,
          amount: 10000,
          anchorAmount: 10000,
          currencyCode: "USD",
          costBasisAnchor: 9000,
        },
      },
    }
  );
}
describe("player income-tax settlement", () => {
  it("retains a frozen stock assessment through a failed publication", async () => {
    const { memory, db, id } = fixture();
    await seedStockTaxCredit(db, id, 1);
    const collection = memory.collection("playerIncomeTaxAssessments");
    const original = collection.bulkWrite.bind(collection);
    let failed = false;
    vi.spyOn(collection, "bulkWrite").mockImplementation(async (ops) => {
      if (
        !failed &&
        JSON.stringify(ops).includes('"taxKind":"capitalGains"') &&
        !JSON.stringify(ops).includes('"status":"plan"')
      ) {
        failed = true;
        throw new Error("Publication failed");
      }
      return original(ops);
    });
    await expect(processPlayerIncomeTax(db, 1, now, state, true)).rejects.toThrow("Publication");
    expect(
      (await db.collection("characters").findOne({ _id: id }))!.pendingStockTaxReceipts
    ).toHaveLength(1);
    await processPlayerIncomeTax(db, 1, now, state, true);
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .countDocuments({ taxKind: "capitalGains", status: "paid" })
    ).toBe(1);
  });
  it("retains short-term earnings for tier selection without assessing the sale twice, then expires the history", async () => {
    const { db, id } = fixture();
    await db.collection("financialTxLog").deleteMany({});
    await seedStockTaxCredit(db, id, 1);
    await db.collection<Character>("characters").updateOne(
      { _id: id },
      {
        $set: {
          "pendingStockTaxReceipts.0.incomeAmount": 1000,
          "pendingStockTaxReceipts.0.capitalAmount": 0,
        },
      }
    );
    await processPlayerIncomeTax(db, 1, now, state, true);
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      type: "corp_salary",
      subjectType: "character",
      subjectId: id,
      turn: 2,
      amount: 1,
      anchorAmount: 1,
      currencyCode: "USD",
    });
    await processPlayerIncomeTax(db, 2, now, state, true);
    expect((await db.collection("characters").findOne({ _id: id }))!.incomeTier).toBe("high");
    const second = await db
      .collection("playerIncomeTaxAssessments")
      .findOne({ turn: 2, status: { $ne: "plan" } });
    expect(second!.gross).toBe(1);
    expect(
      await db.collection("financialTxLog").countDocuments({ type: "player_income_tax" })
    ).toBe(1);
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      type: "corp_salary",
      subjectType: "character",
      subjectId: id,
      turn: 13,
      amount: 1,
      anchorAmount: 1,
      currencyCode: "USD",
    });
    await processPlayerIncomeTax(db, 13, now, state, true);
    expect((await db.collection("characters").findOne({ _id: id }))!.incomeTier).toBe("low");
    expect(
      (await db.collection("characters").findOne({ _id: id }))!.pendingStockTaxReceipts
    ).toEqual([]);
  });
  it("collects a delayed wallet credit after its due-turn plan was already frozen, exactly once", async () => {
    const { db, id } = fixture();
    await processPlayerIncomeTax(db, 1, now, state, true);
    await seedStockTaxCredit(db, id, 1);
    await processPlayerIncomeTax(db, 2, now, state, true);
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .countDocuments({ taxKind: "capitalGains", status: "paid" })
    ).toBe(1);
    const paid = (await db.collection("characters").findOne({ _id: id }))!.currencyBalances.personal
      .USD;
    await processPlayerIncomeTax(db, 3, now, state, true);
    expect(
      (await db.collection("characters").findOne({ _id: id }))!.currencyBalances.personal.USD
    ).toBe(paid);
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .countDocuments({ taxKind: "capitalGains", status: "paid" })
    ).toBe(1);
  });
  it("collects the correct anchor-wallet amount and native treasury receipts with forex disabled", async () => {
    const { db, id } = fixture();
    await db.collection("financialTxLog").deleteMany({});
    await db.collection("exchangeRates").updateOne({}, { $set: { rate: 2 } });
    await db
      .collection("federalBudget")
      .updateOne({}, { $set: { "taxRates.capitalGainsTaxLow": 20 } });
    await seedStockTaxCredit(db, id, 1);
    await processPlayerIncomeTax(db, 1, now, { ...state, forexEnabled: false }, true);
    const actor = (await db.collection("characters").findOne({ _id: id }))!;
    expect(actor.cashOnHand).toBe(9750);
    expect(actor.currencyBalances.personal.USD).toBe(10000);
    expect((await db.collection("federalBudget").findOne({}))!.treasuryCashLocal).toBe(500);
    expect((await db.collection("stateBudgets").findOne({}))!.balance).toBe(110);
    expect(
      await db.collection("playerIncomeTaxAssessments").findOne({ taxKind: "capitalGains" })
    ).toMatchObject({ gross: 2000, federal: 400, regional: 100, sourceFx: 2, walletFx: 1 });
    await processPlayerIncomeTax(db, 1, now, { ...state, forexEnabled: false }, true);
    expect((await db.collection("characters").findOne({ _id: id }))!.cashOnHand).toBe(9750);
  });
  it.each([
    { id: "" },
    { amount: Infinity },
    { anchorAmount: -1 },
    { saleTurn: 2 },
    { incomeAmount: 10001 },
  ])("fails closed on an invalid durable credit: %j", async (patch) => {
    const { db, id } = fixture();
    await seedStockTaxCredit(db, id, 1);
    await db.collection("characters").updateOne(
      { _id: id },
      {
        $set: Object.fromEntries(
          Object.entries(patch).map(([key, value]) => ["pendingStockTaxReceipts.0." + key, value])
        ),
      }
    );
    await expect(processPlayerIncomeTax(db, 1, now, state, true)).rejects.toThrow(/stock tax/i);
    expect(await db.collection("playerIncomeTaxAssessments").countDocuments({})).toBe(0);
  });
  it.each([
    { salary: 10, tier: "low", rate: 7 },
    { salary: 25, tier: "middle", rate: 17 },
    { salary: 100, tier: "high", rate: 27 },
  ])(
    "collects long-term gains using the $tier tier without taxing principal or inflating earned income",
    async ({ salary, tier, rate }) => {
      const { db, id } = fixture();
      await db
        .collection("financialTxLog")
        .updateOne({ type: "corp_salary" }, { $set: { amount: salary, anchorAmount: salary } });
      await db.collection("federalBudget").updateOne(
        {},
        {
          $set: {
            "taxRates.capitalGainsTaxLow": 7,
            "taxRates.capitalGainsTaxMiddle": 17,
            "taxRates.capitalGainsTaxHigh": 27,
          },
        }
      );
      await db.collection("stateBudgets").updateOne(
        {},
        {
          $set: {
            "taxRates.capitalGainsTaxLow": 2,
            "taxRates.capitalGainsTaxMiddle": 2,
            "taxRates.capitalGainsTaxHigh": 2,
          },
        }
      );
      await db.collection("financialTxLog").insertOne({
        _id: new ObjectId(),
        type: "stock_trade_sell",
        subjectType: "character",
        subjectId: id,
        turn: 1,
        amount: 10000,
        currencyCode: "USD",
        meta: {
          stockTax: {
            version: 1,
            assessmentTurn: 1,
            incomeAmount: 0,
            capitalAmount: 1000,
            costBasisAnchor: 9000,
          },
        },
      });
      await seedStockTaxCredit(db, id, 1);
      await processPlayerIncomeTax(db, 1, now, state, true, true);
      await processPlayerIncomeTax(db, 1, now, state, true, true);
      const capital = await db
        .collection("playerIncomeTaxAssessments")
        .findOne({ taxKind: "capitalGains", status: "paid" });
      expect(capital).toMatchObject({ tier, gross: 1000, federal: rate * 10, regional: 20 });
      expect(
        await db.collection("financialTxLog").countDocuments({ type: "player_capital_gains_tax" })
      ).toBe(1);
      expect((await db.collection("characters").findOne({ _id: id }))!.incomeTier).toBe(tier);
      const incomeRate = tier === "low" ? 10 : tier === "middle" ? 20 : 30;
      expect((await db.collection("federalBudget").findOne({}))!.treasuryCashLocal).toBe(
        100 + Math.floor((salary * incomeRate) / 100) + rate * 10
      );
      expect(
        await db.collection("ledgerEntries").countDocuments({ txType: "player_capital_gains_tax" })
      ).toBe(2);
    }
  );
  it("assesses an API sale on the following turn and retains unpaid capital gains", async () => {
    const { db, id } = fixture();
    await processPlayerIncomeTax(db, 1, now, state, true);
    await db
      .collection("characters")
      .updateOne({ _id: id }, { $set: { "currencyBalances.personal.USD": 0 } });
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      type: "stock_trade_sell",
      subjectType: "character",
      subjectId: id,
      turn: 1,
      amount: 10000,
      currencyCode: "USD",
      meta: { stockTax: { version: 1, assessmentTurn: 2, incomeAmount: 0, capitalAmount: 1000 } },
    });
    await seedStockTaxCredit(db, id, 2);
    await processPlayerIncomeTax(db, 1, now, state, true);
    expect(
      await db.collection("playerIncomeTaxAssessments").countDocuments({ taxKind: "capitalGains" })
    ).toBe(0);
    await processPlayerIncomeTax(db, 2, now, state, true);
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .countDocuments({ taxKind: "capitalGains", status: "unpaid" })
    ).toBe(1);
    await db
      .collection("characters")
      .updateOne({ _id: id }, { $set: { "currencyBalances.personal.USD": 1000 } });
    await processPlayerIncomeTax(db, 3, now, state, true);
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .countDocuments({ taxKind: "capitalGains", status: "paid" })
    ).toBe(1);
  });
  it("splits direct dividends while leaving index-fund dividends taxable as income", async () => {
    const { db, id } = fixture();
    await db
      .collection("federalBudget")
      .updateOne({}, { $set: { "taxRates.capitalGainsTaxHigh": 7 } });
    await db.collection("financialTxLog").insertMany([
      {
        _id: new ObjectId(),
        type: "corp_dividend",
        subjectType: "character",
        subjectId: id,
        turn: 1,
        amount: 100,
        currencyCode: "USD",
        meta: { stockTax: { version: 1, assessmentTurn: 1, incomeAmount: 40, capitalAmount: 60 } },
      },
      {
        _id: new ObjectId(),
        type: "index_fund_dividend",
        subjectType: "character",
        subjectId: id,
        turn: 1,
        amount: 100,
        currencyCode: "USD",
      },
      {
        _id: new ObjectId(),
        type: "stock_trade_sell",
        subjectType: "character",
        subjectId: id,
        turn: 1,
        amount: 5000,
        currencyCode: "USD",
      },
    ]);
    await processPlayerIncomeTax(db, 1, now, state, true);
    expect(
      await db.collection("playerIncomeTaxAssessments").findOne({ taxKind: "capitalGains" })
    ).toMatchObject({ gross: 60, federal: 4 });
    expect(
      await db
        .collection("playerIncomeTaxAssessments")
        .findOne({ status: "paid", taxKind: { $exists: false } })
    ).toMatchObject({ gross: 240, federal: 72 });
  });
  it("reuses the frozen assessment after a failed publication and a residency change", async () => {
    const { memory, db, id } = fixture();
    const collection = memory.collection("playerIncomeTaxAssessments");
    const original = collection.bulkWrite.bind(collection);
    let failed = false;
    vi.spyOn(collection, "bulkWrite").mockImplementation(async (ops) => {
      if (
        !failed &&
        JSON.stringify(ops).includes('"status":"unpaid"') &&
        !JSON.stringify(ops).includes('"status":"plan"')
      ) {
        failed = true;
        throw new Error("Assessment publication unavailable");
      }
      return original(ops);
    });
    await expect(processPlayerIncomeTax(db, 1, now, state, true)).rejects.toThrow("publication");
    await db
      .collection("characters")
      .updateOne({ _id: id }, { $set: { countryId: "BR", homeState: "BR_SP" } });
    await processPlayerIncomeTax(db, 1, now, state, true);
    await processPlayerIncomeTax(db, 1, now, state, true);
    expect(
      await db.collection("playerIncomeTaxAssessments").countDocuments({ status: "paid" })
    ).toBe(1);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
    expect(
      (await db.collection("characters").findOne({ _id: id }))?.currencyBalances.personal.USD
    ).toBe(9965);
  });
  it("taxes imperial player income through the correct wallet collection", async () => {
    const { db } = fixture();
    const royalId = new ObjectId();
    await db.collection("imperialCharacters").insertOne({
      _id: royalId,
      name: "Synthetic royal",
      countryId: "US",
      homeState: "US_CA",
      incomeTaxStartTurn: 1,
      initialIncomeTier: "high",
      incomeTier: "high",
      currencyBalances: { personal: { USD: 100 } },
    });
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      subjectId: royalId,
      subjectType: "character",
      type: "corp_dividend",
      turn: 1,
      amount: 100,
      currencyCode: "USD",
      meta: { imperial: true },
    });
    expect(await processPlayerIncomeTax(db, 1, now, state, true)).toEqual({
      assessed: 2,
      pending: 0,
    });
    expect(
      (await db.collection("imperialCharacters").findOne({ _id: royalId }))?.currencyBalances
        .personal.USD
    ).toBe(65);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(160);
  });
  it.each(["characters", "federalBudget"])(
    "recovers an applied write with a lost acknowledgement in %s",
    async (collectionName) => {
      const { memory, db } = fixture();
      const collection = memory.collection(collectionName);
      const original = collection.bulkWrite.bind(collection);
      let failed = false;
      vi.spyOn(collection, "bulkWrite").mockImplementation(async (ops) => {
        const result = await original(ops);
        if (!failed && JSON.stringify(ops).includes("incomeTaxBatchReceipt")) {
          failed = true;
          throw new Error("Lost acknowledgement");
        }
        return result;
      });
      await expect(processPlayerIncomeTax(db, 1, now, state, true)).rejects.toThrow(
        "Lost acknowledgement"
      );
      await processPlayerIncomeTax(db, 1, now, state, true);
      expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(
        9965
      );
      expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
      expect(
        await db.collection("financialTxLog").countDocuments({ type: "player_income_tax" })
      ).toBe(1);
    }
  );
  it("does not let an unfunded taxpayer block a funded taxpayer", async () => {
    const { db, id } = fixture();
    await db
      .collection("characters")
      .updateOne({ _id: id }, { $set: { "currencyBalances.personal.USD": 0 } });
    const otherId = new ObjectId();
    await db.collection("characters").insertOne({
      _id: otherId,
      name: "Second taxpayer",
      countryId: "US",
      homeState: "US_CA",
      incomeTaxStartTurn: 1,
      currencyBalances: { personal: { USD: 100 } },
    });
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      subjectId: otherId,
      subjectType: "character",
      type: "corp_salary",
      turn: 1,
      amount: 100,
      currencyCode: "USD",
    });
    expect(await processPlayerIncomeTax(db, 1, now, state, true)).toEqual({
      assessed: 2,
      pending: 1,
    });
    expect(
      (await db.collection("characters").findOne({ _id: otherId }))?.currencyBalances.personal.USD
    ).toBe(65);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
  });
  it("taxes the actual foreign-coupon conversion without treating returned principal as income", async () => {
    const { db, id } = fixture();
    await db.collection("financialTxLog").deleteMany({});
    await db
      .collection<{ _id: string; currencyCode: string; rate: number }>("exchangeRates")
      .insertOne({ _id: "JPY", currencyCode: "JPY", rate: 200 });
    await db.collection("financialTxLog").insertMany([
      {
        _id: new ObjectId(),
        subjectId: id,
        subjectType: "character",
        type: "bond_coupon",
        turn: 1,
        amount: 10000,
        anchorAmount: 100,
        currencyCode: "JPY",
      },
      {
        _id: new ObjectId(),
        subjectId: id,
        subjectType: "character",
        type: "bond_maturity",
        turn: 1,
        amount: 90000,
        currencyCode: "JPY",
      },
    ]);
    await db.collection("tradeHistory").insertOne({
      _id: new ObjectId(),
      buyerCharacterId: id,
      turn: 1,
      source: "auto_coupon",
      fromCurrency: "JPY",
      toCurrency: "USD",
      amount: 100000,
      receivedAmount: 1000,
      spread: 0,
      rate: 0.01,
    });
    await processPlayerIncomeTax(db, 1, now, state, true);
    const assessment = await db
      .collection("playerIncomeTaxAssessments")
      .findOne({ status: "paid" });
    expect(assessment).toMatchObject({
      currency: "USD",
      gross: 100,
      federal: 30,
      regional: 5,
      net: 65,
    });
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(
      9965
    );
  });
  it("publishes balanced, retry-safe shadow evidence for fiscal position and funded cash", async () => {
    const { db } = fixture();
    await processPlayerIncomeTax(db, 1, now, state, true, true);
    await processPlayerIncomeTax(db, 1, now, state, true, true);
    const ledger = await db.collection("ledgerEntries").find({}).toArray();
    expect(ledger).toHaveLength(2);
    for (const entry of ledger)
      expect(
        entry.legs.reduce((sum: number, leg: { anchorAmount: number }) => sum + leg.anchorAmount, 0)
      ).toBeCloseTo(0, 10);
  });
  it("records tier from earnings, transfers cash and replays without another charge", async () => {
    const { memory, db } = fixture();
    expect(await processPlayerIncomeTax(db, 1, now, state, true)).toEqual({
      assessed: 1,
      pending: 0,
    });
    const char = await db.collection("characters").findOne({});
    expect(char?.incomeTier).toBe("high");
    expect(char?.initialIncomeTier).toBe("low");
    expect(char?.currencyBalances.personal.USD).toBe(9965);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryBalance).toBe(130);
    expect((await db.collection("stateBudgets").findOne({}))?.balance).toBe(15);
    expect(await processPlayerIncomeTax(db, 1, now, state, true)).toEqual({
      assessed: 0,
      pending: 0,
    });
    expect(
      memory.collection("financialTxLog").docs.filter((row) => row.type === "player_income_tax")
    ).toHaveLength(1);
  });
  it("keeps an unfunded assessment pending and recovers it once cash arrives", async () => {
    const { db } = fixture();
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 0 } });
    expect((await processPlayerIncomeTax(db, 1, now, state, true)).pending).toBe(1);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(100);
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 100 } });
    expect((await processPlayerIncomeTax(db, 2, now, state, true)).pending).toBe(0);
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(65);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
  });
  it("revisits affordable older debt while fresh taxable income keeps arriving", async () => {
    const { db, id } = fixture();
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 0 } });
    expect((await processPlayerIncomeTax(db, 1, now, state, true)).pending).toBe(1);
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 100 } });
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      subjectId: id,
      subjectType: "character",
      type: "corp_salary",
      turn: 2,
      amount: 100,
      anchorAmount: 100,
      currencyCode: "USD",
    });
    expect((await processPlayerIncomeTax(db, 2, now, state, true)).pending).toBe(0);
    await processPlayerIncomeTax(db, 2, now, state, true);
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(30);
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(160);
    expect((await db.collection("stateBudgets").findOne({}))?.balance).toBe(20);
    const receipts = await db
      .collection("financialTxLog")
      .find({ type: "player_income_tax" })
      .toArray();
    expect(receipts).toHaveLength(2);
    expect(receipts.every((row) => row.turn === 2)).toBe(true);
    expect(receipts.map((row) => row.meta.assessedTurn).sort()).toEqual([1, 2]);
  });
  it("wraps a full debt scan without starving an older funded liability", async () => {
    const { db } = fixture();
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 0 } });
    await processPlayerIncomeTax(db, 1, now, state, true);
    const old = await db.collection("playerIncomeTaxAssessments").findOne({ status: "unpaid" });
    const unfundedId = new ObjectId();
    await db
      .collection<{ _id: string; characterId: ObjectId }>("playerIncomeTaxAssessments")
      .insertMany(
        Array.from({ length: 1001 }, (_, index) => ({
          ...old,
          _id: "z:" + String(index).padStart(4, "0"),
          characterId: unfundedId,
        }))
      );
    await settlePlayerIncomeTaxAssessments(db, 2, now, state.resetWorldId, true, false, 60);
    expect(
      (await db.collection("playerIncomeTaxAssessments").findOne({ _id: old!._id }))?.status
    ).toBe("unpaid");
    await db
      .collection("characters")
      .updateOne({}, { $set: { "currencyBalances.personal.USD": 100 } });
    await settlePlayerIncomeTaxAssessments(db, 3, now, state.resetWorldId, true, false, 60);
    expect(
      (await db.collection("playerIncomeTaxAssessments").findOne({ _id: old!._id }))?.status
    ).toBe("paid");
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(65);
    expect(
      await db.collection("financialTxLog").countDocuments({ type: "player_income_tax" })
    ).toBe(1);
  });
  it("exempts transfers and principal and never retroactively taxes pre-rollout earnings", async () => {
    const { db, id } = fixture();
    await db.collection("characters").updateOne({}, { $set: { incomeTaxStartTurn: 2 } });
    await db.collection("financialTxLog").insertMany(
      ["wire_transfer_in", "loc_draw", "bond_maturity", "index_fund_redeem"].map((type) => ({
        _id: new ObjectId(),
        subjectId: id,
        subjectType: "character",
        type,
        turn: 2,
        amount: 10000,
        currencyCode: "USD",
      }))
    );
    expect(await processPlayerIncomeTax(db, 2, now, state, true)).toEqual({
      assessed: 0,
      pending: 0,
    });
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(
      10000
    );
  });
  it("collects savings-interest tax without changing the bank deposit principal", async () => {
    const { db, id } = fixture();
    await db.collection("financialTxLog").insertOne({
      _id: new ObjectId(),
      subjectId: id,
      subjectType: "character",
      type: "savings_interest",
      turn: 1,
      amount: 100,
      currencyCode: "USD",
    });
    await processPlayerIncomeTax(db, 1, now, state, true);
    expect((await db.collection("characters").findOne({}))?.currencyBalances.savings.USD).toBe(
      1000
    );
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(
      9930
    );
  });
  it("concurrent attempts cannot double-charge or duplicate treasury receipts", async () => {
    const { db } = fixture();
    await Promise.all([
      processPlayerIncomeTax(db, 1, now, state, true),
      processPlayerIncomeTax(db, 1, now, state, true),
    ]);
    expect((await db.collection("characters").findOne({}))?.currencyBalances.personal.USD).toBe(
      9965
    );
    expect((await db.collection("federalBudget").findOne({}))?.treasuryCashLocal).toBe(130);
  });
});
