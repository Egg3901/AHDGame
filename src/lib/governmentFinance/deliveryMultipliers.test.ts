import { describe, expect, it } from "vitest";
import type { DepartmentAccount } from "@/lib/db/types/budget";
import {
  resolveDepartmentDeliveryMultipliers,
  resolveRegionalDeliveryMultipliers,
} from "./deliveryMultipliers";

function account(programs: DepartmentAccount["programs"]): DepartmentAccount {
  return {
    departmentId: "department",
    portfolioId: "health",
    portfolioIds: ["health"],
    accountPolicyId: "civil_operating",
    balance: 0,
    encumbered: 0,
    arrears: 0,
    accruedThroughTurn: 7,
    capacityPools: {},
    programs,
  };
}

describe("resolveDepartmentDeliveryMultipliers", () => {
  it("maps current political-law programs to their delivered share", () => {
    const result = resolveDepartmentDeliveryMultipliers({
      currentTurn: 7,
      accounts: {
        department: account({
          program: {
            programId: "program",
            legislationTypeId: "uk.health.universalCare.primary",
            policyOptionId: "l4",
            status: "operating",
            annualDemand: 100,
            periodDemand: 10,
            authorityThisTurn: 10,
            obligated: 4,
            outlaid: 4,
            arrears: 0,
            fundingRatio: 0.8,
            capacityRatio: 0.5,
            coverageRatio: 1,
            rampFactor: 1,
            implementationFactor: 0.4,
            bindingConstraint: "capacity",
            lastSettledTurn: 7,
          },
        }),
      },
    });
    expect(result.get("uk.health.universalCare.primary")).toBe(0.4);
  });

  it("fails stale settlements closed and bridges the public-health slice id", () => {
    const result = resolveDepartmentDeliveryMultipliers({
      currentTurn: 8,
      accounts: {
        department: account({
          program: {
            programId: "program",
            legislationTypeId: "us_public_health",
            policyOptionId: "public_health_opt_1",
            status: "operating",
            annualDemand: 100,
            periodDemand: 10,
            authorityThisTurn: 10,
            obligated: 10,
            outlaid: 10,
            arrears: 0,
            fundingRatio: 1,
            capacityRatio: 1,
            coverageRatio: 1,
            rampFactor: 1,
            implementationFactor: 1,
            bindingConstraint: "none",
            lastSettledTurn: 7,
          },
        }),
      },
    });
    expect(result.get("us.health.prevention.primary")).toBe(0);
  });
});

describe("resolveRegionalDeliveryMultipliers", () => {
  it("uses current settlements and fails stale regional delivery closed", () => {
    const programs = {
      program: {
        programId: "program",
        legislationTypeId: "uk.health.universalCare.primary",
        policyOptionId: "l4",
        authorizedCost: 100,
        fundedAmount: 40,
        unfundedAmount: 60,
        implementationFactor: 0.4,
        obligationPriority: 5,
        lastSettledTurn: 7,
      },
    };
    expect(
      resolveRegionalDeliveryMultipliers(programs, 7).get("uk.health.universalCare.primary")
    ).toBe(0.4);
    expect(
      resolveRegionalDeliveryMultipliers(programs, 8).get("uk.health.universalCare.primary")
    ).toBe(0);
  });
});
