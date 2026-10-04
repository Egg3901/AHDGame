/** Treasury cash accrual must be witnessed by the same per-turn owner. */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { deriveLedgerEntry } from "@/lib/ledger/deriveFromTx";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
import type { FederalBudget } from "@/lib/db/types/budget";
import { processTreasuryTurn } from "./treasuryTurn";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function world(bankTreasuryEnabled = false) {
  const db = createInMemoryDb();
  db.seed("gameConfig", [{ _id: "default", ledgerShadow: true, bankTreasuryEnabled }]);
  db.seed("gameState", [{ _id: "current", currentTurn: 10 }]);
  db.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1 }]);
  db.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      currencyCode: "USD",
      gdp: 48000,
      revenue: { total: 48000 },
      spending: { total: 24000, debtInterest: 0 },
      debt: { principal: 0, interestRate: 0 },
      treasuryBalance: -1000,
    },
  ]);
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  return db;
}

describe("treasury accrual stock-flow ownership", () => {
  it("does not read bonds while bank treasury holdings are disabled", async () => {
    const db = world(false);
    const bonds = db.collection("bonds");
    const find = vi.spyOn(bonds, "find");
    await processTreasuryTurn(10);
    expect(find).not.toHaveBeenCalled();
  });

  it("funds opening bank-holder coupons once from treasury cash without changing gross budget interest", async () => {
    const db = world(true);
    const bankId = new ObjectId("650000000000000000000001");
    const bondId = new ObjectId("650000000000000000000002");
    await db.collection("corporations").insertOne({
      _id: bankId,
      bankCharter: {
        status: "active",
        currency: "USD",
        charteredTurn: 4,
        cashReserves: 5,
      },
    });
    await db.collection("bonds").insertOne({
      _id: bondId,
      issuerType: "sovereign",
      countryId: "US",
      currencyCode: "USD",
      couponRate: 4.8,
      defaulted: false,
      holders: [{ bankId, charteredTurn: 4, units: 100 }],
    });
    await db.collection("federalBudget").updateOne(
      { _id: "federal" },
      {
        $set: {
          treasuryBalance: 1_000,
          debt: { principal: 48_000, interestRate: 0.05 },
          spending: { total: 24_000, debtInterest: 7_500 },
        },
      }
    );

    await processTreasuryTurn(10);
    const budget = db.collection("federalBudget").docs[0] as Pick<
      FederalBudget,
      "spending" | "treasuryAccrual" | "bankSovereignClaims" | "treasuryBalance"
    >;
    const receipt = budget.treasuryAccrual as {
      cashDelta: number;
      bankCouponPlan?: Array<{ amountLocal: number; bankId: string; charteredTurn: number }>;
      components: { debtService: number };
    };
    expect(receipt.bankCouponPlan).toEqual([
      {
        amountLocal: 100,
        bankId: bankId.toHexString(),
        charteredTurn: 4,
        bondIds: [bondId.toHexString()],
      },
    ]);
    expect(receipt.components.debtService).toBeCloseTo(0);
    expect(budget.spending.debtInterest).toBe(7_500);
    expect(budget.bankSovereignClaims).toEqual([]);
    expect(budget.treasuryBalance).toBe(1_000 + receipt.cashDelta - 100);
    expect(
      (db.collection("corporations").docs[0].bankCharter as { cashReserves: number }).cashReserves
    ).toBe(105);
    expect(db.collection("bankMoneyMoves").docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: expect.stringContaining(":funding:10"), status: "applied" }),
        expect.objectContaining({ _id: expect.stringContaining(":bank:10"), status: "applied" }),
      ])
    );
    const transfer = db
      .collection("ledgerEntries")
      .docs.find((entry) => entry.emitSite === "banking/bankSovereignClaims");
    expect(transfer?.legs).toMatchObject([
      { account: "government:US:USD", amount: -100, role: "primary" },
      { account: `bank_vault:${bankId.toHexString()}:USD`, amount: 100, role: "contra" },
    ]);
  });

  it("records the actual signed treasury movement without inventing financing", async () => {
    const db = world();
    await processTreasuryTurn(10);
    const close = Number(db.collection("federalBudget").docs[0].treasuryBalance);
    expect(close).toBe(-500);
    const report = reconcileLedger({
      turn: 10,
      openingBalances: { "government:US:USD": -1000 },
      closingBalances: { "government:US:USD": close },
      entries: db.collection("ledgerEntries").docs as unknown as LedgerEntry[],
    });
    expect(report.stockVsFlow.divergentCount).toBe(0);
    expect(report.trialBalance.status).toBe("green");
    expect(report.unattributed).toEqual([]);
  });
  it("two concurrent phase calls accrue once and publish one witness", async () => {
    const db = world();
    await Promise.all([processTreasuryTurn(10), processTreasuryTurn(10)]);
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(-500);
    expect(db.collection("ledgerEntries").docs).toHaveLength(1);
  });

  it.each([
    { collection: "federalBudget", afterWrite: true },
    { collection: "ledgerEntries", afterWrite: false },
    { collection: "ledgerEntries", afterWrite: true },
  ])("recovers $collection afterWrite=$afterWrite without charging again", async (fault) => {
    const db = world();
    const crash = withInjectedCrash(db, { ...fault, op: "updateOne", onCall: 1 });
    vi.mocked(getDb).mockResolvedValue(crash.db);
    await expect(processTreasuryTurn(10)).rejects.toThrow("crash");
    await processTreasuryTurn(10);
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(-500);
    expect(db.collection("ledgerEntries").docs).toHaveLength(1);
  });

  it("recovers the previous witness before the next turn replaces its receipt", async () => {
    const db = world();
    const crash = withInjectedCrash(db, {
      collection: "ledgerEntries",
      op: "updateOne",
      onCall: 1,
    });
    vi.mocked(getDb).mockResolvedValue(crash.db);
    await expect(processTreasuryTurn(10)).rejects.toThrow("crash");
    await processTreasuryTurn(11);
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(0);
    expect(
      db
        .collection("ledgerEntries")
        .docs.map((d) => d.turn)
        .sort()
    ).toEqual([10, 11]);
  });

  it("preserves negative cash and records named spending, service and rounding", async () => {
    const db = world();
    await db.collection("federalBudget").updateOne(
      { _id: "federal" },
      {
        $set: {
          revenue: { total: 4801 },
          spending: { total: 9601, debtInterest: 0 },
          debt: { principal: 48000, interestRate: 0.05 },
          unionsBanned: true,
          unionEnforcementPosture: "crackdown",
          gdp: 48000,
        },
      }
    );
    await processTreasuryTurn(10);
    const close = Number(db.collection("federalBudget").docs[0].treasuryBalance);
    expect(close).toBeLessThan(-1100);
    const entries = db.collection("ledgerEntries").docs as unknown as LedgerEntry[];
    expect(entries[0].legs.some((l) => l.account.includes("fiscal_debt_service"))).toBe(true);
    expect(entries[0].legs.some((l) => l.account.includes("fiscal_union_enforcement"))).toBe(true);
    const report = reconcileLedger({
      turn: 10,
      openingBalances: { "government:US:USD": -1000 },
      closingBalances: { "government:US:USD": close },
      entries,
    });
    expect(report.stockVsFlow.divergentCount).toBe(0);
  });

  it.each(["gov_tax_revenue", "gov_coupon_payment"] as const)(
    "marks %s statistics without suppressing real cash rows",
    (type) => {
      const row = {
        type,
        turn: 10,
        createdAt: new Date(),
        subjectType: "government" as const,
        countryId: "US",
        amount: 100,
        currencyCode: "USD" as const,
        anchorAmount: 100,
      };
      expect(deriveLedgerEntry({ ...row, meta: { treasuryCashMovement: false } })).toBeNull();
      expect(deriveLedgerEntry(row)).not.toBeNull();
    }
  );
  it.each([undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses invalid floating USD FX %s before cash accrual",
    async (rate) => {
      const db = world();
      await db.collection("exchangeRates").deleteMany({});
      if (rate !== undefined) db.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate }]);
      await expect(processTreasuryTurn(10)).rejects.toThrow("exchange rate");
      expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(-1000);
      expect(db.collection("federalBudget").docs[0].treasuryAccrual).toBeUndefined();
      expect(db.collection("ledgerEntries").docs).toHaveLength(0);
    }
  );
  it("prevalidates the full cohort before advancing any earlier valid treasury", async () => {
    const db = world();
    await db.collection("federalBudget").insertOne({
      ...db.collection("federalBudget").docs[0],
      _id: "UK",
      countryId: "UK",
      currencyCode: "GBP",
    });
    await expect(processTreasuryTurn(10)).rejects.toThrow("GBP");
    for (const budget of db.collection("federalBudget").docs) {
      expect(budget.treasuryBalance).toBe(-1000);
      expect(budget.treasuryAccrual).toBeUndefined();
    }
    expect(db.collection("ledgerEntries").docs).toHaveLength(0);
  });
  it.each([
    ["BG", "BGL"],
    ["CS", "CSK"],
    ["HU", "HUF"],
    ["PL", "PLZ"],
    ["RO", "ROL"],
    ["YU", "YUD"],
  ])(
    "values budget-only %s using authored era without creating a tradable rate",
    async (countryId, currencyCode) => {
      const db = world();
      await db
        .collection("gameState")
        .updateOne({ _id: "current" }, { $set: { preset: "1991-default" } });
      await db
        .collection("federalBudget")
        .updateOne({ _id: "federal" }, { $set: { countryId, currencyCode } });
      await processTreasuryTurn(10);
      const budget = db.collection("federalBudget").docs[0];
      const receipt = budget.treasuryAccrual as {
        anchorRate: number;
        anchorRateSource: string;
        anchorRatePreset: string;
      };
      expect(budget.treasuryBalance).toBe(-500);
      expect(receipt.anchorRate).toBeGreaterThan(0);
      expect(receipt.anchorRateSource).toBe("authored_budget_only");
      expect(receipt.anchorRatePreset).toBe("1991-default");
      expect(db.collection("exchangeRates").docs).toHaveLength(1);
      const report = reconcileLedger({
        turn: 10,
        openingBalances: {
          [`government:${countryId}:${currencyCode}`]: -1000 / receipt.anchorRate,
        },
        closingBalances: { [`government:${countryId}:${currencyCode}`]: -500 / receipt.anchorRate },
        entries: db.collection("ledgerEntries").docs as unknown as LedgerEntry[],
      });
      expect(report.stockVsFlow.divergentCount).toBe(0);
    }
  );
  it("rejects corrupt explicit budget-only FX before any treasury advances", async () => {
    const db = world();
    await db
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { preset: "1991-default" } });
    db.seed("federalBudget", [
      {
        ...db.collection("federalBudget").docs[0],
        _id: "budget-only",
        countryId: "BG",
        currencyCode: "BGL",
      },
    ]);
    db.seed("exchangeRates", [{ _id: "BGL", currencyCode: "BGL", rate: 0 }]);
    await expect(processTreasuryTurn(10)).rejects.toThrow("exchange rate for BGL");
    expect(db.collection("federalBudget").docs.every((b) => b.treasuryBalance === -1000)).toBe(
      true
    );
    expect(db.collection("ledgerEntries").docs).toHaveLength(0);
  });
  it("keeps flag-off native cash and retries independent of unavailable FX", async () => {
    const db = world();
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { ledgerShadow: false } });
    await db.collection("exchangeRates").deleteMany({});
    await processTreasuryTurn(10);
    await processTreasuryTurn(10);
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(-500);
    expect(db.collection("federalBudget").docs[0].treasuryAccrual).toMatchObject({
      anchorRate: null,
      anchorRateSource: "unpriced",
      ledgerShadow: false,
    });
    expect(db.collection("ledgerEntries").docs).toHaveLength(0);
    // Enabling shadow accounting never fabricates the previous receipt's rate.
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { ledgerShadow: true } });
    await expect(processTreasuryTurn(11)).rejects.toThrow("exchange rate for USD");
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(-500);
    db.seed("exchangeRates", [{ _id: "USD", currencyCode: "USD", rate: 1.25 }]);
    await processTreasuryTurn(10);
    expect(db.collection("ledgerEntries").docs).toHaveLength(0);
    await processTreasuryTurn(11);
    expect(db.collection("federalBudget").docs[0].treasuryBalance).toBe(0);
    expect(db.collection("ledgerEntries").docs.map((e) => e.turn)).toEqual([11]);
  });
  it("preserves the complete unpriced flag-off budget cohort", async () => {
    const db = world();
    await db
      .collection("gameConfig")
      .updateOne({ _id: "default" }, { $set: { ledgerShadow: false } });
    await db
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { preset: "1979-default" } });
    await db.collection("exchangeRates").deleteMany({});
    const template = db.collection("federalBudget").docs[0];
    for (const [countryId, currencyCode] of [
      ["BG", "BGL"],
      ["CS", "CSK"],
      ["HU", "HUF"],
      ["PL", "PLZ"],
      ["RO", "ROL"],
      ["YU", "YUD"],
    ])
      db.seed("federalBudget", [{ ...template, _id: countryId, countryId, currencyCode }]);
    expect((await processTreasuryTurn(10)).countriesProcessed).toBe(7);
    expect((await processTreasuryTurn(10)).countriesProcessed).toBe(0);
    for (const budget of db.collection("federalBudget").docs) {
      expect(budget.treasuryBalance).toBe(-500);
      expect(budget.treasuryAccrual).toMatchObject({
        anchorRate: null,
        anchorRateSource: "unpriced",
        ledgerShadow: false,
      });
    }
    expect(db.collection("ledgerEntries").docs).toHaveLength(0);
  });
});
