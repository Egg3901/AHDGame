import { describe, expect, it } from "vitest";
import type { DepartmentAccount } from "@/lib/db/types/budget";
import {
  distributeAnnualRegionalGrantPool,
  resolveAnnualRegionalGrantPool,
} from "./grantTransfers";

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

  it("conserves integer currency with deterministic population shares", () => {
    const result = distributeAnnualRegionalGrantPool(10, [
      { id: "small", population: 1 },
      { id: "large", population: 2 },
    ]);
    expect(result).toEqual({ large: 7, small: 3 });
    expect(Object.values(result).reduce((sum, amount) => sum + amount, 0)).toBe(10);
  });

  it("uses equal shares for zero-population fixtures and rejects duplicate ids", () => {
    expect(
      distributeAnnualRegionalGrantPool(5, [
        { id: "b", population: 0 },
        { id: "a", population: 0 },
      ])
    ).toEqual({ a: 3, b: 2 });
    expect(() =>
      distributeAnnualRegionalGrantPool(1, [
        { id: "same", population: 1 },
        { id: "same", population: 2 },
      ])
    ).toThrow("unique ids");
  });
});
