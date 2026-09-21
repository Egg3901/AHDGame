import { describe, expect, it } from "vitest";
import { runLegislativeModernizationSimulation } from "./legislativeModernization2026-09-21";

describe("legislative modernization simulation", () => {
  it("passes the generalized accounting and parity invariants", () => {
    const result = runLegislativeModernizationSimulation();
    expect(result.invariants).toEqual({
      nationalMoneyConserved: true,
      allocationTotalsAuthority: true,
      regionalMoneyConserved: true,
      revenueShockDoesNotRepeal: true,
      countryFixtureEquivalent: true,
      stanceDoesNotConflict: true,
    });
    expect(result.parity.catalogErrors).toEqual([]);
  });
});
