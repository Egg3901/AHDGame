import { describe, expect, it } from "vitest";
import { PLANTS_SORT_OPTIONS, SORT_OPTIONS, sortOptionsFor, sortSectors } from "./sectorSortUtils";
import type { SectorDetail } from "./CorporationPageTypes";

function sector(partial: Partial<SectorDetail> & { stateName: string }): SectorDetail {
  return {
    _id: partial.stateName,
    stateId: partial.stateName.slice(0, 2).toUpperCase(),
    sectorType: "manufacturing",
    sectorLabel: "Manufacturing",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    revenue: 0,
    financialRevenue: 0,
    realizedRevenue: null,
    profitMargin: 0,
    effectiveProfitMargin: 0,
    marketSharePercent: 0,
    unemploymentModifier: 0,
    gridReliabilityModifier: 0,
    corruptionModifier: 0,
    workforceSkillModifier: null,
    crimeRateModifier: null,
    broadbandModifier: null,
    roadConditionModifier: null,
    carbonEmissionsModifier: null,
    costOfLivingModifier: null,
    commodityModifier: 0,
    homeLocationModifier: 0,
    stateSectorSpecializationModifier: 0,
    inflationModifier: 0,
    debtToGdpModifier: 0,
    deficitToGdpModifier: 0,
    foreignTariffModifier: 0,
    domesticTariffMalus: 0,
    profit: 0,
    workers: 0,
    ...partial,
  } as SectorDetail;
}

describe("sortOptionsFor", () => {
  it("drops the growth levers under plants and offers capacity + fill instead", () => {
    expect(sortOptionsFor(false)).toBe(SORT_OPTIONS);
    expect(sortOptionsFor(true)).toBe(PLANTS_SORT_OPTIONS);

    const plantsKeys = PLANTS_SORT_OPTIONS.map((o) => o.value);
    // Growth target and growth cost do not build capacity under plants, so
    // ranking holdings by them ranks them on a number that means nothing.
    expect(plantsKeys).not.toContain("growthRate");
    expect(plantsKeys).not.toContain("growthCost");
    expect(plantsKeys).toContain("capacity");
    expect(plantsKeys).toContain("fill");
  });
});

describe("sortSectors — plants keys", () => {
  const rows = [
    sector({ stateName: "Bavaria", capacityUnits: 500, fillRate: 0.9 }),
    sector({ stateName: "Alsace", capacityUnits: 2_000, fillRate: 0.2 }),
    sector({ stateName: "Cornwall", capacityUnits: 100, fillRate: 0.55 }),
  ];

  it("sorts by capacity in both directions", () => {
    expect(sortSectors(rows, "capacity", "desc").map((s) => s.stateName)).toEqual([
      "Alsace",
      "Bavaria",
      "Cornwall",
    ]);
    expect(sortSectors(rows, "capacity", "asc").map((s) => s.stateName)).toEqual([
      "Cornwall",
      "Bavaria",
      "Alsace",
    ]);
  });

  it("sorts by fill rate", () => {
    expect(sortSectors(rows, "fill", "desc").map((s) => s.stateName)).toEqual([
      "Bavaria",
      "Cornwall",
      "Alsace",
    ]);
  });

  it("sorts rows with no exact fill to the bottom rather than disabling the sort", () => {
    // A rival's rows carry only a band. Comparing undefined as NaN returns 0
    // for every pair, which silently leaves the list in its original order and
    // reads as a broken sort control.
    const mixed = [
      sector({ stateName: "Alsace", fillRate: null }),
      sector({ stateName: "Bavaria", fillRate: 0.7 }),
      sector({ stateName: "Cornwall", fillRate: 0.3 }),
    ];
    expect(sortSectors(mixed, "fill", "desc").map((s) => s.stateName)).toEqual([
      "Bavaria",
      "Cornwall",
      "Alsace",
    ]);
  });

  it("leaves the capital-tier keys working unchanged", () => {
    const capital = [
      sector({ stateName: "Alsace", targetGrowthRate: 1 }),
      sector({ stateName: "Bavaria", targetGrowthRate: 5 }),
    ];
    expect(sortSectors(capital, "growthRate", "desc").map((s) => s.stateName)).toEqual([
      "Bavaria",
      "Alsace",
    ]);
  });
});
