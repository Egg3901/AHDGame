import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { calculateFederalLawAnnualCosts } from "@/lib/budget/spending";
import { processDepartmentProgramSettlement } from "./departmentProgramSettlement";

vi.mock("@/lib/budget/spending", () => ({
  calculateFederalLawAnnualCosts: vi.fn(),
}));

const law = {
  _id: new ObjectId(),
  billId: new ObjectId(),
  legislationTypeId: "us_public_health",
  title: "Public Health Workforce Expansion Act",
  scope: "national",
  countryId: "US",
  budgetCost: 0,
  annualCostPerCapita: 93,
  policyOptionIndex: 1,
  budgetCategory: "healthcare",
  enactedAt: new Date(0),
  enactedYear: 2026,
} as const;

const legislationType = {
  _id: "us_public_health",
  administration: {
    primaryPortfolioId: "health",
    primaryDepartmentId: "us_health_department",
    responsiblePositionId: "secretary_of_health",
    jurisdictionMode: "national_direct",
  },
  policyOptions: [
    { id: "public_health_opt_0" },
    {
      id: "public_health_opt_1",
      implementation: {
        programId: "us_public_health_workforce",
        fundingSemantics: "appropriation_included",
        appropriationClass: "operating",
        obligationPriority: 6,
        capacityType: "public_health_operations",
        outcome: { category: "healthcare", metricId: "publicHealthPreparedness" },
      },
    },
  ],
};

function seedDb() {
  const memory = createInMemoryDb();
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      treasuryBalance: 10_000,
      gdp: 1_000_000,
      revenue: { total: 20_000 },
      spending: {
        byCategory: { healthcare: 9_300 },
        stateGrants: 0,
        debtInterest: 0,
        total: 9_300,
      },
    },
  ]);
  memory.seed("legislationTypes", [legislationType]);
  return memory;
}

describe("processDepartmentProgramSettlement", () => {
  beforeEach(() => {
    vi.mocked(calculateFederalLawAnnualCosts).mockResolvedValue({
      items: [{ law: law as never, amount: 9_300 }],
      eraYear: null,
      commandEconomyEnabled: false,
    });
  });

  it("is inert while the flag is off", async () => {
    const memory = seedDb();
    const result = await processDepartmentProgramSettlement(memory as unknown as Db, 10, {});
    expect(result).toMatchObject({ enabled: false, programsSettled: 0 });
    const budget = await (memory as unknown as Db)
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "US" });
    expect(budget?.departmentAccounts).toBeUndefined();
  });

  it("accrues and settles without touching treasury, then replays as a no-op", async () => {
    const memory = seedDb();
    const db = memory as unknown as Db;
    const first = await processDepartmentProgramSettlement(db, 10, {
      departmentProgramSliceEnabled: true,
    });
    expect(first).toMatchObject({
      enabled: true,
      programsSettled: 1,
      reconciliation: "balanced",
    });
    const afterFirst = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "US" });
    expect(afterFirst?.treasuryBalance).toBe(10_000);
    expect(afterFirst?.departmentAccounts?.us_health_department?.accruedThroughTurn).toBe(10);
    expect(
      afterFirst?.departmentAccounts?.us_health_department?.programs.us_public_health_workforce
        ?.implementationFactor
    ).toBe(0.4);

    const replay = await processDepartmentProgramSettlement(db, 10, {
      departmentProgramSliceEnabled: true,
    });
    expect(replay).toMatchObject({ enabled: true, programsSettled: 0 });
    const afterReplay = await db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: "US" });
    expect(afterReplay?.departmentAccounts?.us_health_department).toEqual(
      afterFirst?.departmentAccounts?.us_health_department
    );
  });

  it("winds down when the selected law is no longer active", async () => {
    const memory = seedDb();
    const db = memory as unknown as Db;
    await processDepartmentProgramSettlement(db, 10, { departmentProgramSliceEnabled: true });
    vi.mocked(calculateFederalLawAnnualCosts).mockResolvedValue({
      items: [],
      eraYear: null,
      commandEconomyEnabled: false,
    });
    const result = await processDepartmentProgramSettlement(db, 11, {
      departmentProgramSliceEnabled: true,
    });
    expect(result.programsSettled).toBe(1);
    const after = await db.collection<FederalBudget>("federalBudget").findOne({ countryId: "US" });
    expect(
      after?.departmentAccounts?.us_health_department?.programs.us_public_health_workforce?.status
    ).toBe("closed");
  });
});
