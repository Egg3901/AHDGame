import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_CAPITAL_GDP_CAP,
  publicCapitalFormationShare,
  combineAdditionalCapitalInvestment,
} from "./publicCapital";

describe("publicCapitalFormationShare", () => {
  it("gives lagging economies more room to turn development spend into new capital", () => {
    expect(publicCapitalFormationShare(500, 2_500)).toBeGreaterThan(
      publicCapitalFormationShare(2_500, 2_500)
    );
  });

  it("is bounded for invalid or extreme income gaps", () => {
    expect(publicCapitalFormationShare(0, 2_500)).toBeLessThanOrEqual(0.65);
    expect(publicCapitalFormationShare(Number.NaN, 2_500)).toBeGreaterThan(0);
  });
});

describe("combineAdditionalCapitalInvestment", () => {
  it("converts annual budget-backed public capital to the per-turn cadence", () => {
    const perTurn = combineAdditionalCapitalInvestment({
      outputAnnualLocalMillions: 10_000,
      publicCapitalBudgetAnnualLocalMillions: 1_000,
      corporateInvestmentPerTurnLocalMillions: 0,
      ownPcAnchor: 1_000,
      frontierPcAnchor: 2_500,
      turnsPerYear: 50,
    });
    expect(perTurn).toBeGreaterThan(0);
    expect(perTurn).toBeLessThanOrEqual((10_000 * ADDITIONAL_CAPITAL_GDP_CAP) / 50);
  });

  it("caps public and corporate investment together", () => {
    const perTurn = combineAdditionalCapitalInvestment({
      outputAnnualLocalMillions: 10_000,
      publicCapitalBudgetAnnualLocalMillions: 10_000,
      corporateInvestmentPerTurnLocalMillions: 100,
      ownPcAnchor: 500,
      frontierPcAnchor: 2_500,
      turnsPerYear: 50,
    });
    expect(perTurn).toBeCloseTo((10_000 * ADDITIONAL_CAPITAL_GDP_CAP) / 50);
  });

  it("is inert without usable output or cadence", () => {
    expect(
      combineAdditionalCapitalInvestment({
        outputAnnualLocalMillions: 0,
        publicCapitalBudgetAnnualLocalMillions: 1_000,
        corporateInvestmentPerTurnLocalMillions: 10,
        ownPcAnchor: 500,
        frontierPcAnchor: 2_500,
        turnsPerYear: 50,
      })
    ).toBe(0);
  });
});
