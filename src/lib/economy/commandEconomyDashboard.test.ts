import { describe, it, expect } from "vitest";
import {
  presentSoe,
  computeMarketizationDrivers,
  gosbankCostLabel,
  regimeFromLevel,
  type RawSoe,
} from "./commandEconomyDashboard";

function raw(overrides: Partial<RawSoe> = {}): RawSoe {
  return {
    corpId: "c1",
    corpName: "Uralmash",
    sector: "manufacturing",
    output: 80,
    planTarget: 100,
    capacity: 110,
    efficiency: 1,
    cumulativeLosses: 0,
    directorId: null,
    directorName: null,
    laborQuality: null,
    investmentRequest: null,
    directedCreditLastTurn: null,
    ...overrides,
  };
}

describe("presentSoe", () => {
  it("computes plan fulfillment and flags the viewer's directorship", () => {
    const v = presentSoe(raw({ output: 80, planTarget: 100, directorId: "char-1" }), "char-1");
    expect(v.planFulfillment).toBeCloseTo(0.8, 5);
    expect(v.viewerIsDirector).toBe(true);
    expect(v.vacant).toBe(false);
    expect(v.sectorLabel).toBe("Manufacturing");
  });

  it("a different viewer does not own the seat, and a vacant seat is vacant", () => {
    expect(presentSoe(raw({ directorId: "char-1" }), "char-2").viewerIsDirector).toBe(false);
    const vacant = presentSoe(raw({ directorId: null }), "char-1");
    expect(vacant.vacant).toBe(true);
    expect(vacant.viewerIsDirector).toBe(false);
  });

  it("defaults unset director levers to balanced / zero", () => {
    const v = presentSoe(raw(), null);
    expect(v.laborQuality).toBe(0.5);
    expect(v.investmentRequest).toBe(0);
  });
});

describe("computeMarketizationDrivers", () => {
  it("failing SOEs and shortages read as market pressure; strong plants hold", () => {
    const failing = computeMarketizationDrivers({
      shortageIndex: 80,
      blackMarketPremium: 1.5,
      secondEconomyShare: 0.4,
      soes: [{ output: 40, capacity: 100 }],
      creditAggressiveness: 0.9,
      budgetSoftness: 0.9,
    });
    const healthy = computeMarketizationDrivers({
      shortageIndex: 5,
      blackMarketPremium: 0.05,
      secondEconomyShare: 0.02,
      soes: [{ output: 100, capacity: 100 }],
      creditAggressiveness: 0.3,
      budgetSoftness: 0.3,
    });
    expect(failing.blackMarketPressure).toBeGreaterThan(healthy.blackMarketPressure);
    expect(failing.soePerformance).toBeLessThan(healthy.soePerformance);
    // A flooding, soft Gosbank reads as orthodox (negative); a disciplined one reformist.
    expect(failing.policyStance).toBeLessThan(healthy.policyStance);
  });
});

describe("gosbankCostLabel", () => {
  it("escalates with overhang / shortage and never uses a dash", () => {
    const calm = gosbankCostLabel(5, 5, 0.3);
    const acute = gosbankCostLabel(80, 80, 0.9);
    expect(calm).not.toEqual(acute);
    for (const s of [calm, acute]) {
      expect(s).not.toMatch(/[—–]/);
    }
  });
});

describe("regimeFromLevel", () => {
  it("splits command below 30 from dual-track above", () => {
    expect(regimeFromLevel(10)).toBe("command");
    expect(regimeFromLevel(29.9)).toBe("command");
    expect(regimeFromLevel(30)).toBe("dual-track");
    expect(regimeFromLevel(65)).toBe("dual-track");
  });
});
