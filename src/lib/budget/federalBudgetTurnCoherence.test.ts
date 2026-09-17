import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { checkFederalBudgetInvariants, reconcileFederalBudgetInvariants } from "./budgetInvariants";
import { federalSurplus } from "./federalSurplus";
import { resyncFederalBudgetDebtFromBalance } from "./treasurySpend";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TAX_RATES = { incomeTax: 20, salesTax: 5, tariffs: 3, foreignCorporateTax: 15 };
const BASES = {
  taxableIncome: 1_000_000_000,
  wagesAndSalaries: 1_000_000_000,
  domesticCorporateProfits: 500_000_000,
  foreignCorporateProfits: 200_000_000,
  importValue: 400_000_000,
  taxableSales: 800_000_000,
};

function coherentBudget(
  countryId: string,
  revenueTotal: number,
  spendingTotal: number,
  treasuryBalance: number
): Record<string, unknown> {
  return {
    _id: countryId,
    countryId,
    taxRates: { ...TAX_RATES },
    taxBases: { ...BASES },
    revenue: { total: revenueTotal },
    spending: { total: spendingTotal, byCategory: {}, stateGrants: 0, debtInterest: 0 },
    surplus: revenueTotal - spendingTotal,
    treasuryBalance,
    debt: { principal: Math.max(0, -treasuryBalance), interestRate: 0.02, ceiling: 1e15 },
    debtToGdpRatio: 0.1,
    creditRating: "AAA",
    gdp: 1e13,
    gdpSmoothed: 1e13,
    economicFactors: { inflationRate: 2 },
  };
}

async function readBudgets(db: Db): Promise<FederalBudget[]> {
  return db.collection<FederalBudget>("federalBudget").find({}).toArray() as Promise<
    FederalBudget[]
  >;
}

describe("federal budget end-of-turn coherence (#1975 slice: surplus + balance writers)", () => {
  let memory: InMemoryDb;

  async function setup(): Promise<Db> {
    memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db);
    memory.seed("countryGameStates", [
      { _id: "US", status: "active", enabledForPlayers: true },
      { _id: "RU", status: "active", enabledForPlayers: true },
      { _id: "GR", status: "active", enabledForPlayers: true },
    ]);
    memory.seed("federalBudget", [
      coherentBudget("US", 4_000_000_000_000, 4_200_000_000_000, -500_000_000_000),
      // USSR-style near-balance: per-turn revenue growth used to exceed 25% of
      // the derived surplus, so the invariant refused repair for 21 straight
      // turns (raw 115-135). The fixed writer keeps the triple exact instead.
      coherentBudget("RU", 1_000_000_000, 999_000_000, -50_000_000),
      coherentBudget("GR", 500_000_000, 499_000_000, -10_000_000),
    ]);
    return db;
  }

  it("holds surplus = revenue - spending across 100 turns spanning two 48-turn boundaries", async () => {
    const db = await setup();
    const { processFiscalBaseGrowth } = await import("@/lib/turn/fiscalBaseGrowth");
    const { processTreasuryTurn } = await import("@/lib/turn/treasuryTurn");

    for (let turn = 1; turn <= 100; turn++) {
      await processFiscalBaseGrowth(turn);
      await processTreasuryTurn(turn);
      const budgets = await readBudgets(db);
      expect(budgets).toHaveLength(3);
      for (const b of budgets) {
        expect(checkFederalBudgetInvariants(b)).toEqual([]);
        expect(b.surplus).toBe(federalSurplus(b));
      }
      if (turn === 48 || turn === 96) {
        const r = await reconcileFederalBudgetInvariants(db, turn);
        expect(r.skipped).toBe(0);
        expect(r.corrected).toBe(0);
      }
    }

    const r = await reconcileFederalBudgetInvariants(db, 100);
    expect(r).toEqual({ checked: 3, corrected: 0, skipped: 0 });
  });

  it("resyncs debt principal after a blind treasury-balance move", async () => {
    const db = await setup();
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: "GR" }, { $inc: { treasuryBalance: 4_000_000 } });
    let [gr] = (await readBudgets(db)).filter((b) => b.countryId === "GR");
    expect(checkFederalBudgetInvariants(gr!).map((x) => x.field)).toContain("debtPrincipal");

    await resyncFederalBudgetDebtFromBalance(db, { _id: "GR" });
    [gr] = (await readBudgets(db)).filter((b) => b.countryId === "GR");
    expect(checkFederalBudgetInvariants(gr!)).toEqual([]);
    expect(gr!.debt?.principal).toBe(Math.max(0, -(gr!.treasuryBalance ?? 0)));
  });

  it("keeps the triple coherent through a deposit-insurance backstop debit", async () => {
    const db = await setup();
    const { debitTreasuryDepositInsurance } = await import("@/lib/banking/depositBookReturn");
    await debitTreasuryDepositInsurance(db, "USD", 25_000_000);
    const [us] = (await readBudgets(db)).filter((b) => b.countryId === "US");
    expect(checkFederalBudgetInvariants(us!)).toEqual([]);
  });

  it("tolerates legacy docs with missing surplus, balance, or debt", async () => {
    const db = await setup();
    memory.seed("federalBudget", [
      { _id: "LEG", countryId: "LEG", revenue: { total: 10 }, spending: { total: 7 } },
    ]);
    const docs = await readBudgets(db);
    const leg = docs.find((b) => b.countryId === "LEG")!;
    expect(checkFederalBudgetInvariants(leg)).toEqual([]);
    await expect(resyncFederalBudgetDebtFromBalance(db, { _id: "LEG" })).resolves.toBeUndefined();
  });
});
