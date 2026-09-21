import { describe, expect, it } from "vitest";
import { createEmptyUsHealthDepartmentAccount } from "./departments";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { DEPARTMENT_DEFINITIONS } from "./departmentCatalog";
import { buildDepartmentFinanceReadModel, buildPublicHealthProgramReadModel } from "./readModel";

describe("buildPublicHealthProgramReadModel", () => {
  it("withholds partial financial state when the slice is disabled", () => {
    const view = buildPublicHealthProgramReadModel({
      enabled: false,
      departmentName: "U.S. Department of Health and Human Services",
      account: createEmptyUsHealthDepartmentAccount(),
      delivery: { multiplier: 1, reason: "feature_disabled" },
    });

    expect(view).toMatchObject({ enabled: false, status: "not_started" });
    expect(view).not.toHaveProperty("annualDemand");
    expect(view).not.toHaveProperty("capacity");
  });

  it("explains money, capacity, constraint, and outcome delivery separately", () => {
    const account = createEmptyUsHealthDepartmentAccount();
    account.balance = 120;
    account.encumbered = 20;
    account.programs.us_public_health_workforce = {
      programId: "us_public_health_workforce",
      legislationTypeId: "us_public_health",
      policyOptionId: "public_health_opt_1",
      status: "operating",
      annualDemand: 9_300,
      periodDemand: 194,
      authorityThisTurn: 146,
      obligated: 100,
      outlaid: 80,
      arrears: 0,
      fundingRatio: 0.75,
      capacityRatio: 0.8,
      coverageRatio: 1,
      rampFactor: 0.5,
      implementationFactor: 0.3,
      bindingConstraint: "ramp",
      lastSettledTurn: 4,
    };

    expect(
      buildPublicHealthProgramReadModel({
        enabled: true,
        departmentName: "U.S. Department of Health and Human Services",
        account,
        delivery: {
          multiplier: 0.3,
          reason: "current_settlement",
          program: account.programs.us_public_health_workforce,
        },
      })
    ).toMatchObject({
      enabled: true,
      status: "operating",
      availableBalance: 100,
      encumbered: 20,
      outlaid: 80,
      arrears: 0,
      ratios: { funding: 0.75, capacity: 0.8, implementation: 0.3 },
      bindingConstraint: "ramp",
      outcome: { deliveredShare: 0.3, reason: "current_settlement" },
    });
  });
});

describe("buildDepartmentFinanceReadModel", () => {
  it("explains an institution-owned account and all settled programs", () => {
    const account = createEmptyUsHealthDepartmentAccount();
    account.balance = 120;
    account.encumbered = 20;
    account.arrears = 5;
    account.programs.us_public_health_workforce = {
      programId: "us_public_health_workforce",
      legislationTypeId: "us_public_health",
      policyOptionId: "public_health_opt_1",
      status: "operating",
      annualDemand: 9_300,
      periodDemand: 194,
      authorityThisTurn: 146,
      obligated: 100,
      encumbered: 20,
      outlaid: 80,
      cumulativeOutlays: 800,
      arrears: 0,
      fundingRatio: 0.75,
      capacityRatio: 0.8,
      coverageRatio: 1,
      rampFactor: 0.5,
      implementationFactor: 0.3,
      bindingConstraint: "ramp",
      lastSettledTurn: 4,
    };
    const definition = DEPARTMENT_DEFINITIONS.find(
      (candidate) => candidate.id === "us_health_department"
    )!;
    const model = buildDepartmentFinanceReadModel({
      enabled: true,
      definition,
      departmentName: definition.canonicalName,
      account,
      legislationTypes,
    });
    expect(model).toMatchObject({
      departmentId: "us_health_department",
      balance: 120,
      availableBalance: 100,
      encumbered: 20,
      arrears: 5,
      programs: [
        {
          programName: "Public Health Workforce Expansion Act",
          ratios: { funding: 0.75, capacity: 0.8, implementation: 0.3 },
          outcome: { label: "Public Health Preparedness", deliveredShare: 0.3 },
        },
      ],
    });
  });
});
