import { describe, expect, it } from "vitest";
import type { DepartmentAccount } from "@/lib/db/types/budget";
import {
  resolveDepartmentDeliveryExpectations,
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

  it("fails an expected administered law closed when its program is missing", () => {
    const result = resolveDepartmentDeliveryMultipliers({
      currentTurn: 8,
      accounts: {},
      expectedLawIds: new Set(["uk.health.universalCare.primary"]),
    });
    expect(result.get("uk.health.universalCare.primary")).toBe(0);
  });

  it("forces national delivery to zero for a regional-only responsibility model", () => {
    const lawId = "uk.health.universalCare.primary";
    const result = resolveDepartmentDeliveryMultipliers({
      currentTurn: 7,
      expectedLawIds: new Set([lawId]),
      nationalDeliveryExcludedLawIds: new Set([lawId]),
      accounts: {
        department: account({
          program: {
            programId: "program",
            legislationTypeId: lawId,
            policyOptionId: "l4",
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
    expect(result.get(lawId)).toBe(0);
  });
});

describe("resolveDepartmentDeliveryExpectations", () => {
  it("recognizes legacy US laws and authored regional-only defaults", () => {
    const result = resolveDepartmentDeliveryExpectations(
      [
        {
          legislationTypeId: "us.fixture",
          policyOptionIndex: 0,
        },
      ],
      [
        {
          _id: "us.fixture",
          administration: {
            primaryPortfolioId: "health",
            lawKind: "service_program",
            implementationMode: "direct",
            allowedJurisdictionModes: ["regional_discretion"],
            defaultJurisdictionMode: "regional_discretion",
            policyFamilyId: "us.fixture",
          },
          policyOptions: [
            {
              id: "option",
              name: "Option",
              stance: "center",
              effectDirection: 1,
              economic: 0,
              social: 0,
              implementation: {
                programId: "us.fixture:option",
                fundingSemantics: "appropriation_included",
                appropriationClass: "operating",
                obligationPriority: 5,
              },
            },
          ],
        },
      ]
    );
    expect(result.expectedByCountry.get("US")).toEqual(new Set(["us.fixture"]));
    expect(result.excludedByCountry.get("US")).toEqual(new Set(["us.fixture"]));
  });
});

describe("resolveRegionalDeliveryMultipliers", () => {
  it("uses settlements through their cadence window and fails stale delivery closed", () => {
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
        validThroughTurn: 9,
      },
    };
    expect(
      resolveRegionalDeliveryMultipliers(programs, 7).get("uk.health.universalCare.primary")
    ).toBe(0.4);
    expect(
      resolveRegionalDeliveryMultipliers(programs, 8).get("uk.health.universalCare.primary")
    ).toBe(0.4);
    expect(
      resolveRegionalDeliveryMultipliers(programs, 10).get("uk.health.universalCare.primary")
    ).toBe(0);
  });

  it("treats legacy settlements without a validity window as single-turn records", () => {
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
      resolveRegionalDeliveryMultipliers(programs, 8).get("uk.health.universalCare.primary")
    ).toBe(0);
  });
});
