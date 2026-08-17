/**
 * @vitest-environment happy-dom
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectorMarginDrilldown } from "./SectorMarginDrilldown";
import type { SectorDetail } from "./CorporationPageTypes";

// Ticket 1072: sectors showed a negative effective margin while the additive
// modifier list summed positive, with a ~40pt unexplained gap. Under plants the
// margin is derived from physical costs, so the drilldown must render the cost
// build (which reconciles exactly) instead of the modifier stack (which cannot).
const baseSector = {
  _id: "s1",
  stateId: "NM",
  stateName: "New Mexico",
  sectorType: "extraction",
  sectorLabel: "Extraction",
  targetGrowthRate: 0,
  currentGrowthRate: 0,
  currentGrowthCost: 0,
  revenue: 6_612_006,
  financialRevenue: 9_929_652,
  realizedRevenue: 9_929_652,
  profitMargin: 35,
  effectiveProfitMargin: -19.8,
  marketSharePercent: 77.7,
  unemploymentModifier: 1.2,
  gridReliabilityModifier: 0,
  corruptionModifier: -0.5,
  workforceSkillModifier: 0.4,
  crimeRateModifier: 0,
  broadbandModifier: 0,
  roadConditionModifier: 0,
  carbonEmissionsModifier: 0,
  costOfLivingModifier: 0,
  stateSectorSpecializationModifier: 0,
  stateMetricsModifier: 0,
  regionalConditionsModifier: 0,
  commodityModifier: -3.1,
  homeLocationModifier: 0,
  foreignTariffModifier: 0,
  domesticTariffMalus: 0,
  techMarginBonus: null,
  inflationModifier: -2.0,
  debtToGdpModifier: 0,
  deficitToGdpModifier: 0,
  profit: -1_965_000,
  workers: 346_426,
  strategyId: "rare_earth_mining",
  productionPolicy: 25,
  productionPolicyLevel: 25,
} as unknown as SectorDetail;

describe("SectorMarginDrilldown", () => {
  it("renders the physical cost build when marginBasis is physical", () => {
    const sector = {
      ...baseSector,
      marginBasis: "physical",
      physicalCosts: { inputsPp: 89.4, laborPp: 15.0, otherPp: 15.4 },
    } as SectorDetail;
    render(<SectorMarginDrilldown sector={sector} isCeo={false} corpId="c1" />);
    expect(screen.getByText("What this sector pays")).toBeTruthy();
    expect(screen.getByText("Inputs (at market prices)")).toBeTruthy();
    expect(screen.getByText("Wages")).toBeTruthy();
    // The lines reconcile: 100 − 89.4 − 15.0 − 15.4 = −19.8, the shown margin.
    expect(screen.getAllByText("-19.8%").length).toBeGreaterThan(0);
    // The additive stack must NOT render — it cannot explain a derived margin.
    expect(screen.queryByText("Commodity markets")).toBeNull();
    expect(screen.queryByText("Net modifiers")).toBeNull();
  });

  it("keeps the additive modifier view when no physical basis is present", () => {
    render(<SectorMarginDrilldown sector={baseSector} isCeo={false} corpId="c1" />);
    expect(screen.getByText("Base sector margin")).toBeTruthy();
    expect(screen.getByText("Commodity markets")).toBeTruthy();
    expect(screen.queryByText("What this sector pays")).toBeNull();
  });
});
