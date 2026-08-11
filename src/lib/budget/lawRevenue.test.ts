import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateFederalRevenue } from "./revenue";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./publicEnterpriseRevenue", () => ({
  calculateCountryOwnedBudgetRevenue: vi.fn().mockResolvedValue({ healthcareIncome: 0, other: 0 }),
}));
vi.mock("./spending", () => ({
  calculateFederalSpending: vi
    .fn()
    .mockResolvedValue({ byCategory: {}, stateGrants: 0, debtInterest: 0, total: 0 }),
}));
vi.mock("@/lib/era/context", () => ({
  getEraContext: vi.fn().mockResolvedValue({ year: 1953 }),
}));

const UK_GDP = 14_400_000_000;

function ukBudget(other: number | undefined) {
  return {
    _id: "UK",
    countryId: "UK",
    gdp: UK_GDP,
    revenue: other === undefined ? undefined : { other },
    taxBases: {
      taxableIncome: 0.5 * UK_GDP,
      domesticCorporateProfits: 0.1 * UK_GDP * 0.75,
      foreignCorporateProfits: 0.1 * UK_GDP * 0.25,
      wagesAndSalaries: 0.5 * UK_GDP,
      importValue: 0.2 * UK_GDP,
      taxableSales: 0.35 * UK_GDP,
    },
  };
}

const UK_RATES = {
  incomeTax: 36,
  domesticCorporateTax: 35,
  foreignCorporateTax: 39,
  payrollTax: 7.2,
  tariffs: 0,
  salesTax: 0,
};

describe("revenue.lawRevenue (§5.1) + fallback guard", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function wire(budget: unknown, enactedLaws: unknown[]) {
    db.collectionMocks.federalBudget = {
      ...db.collectionMocks.federalBudget,
      findOne: vi.fn().mockResolvedValue(budget),
    } as typeof db.collectionMocks.federalBudget;
    db.collectionMocks.enactedLaws = {
      ...db.collectionMocks.enactedLaws,
      find: vi.fn().mockImplementation(() => ({
        toArray: vi.fn().mockResolvedValue(enactedLaws),
      })),
    } as typeof db.collectionMocks.enactedLaws;
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
  }

  it("sums annualRevenueV2 from scratch — two consecutive calls are identical", async () => {
    const budget = ukBudget(1_200_000_000);
    wire(budget, [{ annualRevenueV2: 10_000_000 }, { annualRevenueV2: 5_000_000 }]);
    const first = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    // Simulate a persisted re-read: the budget doc now carries the first result.
    wire({ ...budget, revenue: first }, [
      { annualRevenueV2: 10_000_000 },
      { annualRevenueV2: 5_000_000 },
    ]);
    const second = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    expect(first.lawRevenue).toBe(15_000_000);
    expect(second.lawRevenue).toBe(15_000_000);
    expect(second.other).toBe(first.other); // law revenue never folds into other
    expect(second.total).toBe(first.total);
  });

  it("keeps a legitimately-zero persisted `other` (no 200B snap)", async () => {
    wire(ukBudget(0), []);
    const revenue = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    expect(revenue.other).toBe(0);
    // Sanity: total stays 1953-scale (≈£3.6B derived), nowhere near 200B.
    expect(revenue.total).toBeLessThan(10_000_000_000);
  });

  it("legacy budgets with no persisted revenue keep the 200B fallback", async () => {
    wire({ ...ukBudget(undefined), countryId: "US", _id: "US", gdp: 27_000_000_000_000 }, []);
    const revenue = await calculateFederalRevenue(
      db as unknown as Db,
      { ...UK_RATES, incomeTax: 20 },
      "US"
    );
    expect(revenue.other).toBe(200_000_000_000);
  });

  it("lawRevenue sits INSIDE the era revenue cap (ruling #14)", async () => {
    // Push pre-cap revenue past the 40%-of-GDP knee with a huge law stack: the
    // capped total must be below the raw sum, while `other` stays untouched.
    const budget = ukBudget(1_200_000_000);
    wire(budget, [{ annualRevenueV2: 3_000_000_000 }]);
    const revenue = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    const rawSum =
      revenue.incomeTax +
      revenue.domesticCorporateTax +
      revenue.foreignCorporateTax +
      revenue.payrollTax +
      revenue.tariffs +
      revenue.salesTax +
      (revenue.solidaritySurcharge ?? 0) +
      (revenue.landValueAddedTax ?? 0) +
      (revenue.urbanMaintenanceTax ?? 0) +
      (revenue.stampDuty ?? 0) +
      (revenue.universalSocialCharge ?? 0) +
      (revenue.capitalGainsTax ?? 0) +
      (revenue.exciseDuty ?? 0) +
      (revenue.propertyTax ?? 0) +
      revenue.healthcareIncome +
      (revenue.lawRevenue ?? 0) +
      revenue.other;
    expect(revenue.lawRevenue).toBe(3_000_000_000);
    expect(rawSum / UK_GDP).toBeGreaterThan(0.4);
    expect(revenue.total).toBeLessThan(rawSum);
    expect(revenue.other).toBe(1_200_000_000);
  });

  it("budgets without v2 laws report lawRevenue 0 and an unchanged mix", async () => {
    wire(ukBudget(1_200_000_000), []);
    const revenue = await calculateFederalRevenue(db as unknown as Db, UK_RATES, "UK");
    expect(revenue.lawRevenue).toBe(0);
    expect(revenue.other).toBe(1_200_000_000);
  });
});
