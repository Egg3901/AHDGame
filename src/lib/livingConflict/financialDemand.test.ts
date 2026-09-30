import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Db } from "mongodb";
import { loadFinancialCrisisDemand } from "./financialDemand";
import { financialHouseholdDemandMultiplier } from "./rules/financialDemand";
import { computeHouseholdConsumption } from "@/lib/turn/householdConsumption";
import type { Corporation, FederalBudget } from "@/lib/db/types";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("financial flows into household order demand", () => {
  it("reduces actual consumer orders after credit contraction and responds to funded stimulus", () => {
    const input = {
      states: [{ stateId: "ENG", countryId: "UK", population: 1000000, gdp: 1000 }],
      metricsByState: new Map(),
    };
    const control = computeHouseholdConsumption(input).global.get("food")!;
    const contraction = financialHouseholdDemandMultiplier({
      gdp: 1000,
      currentCredit: 0,
      referenceCredit: 100,
      settledStimulus: 0,
    });
    const stimulus = financialHouseholdDemandMultiplier({
      gdp: 1000,
      currentCredit: 100,
      referenceCredit: 100,
      settledStimulus: 20,
    });
    expect(
      computeHouseholdConsumption({
        ...input,
        financialDemandByCountry: new Map([["UK", contraction]]),
      }).global.get("food")
    ).toBeCloseTo(control * 0.8);
    expect(
      computeHouseholdConsumption({
        ...input,
        financialDemandByCountry: new Map([["UK", stimulus]]),
      }).global.get("food")
    ).toBeCloseTo(control * 1.08);
  });
  it("is retry-stable and recovers after credit stabilizes, without invented transfers", async () => {
    const memory = createInMemoryDb(),
      db = memory as unknown as Db;
    memory.seed("livingConflicts", [
      { _id: "financial", defKey: "global_financial_crisis", hasOpened: true },
    ]);
    const budget = [{ countryId: "UK", currencyCode: "GBP", gdp: 1000 }] as FederalBudget[];
    const banks = [
      { countryId: "UK", bankCharter: { status: "active", currency: "GBP", totalLoans: 100 } },
    ] as Corporation[];
    expect((await loadFinancialCrisisDemand(db, 1, banks, budget)).get("UK")).toBe(1);
    banks[0].bankCharter!.totalLoans = 0;
    expect((await loadFinancialCrisisDemand(db, 2, banks, budget)).get("UK")).toBe(0.8);
    expect((await loadFinancialCrisisDemand(db, 2, banks, budget)).get("UK")).toBe(0.8);
    expect((await loadFinancialCrisisDemand(db, 15, banks, budget)).get("UK")).toBe(1);
  });
});
