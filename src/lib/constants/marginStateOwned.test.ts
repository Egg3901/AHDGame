import { describe, it, expect } from "vitest";
import { computeAllMarginModifiers, type StateMetricValues } from "./corporations";

// Bug #0775: state-owned corps (NatCorps) are diversified state holding companies
// that hold nationalized sectors of many types and dominate the markets they take
// by design. The private-firm penalties for market dominance, off-type sectors, and
// logistical sprawl should not apply on top of the dedicated SOE efficiency penalty.

const NEUTRAL_METRICS: StateMetricValues = {
  fullMetrics: null,
  unemploymentRate: null,
  gridReliability: null,
  corruptionIndex: null,
  workforceSkill: null,
  crimeRate: null,
  broadbandAccess: null,
  roadCondition: null,
  carbonEmissions: null,
  costOfLiving: null,
};

function compute(stateOwned: boolean) {
  return computeAllMarginModifiers(
    "energy", // sectorType
    30, // baseProfitMargin
    NEUTRAL_METRICS,
    0, // commodityMod
    0, // homeLocationBonus
    "technology", // corporationType — mismatch ⇒ sector-type penalty
    20, // totalSectors — over 15 ⇒ sprawl penalty
    undefined, // macroEcon
    0, // logisticsStrength
    null, // secondaryType
    false, // typeSwitchPenaltyActive
    0, // foreignTariffMod
    0, // domesticTariffMod
    0, // subsidyMod
    0, // strategyTransitionMod
    0, // stateSectorSpecializationMod
    100, // marketSharePercent — 100% ⇒ dominance penalties
    0, // negativeProductionSustainedTurns
    0, // currentPolicyLevel
    null, // stateMetricOverride
    stateOwned
  );
}

describe("computeAllMarginModifiers — state-owned exemptions (Bug #0775)", () => {
  it("a private corp incurs dominance, sector-type-mismatch, and sprawl penalties", () => {
    const m = compute(false);
    expect(m.dominanceMarginPenalty).toBeLessThan(0);
    expect(m.dominanceRegulatoryBurdenPp).toBeLessThan(0);
    expect(m.sectorTypeMatchModifier).toBeLessThan(0);
    expect(m.sprawlModifier).toBeLessThan(0);
  });

  it("a state-owned corp is exempt from all four private-market penalties", () => {
    const m = compute(true);
    expect(m.dominanceMarginPenalty).toBe(0);
    expect(m.dominanceRegulatoryBurdenPp).toBe(0);
    expect(m.sectorTypeMatchModifier).toBe(0);
    expect(m.sprawlModifier).toBe(0);
  });

  it("the exemption raises the effective margin", () => {
    expect(compute(true).effective).toBeGreaterThan(compute(false).effective);
  });
});
