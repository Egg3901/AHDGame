import { describe, expect, it } from "vitest";
import { fiscalBalanceGdpShare, fiscalDeficitPressure } from "../rules/fiscalDeficitPressure";
import { computeFiscalStance } from "../fiscalStance";

const calm = {
  agenda: [],
  inflationRate: 2,
  debtToGdpRatio: 0.3,
  personality: { ambition: 40, stubbornness: 40, loyalty: 50 },
  currentTurn: 70,
};

describe("autonomous fiscal deficit response", () => {
  it("responds to a large deficit before a low-debt country exhausts its headroom", () => {
    expect(computeFiscalStance({ ...calm, fiscalBalanceGdpShare: -0.1 }).stance).toBe("austere");
  });

  it("leaves a small deficit and unknown accounting unchanged", () => {
    const baseline = computeFiscalStance(calm);
    for (const fiscalBalanceGdpShare of [-0.02, 0, 0.1, Number.NaN]) {
      expect(computeFiscalStance({ ...calm, fiscalBalanceGdpShare })).toEqual(baseline);
    }
  });
});

describe("annual fiscal accounting", () => {
  it("uses the annual balance rather than nominal currency magnitude", () => {
    expect(fiscalBalanceGdpShare({ gdp: 1000, revenueTotal: 400, spendingTotal: 500 })).toBe(-0.1);
    expect(
      fiscalBalanceGdpShare({ gdp: 1000000, revenueTotal: 400000, spendingTotal: 500000 })
    ).toBe(-0.1);
  });
  it("does not invent a balance from missing or invalid accounting", () => {
    for (const gdp of [undefined, 0, -1, Infinity, NaN]) {
      expect(fiscalBalanceGdpShare({ gdp, revenueTotal: 400, spendingTotal: 500 })).toBeUndefined();
    }
    expect(fiscalBalanceGdpShare({ gdp: 1000, spendingTotal: 500 })).toBeUndefined();
    expect(
      fiscalBalanceGdpShare({ gdp: 1000, revenueTotal: -1, spendingTotal: 500 })
    ).toBeUndefined();
  });
  it("ramps continuously above ordinary deficits and caps the bias", () => {
    expect(fiscalDeficitPressure(-0.03)).toBe(0);
    expect(fiscalDeficitPressure(-0.04)).toBeCloseTo(0.2);
    expect(fiscalDeficitPressure(-0.08)).toBeCloseTo(1);
    expect(fiscalDeficitPressure(-0.5)).toBe(2);
  });
});
