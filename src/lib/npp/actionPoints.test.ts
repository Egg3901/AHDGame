import { describe, it, expect } from "vitest";
import {
  NPP_RECRUITMENT_AP_COST,
  NPP_MANAGEMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppManagementFundCost,
  nppRecruitmentFundCost,
  nppTreasuryCurrency,
  computeNppActionPointGain,
} from "./actionPoints";

describe("npp action point economy", () => {
  it("flat costs", () => {
    expect(NPP_RECRUITMENT_AP_COST).toBe(5);
    expect(NPP_MANAGEMENT_AP_COST).toBe(1);
  });

  it("management treasury fund costs are keyed by currency", () => {
    // Base tier (USD/GBP/EUR/NGN)
    expect(nppManagementFundCost("boost_influence", "USD")).toBe(5000);
    expect(nppManagementFundCost("boost_favorability", "GBP")).toBe(5000);
    expect(nppManagementFundCost("boost_loyalty", "EUR")).toBe(12500);
    expect(nppManagementFundCost("reduce_stubbornness", "NGN")).toBe(12500);
    // Mid tier (BRL/CNY)
    expect(nppManagementFundCost("boost_influence", "BRL")).toBe(25000);
    expect(nppManagementFundCost("boost_loyalty", "CNY")).toBe(50000);
    // High tier (JPY)
    expect(nppManagementFundCost("boost_influence", "JPY")).toBe(62500);
    expect(nppManagementFundCost("boost_loyalty", "JPY")).toBe(125000);
    // Soviet ruble (strong 1979 official rate) → base tier
    expect(nppManagementFundCost("boost_influence", "SUR")).toBe(5000);
    expect(nppManagementFundCost("boost_loyalty", "SUR")).toBe(12500);
    // relocate is free; unlisted currency falls back to the base tier
    expect(nppManagementFundCost("relocate_state", "JPY")).toBe(0);
    expect(nppManagementFundCost("boost_influence", "CAD")).toBe(5000);
  });

  it("recruitment treasury fund cost is keyed by currency", () => {
    expect(nppRecruitmentFundCost("USD")).toBe(50000);
    expect(nppRecruitmentFundCost("BRL")).toBe(200000);
    expect(nppRecruitmentFundCost("CNY")).toBe(200000);
    expect(nppRecruitmentFundCost("JPY")).toBe(500000);
    expect(nppRecruitmentFundCost("SUR")).toBe(50000);
    expect(nppRecruitmentFundCost("CAD")).toBe(50000); // unlisted → base tier
  });

  it("resolves a country's treasury currency", () => {
    expect(nppTreasuryCurrency("US")).toBe("USD");
    expect(nppTreasuryCurrency("JP")).toBe("JPY");
    expect(nppTreasuryCurrency("DE")).toBe("EUR");
    expect(nppTreasuryCurrency("IE")).toBe("IEP");
    expect(nppTreasuryCurrency("CN")).toBe("CNY");
  });

  it("caps by scope and tier", () => {
    expect(nppActionPointCap("national", "major")).toBe(160);
    expect(nppActionPointCap("national", "minor")).toBe(80);
    expect(nppActionPointCap("state", "major")).toBe(40);
    expect(nppActionPointCap("state", "minor")).toBe(20);
  });

  it("regen by scope and tier", () => {
    expect(nppActionPointRegen("national", "major")).toBe(16);
    expect(nppActionPointRegen("national", "minor")).toBe(8);
    expect(nppActionPointRegen("state", "major")).toBe(4);
    expect(nppActionPointRegen("state", "minor")).toBe(3);
  });

  it("banks regen up to the cap", () => {
    expect(computeNppActionPointGain({ current: 50, cap: 160, regenPerTurn: 16 })).toBe(66);
    expect(computeNppActionPointGain({ current: 150, cap: 160, regenPerTurn: 16 })).toBe(160);
  });

  it("heals undefined balance to the cap (full), never above", () => {
    expect(computeNppActionPointGain({ current: undefined, cap: 80, regenPerTurn: 8 })).toBe(80);
  });
});
