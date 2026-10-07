/** Conserved sovereign financing (#3381) through the real settlement journal. */
import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { withInjectedCrash } from "@/lib/test-utils/faultyDb";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { settleFundedSovereignCoupons } from "@/lib/banking/fundedSovereignCoupons";
import { sovereignPrimaryTransition } from "@/lib/bonds/rules/sovereignPrimary";
import { treasuryAccrualReceipt } from "@/lib/budget/rules/treasuryAccrual";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { BOND_UNIT_FACE_VALUE, type Bond } from "@/lib/db/types/bond";
import type { FederalBudget, TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  loadConservedFiscalContext,
  settleConservedHouseholdTax,
  settleConservedPoolFlow,
  settleConservedPrimarySpending,
} from "./conservedFiscalCash";

const US_BOND = new ObjectId("650000000000000000003381");
const UK_BOND = new ObjectId("650000000000000000003382");
const CORP = new ObjectId("650000000000000000003383");

interface Country {
  id: "US" | "UK";
  currency: CurrencyCode;
  revenuePerTurn: number;
  primaryPerTurn: number;
  bondId: ObjectId;
  units: number;
  couponRate: number;
}

const US: Country = {
  id: "US",
  currency: "USD",
  revenuePerTurn: 1_000,
  primaryPerTurn: 600,
  bondId: US_BOND,
  units: 10,
  couponRate: 12,
};
const UK: Country = { ...US, id: "UK", currency: "GBP", bondId: UK_BOND, units: 5 };

const couponPerTurn = (c: Country) =>
  perTurnCouponPayment(c.couponRate, BOND_UNIT_FACE_VALUE) * c.units;

function world(household: Partial<Record<"US" | "UK", number>> = {}): InMemoryDb {
  const db = createInMemoryDb();
  db.seed("centralBanks", [
    { _id: "US", countryId: "US", externalBroadMoney: household.US ?? 1_000_000 },
    { _id: "UK", countryId: "UK", externalBroadMoney: household.UK ?? 1_000_000 },
  ]);
  db.seed(
    "federalBudget",
    [US, UK].map((c) => ({
      _id: c.id,
      countryId: c.id,
      currencyCode: c.currency,
      treasuryBalance: 0,
      treasuryCashLocal: 0,
    }))
  );
  db.seed("bondMarketPools", [
    { _id: "USD", cashLocal: 0, targetCashLocal: 0, lifetime: {} },
    { _id: "GBP", cashLocal: 0, targetCashLocal: 0, lifetime: {} },
  ]);
  db.seed("corporations", [{ _id: CORP, countryId: "US", liquidCapital: 10_000 }]);
  return db;
}

function receipt(c: Country, turn: number): TreasuryAccrualReceipt {
  return treasuryAccrualReceipt({
    turn,
    openingCash: 0,
    currencyCode: c.currency,
    anchorRate: 1,
    ledgerShadow: false,
    annualRevenue: c.revenuePerTurn * TURNS_PER_YEAR,
    annualPrimarySpending: c.primaryPerTurn * TURNS_PER_YEAR,
    debtService: 0,
    enforcement: 0,
  });
}

function bond(c: Country): Bond {
  return {
    _id: c.bondId,
    issuerType: "sovereign",
    countryId: c.id,
    currencyCode: c.currency,
    couponRate: c.couponRate,
    holders: [],
    publicFloat: c.units,
    defaulted: false,
    matured: false,
  } as unknown as Bond;
}

function budget(db: InMemoryDb, id: string): FederalBudget & { treasuryCashLocal: number } {
  return db.collection("federalBudget").docs.find((doc) => doc._id === id) as never;
}
function household(db: InMemoryDb, id: string): number {
  return db.collection("centralBanks").docs.find((doc) => doc._id === id)!
    .externalBroadMoney as number;
}
function pool(db: InMemoryDb, currency: string): number {
  return db.collection("bondMarketPools").docs.find((doc) => doc._id === currency)!
    .cashLocal as number;
}
function stock(db: InMemoryDb, c: Country): number {
  const corp = c.id === "US" ? (db.collection("corporations").docs[0].liquidCapital as number) : 0;
  return household(db, c.id) + budget(db, c.id).treasuryCashLocal + pool(db, c.currency) + corp;
}

/** The treasury phase order: tax cash, coupon pass, primary spending. */
async function treasuryPhase(db: Db, memory: InMemoryDb, turn: number, countries = [US, UK]) {
  const ctx = await loadConservedFiscalContext(db, turn);
  for (const c of countries) {
    const r = receipt(c, turn);
    await settleConservedHouseholdTax(db, ctx, budget(memory, c.id), r);
    await settleFundedSovereignCoupons(db, budget(memory, c.id), {
      turn,
      bonds: [bond(c)],
      anchorRate: 1,
      forexEnabled: false,
      corporateQuotes: new Map(),
    });
    await settleConservedPrimarySpending(db, ctx, budget(memory, c.id), r);
  }
}

describe("conserved sovereign financing settlement", () => {
  it("funds national-scale coupons from tax cash and returns spending, conserving each currency", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const before = { US: stock(memory, US), UK: stock(memory, UK) };
    await treasuryPhase(db, memory, 1);
    expect(budget(memory, "US").sovereignCouponClaims).toEqual([]);
    expect(pool(memory, "USD")).toBeCloseTo(couponPerTurn(US), 6);
    expect(budget(memory, "US").treasuryCashLocal).toBeCloseTo(1_000 - couponPerTurn(US) - 600, 6);
    expect(household(memory, "US")).toBeCloseTo(1_000_000 - 1_000 + 600, 6);
    expect(stock(memory, US)).toBeCloseTo(before.US, 6);
    expect(stock(memory, UK)).toBeCloseTo(before.UK, 6);
    expect(budget(memory, "US").conservedFiscalCash).toMatchObject({
      householdTaxArrearsLocal: 0,
      primarySpendingArrearsLocal: 0,
      lifetime: { taxCashIn: 1_000, spendingCashOut: 600 },
    });
  });

  it("replays a retried phase without moving cash twice", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    await treasuryPhase(db, memory, 1);
    const snapshot = JSON.stringify([
      memory.collection("centralBanks").docs,
      memory.collection("bondMarketPools").docs.map((doc) => doc.cashLocal),
      budget(memory, "US").treasuryCashLocal,
      budget(memory, "US").conservedFiscalCash,
    ]);
    await treasuryPhase(db, memory, 1);
    expect(
      JSON.stringify([
        memory.collection("centralBanks").docs,
        memory.collection("bondMarketPools").docs.map((doc) => doc.cashLocal),
        budget(memory, "US").treasuryCashLocal,
        budget(memory, "US").conservedFiscalCash,
      ])
    ).toBe(snapshot);
  });

  it("recovers a crash between the household debit and the Treasury credit exactly once", async () => {
    const memory = world();
    const crash = withInjectedCrash(memory, {
      collection: "centralBanks",
      op: "updateOne",
      onCall: 1,
      afterWrite: true,
    });
    await expect(treasuryPhase(crash.db, memory, 1, [US])).rejects.toThrow();
    expect(household(memory, "US")).toBe(1_000_000 - 1_000);
    crash.disarm();
    await treasuryPhase(memory as unknown as Db, memory, 1, [US]);
    expect(household(memory, "US")).toBeCloseTo(1_000_000 - 1_000 + 600, 6);
    expect(budget(memory, "US").treasuryCashLocal).toBeCloseTo(1_000 - couponPerTurn(US) - 600, 6);
    expect(budget(memory, "US").conservedFiscalCash?.lifetime?.taxCashIn).toBe(1_000);
  });

  it("subtracts player tax already received in cash from the household slice", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const withheld = await settleTransition(db, {
      key: `corp-operating-cash:1:${CORP.toHexString()}:tax`,
      kind: "corporate_tax_withholding",
      turn: 1,
      currency: "USD",
      legs: [
        {
          kind: "debit",
          amount: 150,
          collection: "corporations",
          filter: { _id: CORP, liquidCapital: { $gte: 150 } },
          path: "liquidCapital",
          note: "player corporate tax",
        },
        {
          kind: "credit",
          amount: 150,
          collection: "federalBudget",
          filter: { countryId: "US" },
          path: "treasuryCashLocal",
          note: "player tax receipt",
        },
      ],
      projections: [],
      event: { kind: "monetary.executed", command: "test" },
    });
    expect(withheld.status).toBe("applied");
    const before = stock(memory, US);
    await treasuryPhase(db, memory, 1, [US]);
    // 1,000 of revenue: 150 arrived from the player corporation, 850 from households.
    expect(household(memory, "US")).toBeCloseTo(1_000_000 - 850 + 600, 6);
    expect(budget(memory, "US").conservedFiscalCash?.lifetime?.taxCashIn).toBe(850);
    expect(stock(memory, US)).toBeCloseTo(before, 6);
  });

  it("keeps explicit arrears when a payer is short and settles them once funded", async () => {
    const memory = world({ UK: 0 });
    const db = memory as unknown as Db;
    await treasuryPhase(db, memory, 1, [UK]);
    expect(household(memory, "UK")).toBe(0);
    expect(budget(memory, "UK").treasuryCashLocal).toBe(0);
    expect(budget(memory, "UK").sovereignCouponClaims).toHaveLength(1);
    expect(budget(memory, "UK").conservedFiscalCash).toMatchObject({
      householdTaxArrearsLocal: 1_000,
      primarySpendingArrearsLocal: 600,
    });
    memory.collection("centralBanks").docs.find((doc) => doc._id === "UK")!.externalBroadMoney =
      100_000;
    await treasuryPhase(db, memory, 2, [UK]);
    // Both turns of tax, both coupon claims, both turns of spending.
    expect(budget(memory, "UK").sovereignCouponClaims).toEqual([]);
    expect(budget(memory, "UK").conservedFiscalCash).toMatchObject({
      householdTaxArrearsLocal: 0,
      primarySpendingArrearsLocal: 0,
    });
    expect(household(memory, "UK")).toBeCloseTo(100_000 - 2_000 + 1_200, 6);
    expect(budget(memory, "UK").treasuryCashLocal).toBeCloseTo(
      2_000 - 2 * couponPerTurn(UK) - 1_200,
      6
    );
  });

  it("settles each country against its own currency's household stock", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    await treasuryPhase(db, memory, 1, [UK]);
    expect(household(memory, "US")).toBe(1_000_000);
    expect(pool(memory, "USD")).toBe(0);
    expect(household(memory, "UK")).toBeCloseTo(1_000_000 - 1_000 + 600, 6);
    expect(pool(memory, "GBP")).toBeCloseTo(couponPerTurn(UK), 6);
  });

  it("re-reads a shared currency's household stock after resuming an interrupted settlement", async () => {
    // Two countries on one currency share one household stock.
    const SHARED: Country = { ...UK, currency: "USD" };
    const memory = world({ US: 1_500 });
    const crash = withInjectedCrash(memory, {
      collection: "centralBanks",
      op: "updateOne",
      onCall: 1,
      afterWrite: false,
    });
    await expect(treasuryPhase(crash.db, memory, 1, [US, SHARED])).rejects.toThrow();
    crash.disarm();
    const db = memory as unknown as Db;
    // The retry loads its context before the recorded US tax debit resumes.
    const ctx = await loadConservedFiscalContext(db, 1);
    expect(ctx.householdCashByBank.get("US")).toBe(1_500);
    await settleConservedHouseholdTax(db, ctx, budget(memory, "US"), receipt(US, 1));
    expect(household(memory, "US")).toBe(500);
    expect(ctx.householdCashByBank.get("US")).toBe(500);
    // The second country plans against the real 500, not the stale 1,500, so
    // it pays what exists and defers only the true shortfall.
    await settleConservedHouseholdTax(db, ctx, budget(memory, "UK"), receipt(SHARED, 1));
    expect(household(memory, "US")).toBe(0);
    expect(budget(memory, "UK").treasuryCashLocal).toBe(500);
    expect(budget(memory, "UK").conservedFiscalCash?.householdTaxArrearsLocal).toBe(500);
  });

  it("books a stale-snapshot refusal as unfunded arrears instead of moving money", async () => {
    const memory = world({ US: 500 });
    const db = memory as unknown as Db;
    const ctx = await loadConservedFiscalContext(db, 1);
    ctx.householdCashByBank.set("US", 5_000);
    const { paid } = await settleConservedHouseholdTax(
      db,
      ctx,
      budget(memory, "US"),
      receipt(US, 1)
    );
    expect(paid).toBe(0);
    expect(household(memory, "US")).toBe(500);
    expect(budget(memory, "US").treasuryCashLocal).toBe(0);
    expect(budget(memory, "US").conservedFiscalCash?.householdTaxArrearsLocal).toBe(1_000);
    await settleConservedHouseholdTax(db, ctx, budget(memory, "US"), receipt(US, 1));
    expect(budget(memory, "US").conservedFiscalCash?.householdTaxArrearsLocal).toBe(1_000);
  });

  it("moves bond-pool liquidity from household savings and funds primary placement without minting", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    expect(
      (
        await settleConservedPoolFlow(db, {
          turn: 12,
          currency: "USD",
          direction: "inflow",
          amount: 5_000,
        })
      ).moved
    ).toBe(5_000);
    expect(
      (
        await settleConservedPoolFlow(db, {
          turn: 12,
          currency: "USD",
          direction: "inflow",
          amount: 5_000,
        })
      ).moved
    ).toBe(0);
    expect(household(memory, "US")).toBe(1_000_000 - 5_000);
    expect(pool(memory, "USD")).toBe(5_000);
    const placed = await settleTransition(
      db,
      sovereignPrimaryTransition({
        key: "sovereign-primary:scheduled:US:12",
        turn: 12,
        currency: "USD",
        budgetId: "US",
        poolCash: 4_000,
        monetaryCash: 0,
        face: 4_000,
        annualCoupon: 480,
        treasuryCashLedgerEnabled: true,
      })
    );
    expect(placed.status).toBe("applied");
    expect(pool(memory, "USD")).toBe(1_000);
    expect(budget(memory, "US").treasuryCashLocal).toBe(4_000);
    expect(() =>
      sovereignPrimaryTransition({
        key: "x",
        turn: 12,
        currency: "USD",
        budgetId: "US",
        poolCash: 0,
        monetaryCash: 1,
        centralBankId: "US",
        face: 1,
        annualCoupon: 0,
        treasuryCashLedgerEnabled: true,
      })
    ).toThrow("Funded Treasury cash cannot use monetary financing");
    await settleConservedPoolFlow(db, {
      turn: 13,
      currency: "USD",
      direction: "sweep",
      amount: 400,
    });
    expect(pool(memory, "USD")).toBe(600);
    expect(household(memory, "US")).toBe(1_000_000 - 5_000 + 400);
    expect(
      memory.collection("bondMarketPools").docs.find((doc) => doc._id === "USD")!.lifetime
    ).toMatchObject({ householdInflowIn: 5_000, householdSweepOut: 400 });
    expect(
      await settleConservedPoolFlow(db, {
        turn: 14,
        currency: "USD",
        direction: "sweep",
        amount: 1e9,
      })
    ).toEqual({ moved: 0 });
  });

  it("holds a 48-turn trajectory with every coupon paid and no money created", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const opening = stock(memory, US);
    for (let turn = 1; turn <= TURNS_PER_YEAR; turn += 1) {
      await treasuryPhase(db, memory, turn, [US]);
      expect(budget(memory, "US").sovereignCouponClaims).toEqual([]);
      expect(budget(memory, "US").treasuryCashLocal).toBeGreaterThanOrEqual(0);
      expect(stock(memory, US)).toBeCloseTo(opening, 4);
    }
    expect(pool(memory, "USD")).toBeCloseTo(couponPerTurn(US) * TURNS_PER_YEAR, 4);
    expect(budget(memory, "US").conservedFiscalCash?.lifetime).toEqual({
      taxCashIn: 1_000 * TURNS_PER_YEAR,
      spendingCashOut: 600 * TURNS_PER_YEAR,
    });
  });
});
