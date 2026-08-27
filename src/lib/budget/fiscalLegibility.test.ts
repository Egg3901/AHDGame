import { describe, expect, it } from "vitest";
import { deriveFiscalLegibility } from "./fiscalLegibility";

describe("deriveFiscalLegibility", () => {
  it("separates the raw debt burden, smoothed solvency burden, and primary balance", () => {
    const result = deriveFiscalLegibility({
      debtPrincipal: 150,
      rawGdp: 100,
      smoothedGdp: 120,
      revenue: 90,
      spending: 105,
      debtInterest: 20,
    });

    expect(result.rawDebtToGdp).toBe(1.5);
    expect(result.solvencyDebtToGdp).toBe(1.25);
    expect(result.primaryBalance).toBe(5);
    expect(result.overallBalance).toBe(-15);
  });

  it("uses raw GDP when a smoothed denominator is unavailable", () => {
    const result = deriveFiscalLegibility({
      debtPrincipal: 50,
      rawGdp: 200,
      smoothedGdp: 0,
      revenue: 100,
      spending: 110,
      debtInterest: 10,
    });

    expect(result.rawDebtToGdp).toBe(0.25);
    expect(result.solvencyDebtToGdp).toBe(0.25);
    expect(result.primaryBalance).toBe(0);
    expect(result.overallBalance).toBe(-10);
  });
});
