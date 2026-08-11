import { describe, expect, it } from "vitest";
import {
  calculateBondYieldToMaturityPercent,
  CORPORATE_BOND_SPREAD_PREMIUM,
  CORPORATE_BOND_TERM_PREMIUMS,
  getBondCouponRate,
} from "./bonds";
import { CREDIT_RATING_SPREADS } from "@/lib/db/types/centralBank";

describe("getBondCouponRate", () => {
  it("adds tier spread and corporate premium over prime", () => {
    const prime = 2.5;
    expect(CORPORATE_BOND_SPREAD_PREMIUM).toBeGreaterThan(0);
    expect(getBondCouponRate(prime, "AAA")).toBe(
      Math.round((prime + CREDIT_RATING_SPREADS.AAA + CORPORATE_BOND_SPREAD_PREMIUM) * 100) / 100
    );
    expect(getBondCouponRate(prime, "CCC")).toBe(
      Math.round((prime + CREDIT_RATING_SPREADS.CCC + CORPORATE_BOND_SPREAD_PREMIUM) * 100) / 100
    );
  });

  it("adds no term premium for 2yr bond", () => {
    const prime = 2.5;
    expect(getBondCouponRate(prime, "AA", 96)).toBe(
      Math.round((prime + CREDIT_RATING_SPREADS.AA + CORPORATE_BOND_SPREAD_PREMIUM) * 100) / 100
    );
  });

  it("adds 1.0pp term premium for 5yr bond", () => {
    const prime = 2.5;
    expect(getBondCouponRate(prime, "AA", 240)).toBe(
      Math.round((prime + CREDIT_RATING_SPREADS.AA + CORPORATE_BOND_SPREAD_PREMIUM + 1.0) * 100) /
        100
    );
  });

  it("adds 1.75pp term premium for 7yr bond", () => {
    const prime = 2.5;
    expect(getBondCouponRate(prime, "AA", 336)).toBe(
      Math.round((prime + CREDIT_RATING_SPREADS.AA + CORPORATE_BOND_SPREAD_PREMIUM + 1.75) * 100) /
        100
    );
  });

  it("defaults to no term premium when maturityTurns is omitted", () => {
    const prime = 2.5;
    expect(getBondCouponRate(prime, "AA")).toBe(getBondCouponRate(prime, "AA", 96));
  });

  it("exports CORPORATE_BOND_TERM_PREMIUMS with correct values", () => {
    expect(CORPORATE_BOND_TERM_PREMIUMS[96]).toBe(0);
    expect(CORPORATE_BOND_TERM_PREMIUMS[240]).toBe(1.0);
    expect(CORPORATE_BOND_TERM_PREMIUMS[336]).toBe(1.75);
  });
});

describe("calculateBondYieldToMaturityPercent", () => {
  it("matches the coupon rate when a bond trades at par with one year remaining", () => {
    expect(calculateBondYieldToMaturityPercent(8.5, 1, 48)).toBeCloseTo(8.5, 6);
  });

  it("returns zero for matured bonds", () => {
    expect(calculateBondYieldToMaturityPercent(8.5, 1.01, 0)).toBe(0);
  });

  it("matches the live Japan example from the bonds table", () => {
    expect(calculateBondYieldToMaturityPercent(8.5, 1.01088, 37)).toBeCloseTo(7.01, 2);
  });
});
