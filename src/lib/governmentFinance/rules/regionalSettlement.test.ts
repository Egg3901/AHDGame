import { describe, expect, it } from "vitest";
import { settleRegionalBudget, type RegionalProgramClaim } from "./regionalSettlement";

function claim(
  programId: string,
  authorizedCost: number,
  overrides: Partial<RegionalProgramClaim> = {}
): RegionalProgramClaim {
  return {
    programId,
    legislationTypeId: programId,
    policyOptionId: "option",
    authorizedCost,
    obligationPriority: 5,
    fundingSemantics: "appropriation_included",
    continuing: false,
    ...overrides,
  };
}

describe("settleRegionalBudget", () => {
  it("fully funds programs when the region has sufficient budget", () => {
    const result = settleRegionalBudget({
      availableBudget: 100,
      claims: [claim("a", 40), claim("b", 60)],
    });
    expect(result.totalFunded).toBe(100);
    expect(result.programs.every((program) => program.implementationFactor === 1)).toBe(true);
  });

  it("shares a same-tier shortfall proportionally and conserves cash", () => {
    const result = settleRegionalBudget({
      availableBudget: 50,
      claims: [claim("a", 40), claim("b", 60)],
    });
    expect(result.programs.map((program) => program.fundedAmount)).toEqual([20, 30]);
    expect(result.totalFunded).toBe(50);
    expect(result.totalUnfunded).toBe(50);
  });

  it("funds standing obligations and continuing programs before new programs", () => {
    const result = settleRegionalBudget({
      availableBudget: 70,
      reservedNonProgramSpending: 10,
      claims: [
        claim("new", 40),
        claim("continuing", 30, { continuing: true }),
        claim("mandatory", 30, { fundingSemantics: "standing_mandatory" }),
      ],
    });
    expect(Object.fromEntries(result.programs.map((p) => [p.programId, p.fundedAmount]))).toEqual({
      new: 0,
      continuing: 30,
      mandatory: 30,
    });
    expect(result.totalFunded).toBe(70);
  });
});
