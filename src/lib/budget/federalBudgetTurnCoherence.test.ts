import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb, type InMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import { checkFederalBudgetInvariants, reconcileFederalBudgetInvariants } from "./budgetInvariants";
import { federalSurplus } from "./federalSurplus";
import { sumOutstandingSovereignPrincipal } from "@/lib/bonds/sovereignPrincipal";

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
  treasuryBalance: number,
  principal: number
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
    // Bond-owned stock, deliberately NOT a mirror of the cash balance (GR):
    // a country may hold cash assets and bond debt at the same time.
    debt: { principal, interestRate: 0.02, ceiling: 1e15 },
    debtToGdpRatio: 0.1,
    creditRating: "AAA",
    gdp: 1e13,
    gdpSmoothed: 1e13,
    economicFactors: { inflationRate: 2 },
  };
}

function bond(
  id: string,
  countryId: string,
  totalIssued: number,
  overrides?: Partial<Record<string, unknown>>
): Record<string, unknown> {
  return {
    _id: id,
    issuerType: "sovereign",
    countryId,
    totalIssued,
    matured: false,
    defaulted: false,
    restructureHaircutPercent: null,
    ...overrides,
  };
}

async function readBudgets(db: Db): Promise<FederalBudget[]> {
  return db.collection<FederalBudget>("federalBudget").find({}).toArray() as Promise<
    FederalBudget[]
  >;
}

async function outstandingByCountry(db: Db): Promise<Map<string, number>> {
  const bonds = (await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign" })
    .toArray()) as Bond[];
  const byCountry = new Map<string, number>();
  for (const b of bonds) {
    if (!b.countryId) continue;
    const key = String(b.countryId);
    byCountry.set(key, (byCountry.get(key) ?? 0) + sumOutstandingSovereignPrincipal([b]));
  }
  return byCountry;
}

describe("federal budget end-of-turn coherence (#1975 slice: surplus + bond-ledger writers)", () => {
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
      coherentBudget("US", 4_000_000_000_000, 4_200_000_000_000, -500_000_000_000, 500_000_000_000),
      // USSR-style near-balance: per-turn revenue growth used to exceed 25% of
      // the derived surplus, so the invariant refused repair for 21 straight
      // turns (raw 115-135). The fixed writer keeps the triple exact instead.
      coherentBudget("RU", 1_000_000_000, 999_000_000, -50_000_000, 50_000_000),
      // Cash and stock deliberately differ: GR holds -10M cash against 12M of
      // bond debt (6M plain face plus 10M face at a 40% haircut).
      coherentBudget("GR", 500_000_000, 499_000_000, -10_000_000, 12_000_000),
    ]);
    memory.seed("bonds", [
      bond("us-1", "US", 500_000_000_000),
      // Excluded from the stock: repudiated paper has left it, matured paper
      // was paid out. Neither may move the stored principal.
      bond("us-defaulted", "US", 999_000_000, { defaulted: true, defaultedAtTurn: 10 }),
      bond("us-matured", "US", 888_000_000, { matured: true }),
      bond("ru-1", "RU", 50_000_000),
      bond("gr-plain", "GR", 6_000_000),
      bond("gr-haircut", "GR", 10_000_000, { restructureHaircutPercent: 0.4 }),
    ]);
    return db;
  }

  it("holds surplus and ledger-equal principal across 120 turns spanning two 48-turn boundaries", async () => {
    const db = await setup();
    const { processFiscalBaseGrowth } = await import("@/lib/turn/fiscalBaseGrowth");
    const { processTreasuryTurn } = await import("@/lib/turn/treasuryTurn");

    for (let turn = 1; turn <= 120; turn++) {
      await processFiscalBaseGrowth(turn);
      await processTreasuryTurn(turn);
      const budgets = await readBudgets(db);
      expect(budgets).toHaveLength(3);
      const outstanding = await outstandingByCountry(db);
      for (const b of budgets) {
        const key = String(b.countryId ?? b._id);
        // Pass the ledger sum in: without `outstandingSovereignPrincipal`
        // the debt leg is skipped and this assertion would check surplus
        // only, not the principal invariant this suite exists to prove.
        expect(
          checkFederalBudgetInvariants({
            ...b,
            outstandingSovereignPrincipal: outstanding.get(key) ?? 0,
          })
        ).toEqual([]);
        expect(b.surplus).toBe(federalSurplus(b));
        // The stock IS the haircut-adjusted active non-defaulted face.
        expect(b.debt?.principal).toBe(outstanding.get(key) ?? 0);
      }
      if (turn === 48 || turn === 96) {
        // Independent treasury cash movements land on the boundary, then the
        // hygiene pass must find nothing to repair: cash never moves principal.
        const before = new Map(budgets.map((b) => [String(b._id), b.debt?.principal ?? 0]));
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: "US" }, { $inc: { treasuryBalance: 1_000_000 } });
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: "RU" }, { $inc: { treasuryBalance: -2_000_000 } });
        await db
          .collection<FederalBudget>("federalBudget")
          .updateOne({ _id: "GR" }, { $inc: { treasuryBalance: 4_000_000 } });
        const r = await reconcileFederalBudgetInvariants(db, turn);
        expect(r.skipped).toBe(0);
        expect(r.corrected).toBe(0);
        const after = await readBudgets(db);
        const ledger = await outstandingByCountry(db);
        for (const b of after) {
          const key = String(b.countryId ?? b._id);
          expect(b.debt?.principal).toBe(before.get(String(b._id)));
          expect(b.debt?.principal).toBe(ledger.get(key) ?? 0);
        }
      }
    }

    const r = await reconcileFederalBudgetInvariants(db, 120);
    expect(r).toEqual({ checked: 3, corrected: 0, skipped: 0 });
  });

  it("leaves bond-owned principal alone after a blind treasury-balance move", async () => {
    const db = await setup();
    const [before] = (await readBudgets(db)).filter((b) => b.countryId === "GR");
    const storedPrincipal = before!.debt?.principal ?? 0;
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: "GR" }, { $inc: { treasuryBalance: 4_000_000 } });
    const [gr] = (await readBudgets(db)).filter((b) => b.countryId === "GR");
    // Cash moved; the bond ledger owns principal, so the stored stock is untouched.
    expect(gr!.debt?.principal).toBe(storedPrincipal);
    // And the untouched stock still equals the haircut-adjusted ledger.
    const ledger = await outstandingByCountry(db);
    expect(gr!.debt?.principal).toBe(ledger.get("GR"));
    expect(ledger.get("GR")).toBe(12_000_000);
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
    expect(sumOutstandingSovereignPrincipal([])).toBe(0);
  });
});
