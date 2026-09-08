import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { snapshotMoneySupply } from "./snapshot";
import { executeMonetaryOperation } from "./operations";
import { processSavingsInterestTurn } from "@/lib/turn/savingsInterestTurn";
import { monetizeUnsoldSovereignUnits } from "@/lib/bonds/primaryMarket";

function world() {
  const db = createInMemoryDb();
  const snapshots = db.collection("moneySupplySnapshots");
  Object.assign(snapshots, {
    replaceOne: (
      filter: Record<string, unknown>,
      doc: Record<string, unknown>,
      options: { upsert?: boolean }
    ) => snapshots.updateOne(filter, { $set: doc }, options),
  });
  db.seed("gameConfig", [
    { _id: "default", moneySupplyEnabled: true, privateBankingEnabled: true },
  ]);
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", externalBroadMoney: 1000, netMoneyCreatedLifetime: 0 },
  ]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      treasuryBalance: 100,
      gdp: 100000,
      debt: { principal: 0 },
    },
  ]);
  return db;
}
async function observe(db: ReturnType<typeof world>, turn: number) {
  await snapshotMoneySupply(db as unknown as Db, turn);
  return db.collection("moneySupplySnapshots").docs.find((row) => row._id === `${turn}:USD`)!;
}

describe("monetary stock boundaries", () => {
  it("does not create measured money when population income changes without a payment", async () => {
    const db = world();
    db.seed("states", [{ _id: "CA", countryId: "US", population: 3200 }]);
    db.seed("macroMetrics", [{ _id: "CA", economic: { medianIncome: { value: 100 } } }]);
    const before = await observe(db, 0);
    await db
      .collection("macroMetrics")
      .updateOne({ _id: "CA" }, { $set: { "economic.medianIncome.value": 200 } });
    const after = await observe(db, 1);
    expect(after.m2).toBe(before.m2);
  });

  it("counts a QE payment to the bond pool once", async () => {
    const db = world();
    const id = new ObjectId();
    db.seed("bonds", [
      {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        matured: false,
        defaulted: false,
        publicFloat: 10,
        centralBankHoldings: 0,
        totalIssued: 10000,
        marketPrice: 1,
      },
    ]);
    const before = await observe(db, 0);
    const operation = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "qe",
      turn: 1,
      actorName: "Test chair",
      bondId: id.toHexString(),
      units: 1,
    });
    const after = await observe(db, 1);
    expect(Number(after.m2) - Number(before.m2)).toBeCloseTo(operation.amount);
  });

  it("keeps an external-pool to NPC-deposit transfer neutral", async () => {
    const db = world();
    const before = await observe(db, 0);
    await db
      .collection("centralBanks")
      .updateOne({ _id: "US" }, { $inc: { externalBroadMoney: -100 } });
    db.seed("corporations", [
      {
        _id: new ObjectId(),
        countryId: "US",
        liquidCapital: 0,
        bankCharter: { status: "active", currency: "USD", npcDeposits: 100, totalDeposits: 100 },
      },
    ]);
    const after = await observe(db, 1);
    expect(after.m2).toBe(before.m2);
  });

  it("counts a positive-treasury advance at its destination once", async () => {
    const db = world();
    const before = await observe(db, 0);
    await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "treasury_advance",
      amount: 100,
      turn: 1,
      actorName: "Test chair",
    });
    const after = await observe(db, 1);
    expect(Number(after.m2) - Number(before.m2)).toBe(100);
  });

  it("does not turn a central-bank reserve advance into circulating deposits", async () => {
    const db = world();
    db.seed("corporations", [
      {
        _id: new ObjectId(),
        name: "Test bank",
        countryId: "US",
        liquidCapital: 100,
        bankCharter: {
          status: "active",
          currency: "USD",
          cashReserves: 100,
          totalDeposits: 0,
          npcDeposits: 0,
        },
      },
    ]);
    const before = await observe(db, 0);
    await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "liquidity_injection",
      amount: 100,
      turn: 1,
      actorName: "Test chair",
    });
    const after = await observe(db, 1);
    expect(after.m2).toBe(before.m2);
  });
  it("starts a new observation window instead of annualizing the accounting transition", async () => {
    const db = world();
    db.seed("moneySupplySnapshots", [{ _id: "0:USD", currencyCode: "USD", turn: 0, m2: 10 }]);
    const first = await observe(db, 100);
    expect(first.accountingVersion).toBe(2);
    expect(first.annualizedM2GrowthPct).toBeNull();
    expect((await observe(db, 111)).annualizedM2GrowthPct).toBeNull();
    expect((await observe(db, 112)).annualizedM2GrowthPct).toBe(0);
    expect(db.collection("moneySupplySnapshots").docs[0].m2).toBe(10);
  });

  it("retires QT money from the paying bond pool even when external deposits are empty", async () => {
    const db = world();
    await db
      .collection("centralBanks")
      .updateOne({ _id: "US" }, { $set: { externalBroadMoney: 0 } });
    const id = new ObjectId();
    db.seed("bonds", [
      {
        _id: id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        matured: false,
        defaulted: false,
        publicFloat: 0,
        centralBankHoldings: 1,
        totalIssued: 1000,
        marketPrice: 1,
      },
    ]);
    db.seed("bondMarketPools", [{ _id: "USD", cashLocal: 1000 }]);
    const before = await observe(db, 0);
    const operation = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "qt",
      turn: 1,
      actorName: "Test chair",
      bondId: id.toHexString(),
      units: 1,
    });
    const after = await observe(db, 1);
    expect(Number(after.m2) - Number(before.m2)).toBe(-operation.amount);
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(0);
  });

  it("counts credited central-bank savings interest once", async () => {
    const db = world();
    db.seed("characters", [
      {
        _id: new ObjectId(),
        name: "Synthetic saver",
        countryId: "US",
        currencyBalances: {
          savings: { USD: 1000 },
          pendingSavingsInterest: { USD: 10 },
          savingsHolder: { USD: "centralBank" },
        },
      },
    ]);
    const before = await observe(db, 0);
    const result = await processSavingsInterestTurn(db as unknown as Db, 12);
    const after = await observe(db, 12);
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(Number(after.m2) - Number(before.m2)).toBeCloseTo(result.totalInterest);
    expect(db.collection("centralBanks").docs[0].externalBroadMoney).toBe(1000);
  });

  it("retains the single external cash destination for primary monetization", async () => {
    const db = world();
    const id = new ObjectId();
    db.seed("bonds", [{ _id: id, unsoldUnits: 1, centralBankHoldings: 0, totalIssued: 0 }]);
    const before = await observe(db, 0);
    expect(
      await monetizeUnsoldSovereignUnits(db as unknown as Db, {
        bondId: id,
        bank: { _id: "US" },
        units: 1,
        considerationLocal: 1000,
        turn: 1,
        now: new Date(),
      })
    ).toBe(true);
    expect(Number((await observe(db, 1)).m2) - Number(before.m2)).toBe(1000);
  });

  it("reports only newly positive cash when a treasury advance crosses a deficit", async () => {
    const db = world();
    await db
      .collection("federalBudget")
      .updateOne({ _id: "federal" }, { $set: { treasuryBalance: -50, "debt.principal": 50 } });
    const before = await observe(db, 0);
    const operation = await executeMonetaryOperation(db as unknown as Db, {
      countryId: "US",
      type: "treasury_advance",
      amount: 100,
      turn: 1,
      actorName: "Test chair",
    });
    expect(operation.moneySupplyDelta).toBe(50);
    expect(Number((await observe(db, 1)).m2) - Number(before.m2)).toBe(50);
  });
});
