import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { includedAuthorityPerTurn } from "./appropriation";

describe("includedAuthorityPerTurn", () => {
  it("conserves an annual integer amount across every full turn window", () => {
    for (const annual of [0, 1, 25, 47, 48, 49, 100, 4_801, 134_078_460_000_000]) {
      const firstYear = Array.from({ length: TURNS_PER_YEAR }, (_, index) =>
        includedAuthorityPerTurn(annual, index + 1)
      );
      const secondYear = Array.from({ length: TURNS_PER_YEAR }, (_, index) =>
        includedAuthorityPerTurn(annual, TURNS_PER_YEAR + index + 1)
      );
      expect(firstYear.reduce((sum, amount) => sum + amount, 0)).toBe(annual);
      expect(secondYear).toEqual(firstYear);
    }
  });

  it("rejects invalid money and turn inputs", () => {
    expect(() => includedAuthorityPerTurn(Number.NaN, 1)).toThrow("annualAuthority must be finite");
    expect(() => includedAuthorityPerTurn(Number.MAX_SAFE_INTEGER + 1, 1)).toThrow("safe integer");
    expect(() => includedAuthorityPerTurn(100, 0)).toThrow("turn must be a positive integer");
    expect(() => includedAuthorityPerTurn(100, 1.5)).toThrow("turn must be a positive integer");
  });
});
