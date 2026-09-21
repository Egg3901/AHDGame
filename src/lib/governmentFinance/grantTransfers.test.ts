import { describe, expect, it } from "vitest";
import type { DepartmentAccount } from "@/lib/db/types/budget";
import { resolveAnnualRegionalGrantPool } from "./grantTransfers";

function account(): DepartmentAccount {
  return {
    departmentId: "department",
    portfolioId: "interior_local_government",
    balance: 0,
    encumbered: 0,
    accruedThroughTurn: 10,
    capacityPools: {},
    programs: {
      grant: {
        programId: "grant",
        legislationTypeId: "grant_law",
        policyOptionId: "current",
        status: "operating",
        annualDemand: 1_000,
        periodDemand: 20,
        authorityThisTurn: 10,
        obligated: 10,
        outlaid: 10,
        arrears: 0,
        fundingRatio: 0.5,
        capacityRatio: 1,
        coverageRatio: 1,
        rampFactor: 1,
        implementationFactor: 0.5,
        bindingConstraint: "funding",
        jurisdictionMode: "grant_supported_regional",
        implementationMode: "formula_grant",
        lastSettledTurn: 10,
      },
    },
  };
}

describe("regional grant transfer", () => {
  it("annualizes delivered grant authority without creating another debit", () => {
    expect(
      resolveAnnualRegionalGrantPool({ accounts: { department: account() }, currentTurn: 10 })
    ).toEqual({ hasProgram: true, annualPool: 500 });
  });

  it("fails stale grants closed", () => {
    expect(
      resolveAnnualRegionalGrantPool({ accounts: { department: account() }, currentTurn: 11 })
    ).toEqual({ hasProgram: true, annualPool: 0 });
  });
});
