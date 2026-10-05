import { describe, expect, it } from "vitest";
import {
  annualProgramFundingRequest,
  departmentFundingPreview,
  programFundingRequestPerTurn,
} from "./programRequest";

describe("program funding requests", () => {
  it("converts any valid Cabinet percentage into the exact turn request", () => {
    expect(annualProgramFundingRequest(4_800, 137)).toBe(6_576);
    expect(programFundingRequestPerTurn(4_800, 75, 2)).toBe(75);
    expect(programFundingRequestPerTurn(4_800, 150, 2)).toBe(150);
  });

  it("uses the same deterministic remainder distribution as settlement", () => {
    const annual = annualProgramFundingRequest(101, 75);
    expect(annual).toBe(76);
    expect(
      Array.from({ length: 48 }, (_, index) =>
        programFundingRequestPerTurn(101, 75, index + 1)
      ).reduce((sum, amount) => sum + amount, 0)
    ).toBe(annual);
  });

  it("previews remaining allocation after committed cash and the next appropriation", () => {
    expect(
      departmentFundingPreview({
        annualAuthority: 4_800,
        balance: 100,
        encumbered: 20,
        arrears: 10,
        requestedPerTurn: 200,
        turn: 2,
      })
    ).toEqual({ authorityPerTurn: 100, availableForPrograms: 170, allocationRemaining: -30 });
  });

  it("rejects invalid annual demands and allocation percentages", () => {
    expect(() => annualProgramFundingRequest(-1, 100)).toThrow("family annual demand");
    expect(() => annualProgramFundingRequest(100, 201)).toThrow("integer percent");
  });
});
