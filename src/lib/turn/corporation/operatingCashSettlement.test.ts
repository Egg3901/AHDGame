import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import type { CorpSnapshot } from "./types";
import { settleCorporateOperatingCash } from "./operatingCashSettlement";

function snapshot(
  corpId: ObjectId,
  input: Pick<
    CorpSnapshot,
    | "operatingCashIncomeLocal"
    | "operatingCashCurrency"
    | "operatingCashLocalPerAnchor"
    | "federalTaxByCountryAnchor"
  >
): CorpSnapshot {
  return {
    corpId,
    revenue: 100,
    totalCosts: 0,
    incomePreDividends: 80,
    income: 80,
    perTurnBondCouponIncome: 0,
    perTurnBondInterestExpense: 0,
    perTurnBondDragOnNetIncome: 0,
    liquidCapitalAnchorAfterIncome: 180,
    dividendPaidPerTurn: 0,
    federalTaxPaid: 20,
    stateTaxPaid: 0,
    taxPaidByCountry: input.federalTaxByCountryAnchor ?? new Map(),
    taxPaidByState: new Map(),
    taxPaidByCountryDomestic: new Map(),
    taxPaidByCountryForeign: new Map(),
    taxPaidByStateDomestic: new Map(),
    taxPaidByStateForeign: new Map(),
    marketingStrength: 0,
    logisticsStrength: 0,
    rdScore: 0,
    dividendRate: 0,
    liquidCapital: 180,
    escrowFundingMove: 0,
    escrowBalanceAfter: 0,
    actualSharePrice: 1,
    totalShares: 100,
    sectorNPV: 0,
    creditComposite: 50,
    creditRating: "B",
    ...input,
  };
}

describe("corporate operating cash settlement", () => {
  it("credits modeled gross cash, withholds federal tax, and preserves net corporate income once", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000030");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 100,
        treasuryBalance: -50,
      },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);

    const operating = snapshot(corpId, {
      operatingCashIncomeLocal: 80,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map([["US", 20]]),
    });
    await settleCorporateOperatingCash(db as unknown as Db, [operating], 4, new Date());
    await settleCorporateOperatingCash(db as unknown as Db, [operating], 4, new Date());

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(180);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 120,
      treasuryBalance: -30,
    });
    expect(db.collection("bankMoneyMoves").docs).toEqual([
      expect.objectContaining({
        _id: `corp-operating-cash:4:${corpId.toHexString()}`,
        status: "applied",
      }),
    ]);
  });

  it("values split tax receipts in each native Treasury currency", async () => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000031");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [
      { currencyCode: "EUR", rate: 2 },
      { currencyCode: "USD", rate: 1 },
      { currencyCode: "GBP", rate: 0.8 },
    ]);
    db.seed("federalBudget", [
      {
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        treasuryCashLocal: 10,
        treasuryBalance: 0,
      },
      {
        _id: "UK",
        countryId: "UK",
        currencyCode: "GBP",
        treasuryCashLocal: 10,
        treasuryBalance: 0,
      },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);

    await settleCorporateOperatingCash(
      db as unknown as Db,
      [
        snapshot(corpId, {
          operatingCashIncomeLocal: 40,
          operatingCashCurrency: "EUR",
          operatingCashLocalPerAnchor: 2,
          federalTaxByCountryAnchor: new Map([
            ["US", 4],
            ["UK", 6],
          ]),
        }),
      ],
      4,
      new Date()
    );

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(140);
    const budgets = db.collection("federalBudget").docs;
    const usBudget = budgets.find((budget) => budget.countryId === "US");
    const ukBudget = budgets.find((budget) => budget.countryId === "UK");
    expect(usBudget?.treasuryCashLocal).toBe(14);
    expect(usBudget?.treasuryBalance).toBe(4);
    expect(ukBudget?.treasuryCashLocal).toBeCloseTo(14.8);
    expect(ukBudget?.treasuryBalance).toBeCloseTo(4.8);
  });

  it.each([
    ["payer debit", "corporations", "liquidCapital", -20],
    ["Treasury credit", "federalBudget", "treasuryCashLocal", 20],
  ])("replays a crash after the %s leg without recalculating or duplicating cash", async (
    _label,
    collection,
    path,
    amount
  ) => {
    const db = createInMemoryDb();
    const corpId = new ObjectId("650000000000000000000032");
    db.seed("gameConfig", [{ _id: "default", treasuryCashLedgerEnabled: true }]);
    db.seed("gameState", [{ _id: "current", currentTurn: 4, preset: "2019-default" }]);
    db.seed("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
    db.seed("federalBudget", [
      { _id: "US", countryId: "US", currencyCode: "USD", treasuryCashLocal: 100, treasuryBalance: 0 },
    ]);
    db.seed("corporations", [{ _id: corpId, liquidCapital: 100 }]);
    const original = snapshot(corpId, {
      operatingCashIncomeLocal: 80,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map([["US", 20]]),
    });
    const fault = withInjectedCrash(db, {
      collection,
      op: "updateOne",
      afterWrite: true,
      onCall: 1,
      matches: (args) => {
        const update = args[1] as { $inc?: Record<string, number> };
        return update.$inc?.[path] === amount;
      },
    });

    await expect(
      settleCorporateOperatingCash(fault.db, [original], 4, new Date())
    ).rejects.toThrow("crash after");
    fault.disarm();
    // A turn retry may have recomputed operating income and tax. The claimed
    // receipt must finish from the original per-country native-currency quote.
    const recomputed = snapshot(corpId, {
      operatingCashIncomeLocal: 5_000,
      operatingCashCurrency: "USD",
      operatingCashLocalPerAnchor: 1,
      federalTaxByCountryAnchor: new Map([["US", 900]]),
    });
    await settleCorporateOperatingCash(fault.db, [recomputed], 4, new Date());
    await settleCorporateOperatingCash(fault.db, [recomputed], 4, new Date());

    expect(db.collection("corporations").docs[0]?.liquidCapital).toBe(180);
    expect(db.collection("federalBudget").docs[0]).toMatchObject({
      treasuryCashLocal: 120,
      treasuryBalance: 20,
    });
    expect(db.collection("bankMoneyMoves").docs).toHaveLength(1);
    expect(db.collection("bankMoneyMoves").docs[0]).toMatchObject({ status: "applied" });
  });
});
