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

  it("never overfunds the final claim when proportional rounding leaves a residual", () => {
    const result = settleRegionalBudget({
      availableBudget: 2,
      claims: [claim("a", 1), claim("b", 1), claim("c", 1)],
    });
    expect(result.programs.map((program) => program.fundedAmount)).toEqual([1, 1, 0]);
    expect(result.programs.every((program) => program.unfundedAmount >= 0)).toBe(true);
    expect(result.totalFunded).toBe(2);
  });

  it("honors legal obligation priority before continuity inside the same funding class", () => {
    const result = settleRegionalBudget({
      availableBudget: 20,
      claims: [
        claim("continuing-low", 20, { continuing: true, obligationPriority: 7 }),
        claim("new-high", 20, { obligationPriority: 1 }),
      ],
    });
    expect(Object.fromEntries(result.programs.map((p) => [p.programId, p.fundedAmount]))).toEqual({
      "continuing-low": 0,
      "new-high": 20,
    });
  });

  it("rejects duplicate ids and non-finite money instead of corrupting reconciliation", () => {
    expect(() =>
      settleRegionalBudget({
        availableBudget: 10,
        claims: [claim("duplicate", 5), claim("duplicate", 5)],
      })
    ).toThrow("duplicate regional program");
    expect(() => settleRegionalBudget({ availableBudget: Number.NaN, claims: [] })).toThrow(
      "availableBudget must be finite"
    );
  });

  it("keeps zero-cost programs fully implemented without consuming budget", () => {
    const result = settleRegionalBudget({
      availableBudget: 0,
      claims: [claim("zero-cost", 0)],
    });

    expect(result).toMatchObject({ totalAuthorized: 0, totalFunded: 0, totalUnfunded: 0 });
    expect(result.programs).toEqual([
      expect.objectContaining({
        programId: "zero-cost",
        fundedAmount: 0,
        unfundedAmount: 0,
        implementationFactor: 1,
      }),
    ]);
  });
});
