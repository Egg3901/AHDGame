import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/budget/costs", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/budget/costs")>();
  return {
    ...actual,
    getSelectedPolicyOption: vi.fn(() => ({ name: "Second University" })),
    calculatePolicyOptionAnnualCost: vi.fn(() => 1_000_000_000),
  };
});
vi.mock("@/lib/budget/spending", () => ({
  resolveNationalGdpPerCapita: vi.fn(async () => 10_000),
  resolveNationalMedianIncome: vi.fn(async () => 10_000),
}));
vi.mock("@/lib/politicalLegislation/fiscalBase", () => ({
  countryFiscalBase: vi.fn(async () => ({ gdp: 1, population: 1 })),
  regionFiscalBase: vi.fn(async () => ({ gdp: 1, population: 1 })),
}));

import { validateStateBudgetImpact } from "./validation";

describe("validateStateBudgetImpact funding source", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("stateBudgets");
    db.collection("regionalBudgets");
    db.collection("states");
    db.collection("legislationTypes");
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn(async () => [{ _id: "university", budgetCost: 0 }]),
    });
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "BY",
      countryId: "DE",
      population: 10_000_000,
      gdp: 200_000,
    });
  });

  it("funds a German regional bill from the live regional surplus, even when the legacy state budget is stale", async () => {
    db.collectionMocks.stateBudgets.findOne.mockResolvedValue({
      _id: "BY",
      countryId: "DE",
      revenue: { total: 100_000_000 },
      spending: { total: 100_000_000 },
      balance: 0,
      stateGdp: 100_000_000,
    });
    db.collectionMocks.regionalBudgets.findOne.mockResolvedValue({
      _id: "BY",
      countryId: "DE",
      totalBudget: 90_000_000_000,
      enactedBillCosts: 20_000_000_000,
      subsidyCosts: 0,
      surplus: 70_000_000_000,
    });

    const result = await validateStateBudgetImpact(db as unknown as Db, "BY", "DE", {
      legislationTypeId: "university",
      effectDirection: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.newBalance).toBe(69_000_000_000);
    expect(result.newTotalSpending).toBe(21_000_000_000);
  });

  it("rejects a German regional bill when its cost exceeds the live surplus", async () => {
    db.collectionMocks.regionalBudgets.findOne.mockResolvedValue({
      _id: "BY",
      countryId: "DE",
      totalBudget: 90_000_000_000,
      surplus: 500_000_000,
    });

    const result = await validateStateBudgetImpact(db as unknown as Db, "BY", "DE", {
      legislationTypeId: "university",
      effectDirection: 1,
    });

    expect(result.allowed).toBe(false);
    expect(result.shortfall).toBe(500_000_000);
  });

  it("continues to use revenue and accumulated balance for US state bills", async () => {
    db.collectionMocks.stateBudgets.findOne.mockResolvedValue({
      _id: "TX",
      countryId: "US",
      revenue: { total: 2_000_000_000 },
      spending: { total: 1_000_000_000 },
      balance: 1_000_000_000,
      stateGdp: 100_000_000_000,
    });

    const result = await validateStateBudgetImpact(db as unknown as Db, "TX", "US", {
      legislationTypeId: "university",
      effectDirection: 1,
    });

    expect(result.allowed).toBe(true);
    expect(result.newBalance).toBe(1_000_000_000);
    expect(db.collectionMocks.regionalBudgets.findOne).not.toHaveBeenCalled();
  });
});
