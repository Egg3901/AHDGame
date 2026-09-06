import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { TAX_BASE_GROWTH_PREMIUM_CAP } from "@/lib/budget/revenue";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Keep the real per-turn growth helpers + normalizeFederalTaxRates; stub only the
// heavy cross-collection revenue calc.
vi.mock("@/lib/budget/revenue", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/budget/revenue")>();
  return {
    ...actual,
    calculateFederalRevenue: vi.fn().mockResolvedValue({ total: 42, incomeTax: 42, tradeTax: 0 }),
  };
});

const FED_TAX_RATES = { incomeTax: 20, salesTax: 5, tariffs: 3, foreignCorporateTax: 15 };
const FED_BASES = {
  taxableIncome: 1000,
  wagesAndSalaries: 1000,
  domesticCorporateProfits: 500,
  foreignCorporateProfits: 200,
  importValue: 400,
  taxableSales: 800,
};
const STATE_BASES = {
  taxableIncome: 100,
  taxableSales: 80,
  domesticCorporateProfits: 50,
  foreignCorporateProfits: 20,
  propertyValue: 300,
};

describe("processFiscalBaseGrowth", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    function setup<T>(name: string, data: T[]) {
      db.collection(name);
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
        toArray: vi.fn().mockResolvedValue(data),
      });
      db.collectionMocks[name]!.updateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
      db.collectionMocks[name]!.bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    }

    setup("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        taxRates: FED_TAX_RATES,
        taxBases: { ...FED_BASES },
        economicFactors: { inflationRate: 2 },
      },
    ]);
    setup("stateBudgets", [{ _id: "CA", countryId: "US", taxBases: { ...STATE_BASES } }]);
    // SP5: economic factors are read from macroMetrics.
    setup("macroMetrics", [
      {
        _id: "federal", // national doc for US
        economic: {
          wageGrowth: { value: 3 },
          tradeGrowth: { value: 2 },
          gdpGrowth: { value: 2.5 },
        },
      },
      {
        _id: "CA",
        economic: {
          wageGrowth: { value: 6 },
          tradeGrowth: { value: 4 },
          gdpGrowth: { value: 3 },
        },
      },
    ]);
    setup("states", [{ _id: "CA", countryId: "US" }]);
  });

  it("grows federal taxableIncome by ONE per-turn wage slice (not the full annual jump)", async () => {
    const { processFiscalBaseGrowth } = await import("./fiscalBaseGrowth");
    await processFiscalBaseGrowth(1);

    const calls = db.collectionMocks.federalBudget!.updateOne.mock.calls;
    const basesSet = calls.find((c) => c[1]?.$set?.taxBases)?.[1].$set.taxBases;
    expect(basesSet.taxableIncome).toBeCloseTo(1000 * (1 + 3 / 100 / TURNS_PER_YEAR), 6);
    expect(basesSet.importValue).toBeCloseTo(400 * (1 + 2 / 100 / TURNS_PER_YEAR), 6);
    // NOT the full annual jump
    expect(basesSet.taxableIncome).toBeLessThan(1000 * (1 + 3 / 100));
  });

  it("refreshes economicFactors.{wageGrowth,tradeGrowth} from national metrics", async () => {
    const { processFiscalBaseGrowth } = await import("./fiscalBaseGrowth");
    await processFiscalBaseGrowth(1);

    const calls = db.collectionMocks.federalBudget!.updateOne.mock.calls;
    const factorSet = calls.find((c) => c[1]?.$set?.["economicFactors.wageGrowth"] != null)?.[1]
      .$set;
    expect(factorSet["economicFactors.wageGrowth"]).toBe(3);
    expect(factorSet["economicFactors.tradeGrowth"]).toBe(2);
    // gdpGrowth is mirrored every turn too; it used to be an annual snapshot
    // that the budget page showed while every other surface read the live doc.
    expect(factorSet["economicFactors.gdpGrowth"]).toBe(2.5);
  });

  it("mirrors the GDP-weighted regional growth when the country has no national doc", async () => {
    db.collectionMocks.federalBudget!.find = vi.fn().mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "FR", countryId: "FR", taxRates: FED_TAX_RATES, taxBases: { ...FED_BASES } },
        ]),
    });
    db.collectionMocks.macroMetrics!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "FR_IDF", economic: { gdpGrowth: { value: -8 } } },
        { _id: "FR_ARA", economic: { gdpGrowth: { value: 4 } } },
      ]),
    });
    db.collectionMocks.states!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "FR_IDF", countryId: "FR", gdp: 300 },
        { _id: "FR_ARA", countryId: "FR", gdp: 100 },
      ]),
    });
    const { processFiscalBaseGrowth } = await import("./fiscalBaseGrowth");
    await processFiscalBaseGrowth(1);
    const calls = db.collectionMocks.federalBudget!.updateOne.mock.calls;
    const factorSet = calls.find((c) => c[1]?.$set?.["economicFactors.gdpGrowth"] != null)?.[1]
      .$set;
    expect(factorSet["economicFactors.gdpGrowth"]).toBeCloseTo(-5, 9);
  });

  it("recomputes federal revenue off the grown bases", async () => {
    const revenue = await import("@/lib/budget/revenue");
    const { processFiscalBaseGrowth } = await import("./fiscalBaseGrowth");
    await processFiscalBaseGrowth(1);

    expect(revenue.calculateFederalRevenue).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "federal"
    );
    const calls = db.collectionMocks.federalBudget!.updateOne.mock.calls;
    expect(calls.some((c) => c[1]?.$set?.revenue?.total === 42)).toBe(true);
  });

  it("grows state bases by the STATE's own per-turn factors", async () => {
    const { processFiscalBaseGrowth } = await import("./fiscalBaseGrowth");
    const out = await processFiscalBaseGrowth(1);

    const ops = db.collectionMocks.stateBudgets!.bulkWrite.mock.calls[0]?.[0];
    const caBases = ops?.[0]?.updateOne?.update?.$set?.taxBases;
    // CA wageGrowth is 6 (its own), not the national 3.
    //
    // `TAX_BASE_GROWTH_PREMIUM_CAP` does NOT bind here, and that is the point of
    // leaving this expectation at the raw 6: the ceiling is nominal GDP growth
    // plus the premium — CA's gdpGrowth 3 + inflation 2 + 2 = 7 — so an ordinary
    // wage rate passes through untouched. The cap is a guard against divergence,
    // not a tax on normal growth (#1323).
    expect(6).toBeLessThan(3 + 2 + TAX_BASE_GROWTH_PREMIUM_CAP);
    expect(caBases.taxableIncome).toBeCloseTo(100 * (1 + 6 / 100 / TURNS_PER_YEAR), 6);
    expect(out.statesProcessed).toBe(1);
    expect(out.countriesProcessed).toBe(1);
  });
});
