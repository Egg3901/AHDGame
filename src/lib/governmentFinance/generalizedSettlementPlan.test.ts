import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { DepartmentAccount, EnactedLaw } from "@/lib/db/types/budget";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { createEmptyDepartmentAccount } from "./departments";
import { DEPARTMENT_DEFINITIONS } from "./departmentCatalog";
import { buildCountryDepartmentSettlementPlan } from "./generalizedSettlementPlan";

function law(
  typeId: string,
  optionIndex: number,
  jurisdictionMode?: EnactedLaw["jurisdictionMode"]
): EnactedLaw {
  return {
    _id: new ObjectId(),
    billId: new ObjectId(),
    legislationTypeId: typeId,
    title: typeId,
    scope: "national",
    countryId: "UK",
    budgetCost: 0,
    policyOptionIndex: optionIndex,
    budgetCategory: "healthcare",
    enactedAt: new Date(0),
    enactedYear: 2027,
    ...(jurisdictionMode ? { jurisdictionMode } : {}),
  };
}

function department(id: string) {
  return DEPARTMENT_DEFINITIONS.find((candidate) => candidate.id === id)!;
}

describe("generalized country department settlement plan", () => {
  it("shares typed capacity across programs in one department", () => {
    const plan = buildCountryDepartmentSettlementPlan({
      countryId: "UK",
      turn: 1,
      year: 2027,
      accounts: {},
      activeLawCosts: [
        { law: law("uk_nhs_funding", 3), amount: 4_800 },
        { law: law("uk_public_health", 3), amount: 4_800 },
      ],
      legislationTypes,
    });
    expect(plan.skippedPrograms).toEqual([]);
    expect(plan.settlements).toHaveLength(1);
    expect(plan.settlements[0]).toMatchObject({
      departmentId: "uk_health_department",
      authorityAccrued: 200,
      programOutlays: 50,
      closingBalance: 150,
    });
    expect(
      plan.settlements[0]!.programs.map((program) => ({
        capacity: program.implementation.capacityRatio,
        ramp: program.implementation.rampFactor,
        delivered: program.implementation.implementationFactor,
      }))
    ).toEqual([
      { capacity: 0.5, ramp: 0.5, delivered: 0.25 },
      { capacity: 0.5, ramp: 0.5, delivered: 0.25 },
    ]);
  });

  it("creates no national program for regional discretion", () => {
    const plan = buildCountryDepartmentSettlementPlan({
      countryId: "UK",
      turn: 1,
      year: 2027,
      accounts: {},
      activeLawCosts: [
        {
          law: law("uk_nhs_funding", 3, "regional_discretion"),
          amount: 4_800,
        },
      ],
      legislationTypes,
    });
    expect(plan.settlements).toEqual([]);
  });

  it("pays down retained encumbrance after a program leaves the active-law set", () => {
    const opening = createEmptyDepartmentAccount(department("uk_transport_department"));
    const account: DepartmentAccount = {
      ...opening,
      balance: 60,
      encumbered: 60,
      programs: {
        old_project: {
          programId: "old_project",
          legislationTypeId: "uk_transport_rail",
          policyOptionId: "uk_transport_rail_opt_3",
          status: "operating",
          annualDemand: 4_800,
          periodDemand: 100,
          authorityThisTurn: 100,
          obligated: 60,
          encumbered: 60,
          outlaid: 40,
          cumulativeOutlays: 40,
          arrears: 0,
          fundingRatio: 1,
          capacityRatio: 1,
          coverageRatio: 1,
          rampFactor: 1,
          implementationFactor: 1,
          bindingConstraint: "none",
          lastSettledTurn: 1,
        },
      },
    };
    const plan = buildCountryDepartmentSettlementPlan({
      countryId: "UK",
      turn: 2,
      year: 2027,
      accounts: { [account.departmentId]: account },
      activeLawCosts: [],
      legislationTypes,
    });
    expect(plan.settlements[0]).toMatchObject({
      authorityAccrued: 0,
      encumbrancePaid: 60,
      closingBalance: 0,
      closingEncumbered: 0,
    });
    expect(plan.settlements[0]!.programs[0]).toMatchObject({
      programId: "old_project",
      status: "winding_down",
      encumbrancePaid: 60,
      closingEncumbered: 0,
      newEncumbrance: 0,
    });
  });
});
