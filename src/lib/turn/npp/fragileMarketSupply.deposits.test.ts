import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { findBestUnownedSector, type PlacementSignals } from "./marketSignals";
import {
  extractionGrowthHeadroom,
  fragileReinvestmentPriority,
  resolveFragileEntryTreatment,
} from "./fragileMarketSupply";
import {
  computeExtractionHeadroomByState,
  computeExtractionHeadroomByStateResource,
  extractionHeadroomForSupply,
} from "@/lib/turn/nppExtractionOpportunity";
import type { CorporateSector } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

// A timber-only state next to a rare earth state, with rare earth critically
// short. Before the fix the timber state's aggregate deposit room qualified it
// for a rare earth founding that could never extract anything.
const DEPOSITS: Record<string, Partial<Record<ExtractableResource, number>>> = {
  TIMBER: { timber: 1 },
  RARE: { rare_earth: 0.9 },
  EMPTY: {},
};

const prices = (commodity: CommodityType): number | null =>
  commodity === "rare_earth" ? 2.3 : commodity === "timber" ? 0.6 : 1;

const signals = (overrides: Partial<PlacementSignals> = {}): PlacementSignals => ({
  extractionHeadroomOf: (stateId) => (Object.keys(DEPOSITS[stateId] ?? {}).length > 0 ? 1 : 0),
  extractionResourceHeadroomOf: (stateId, resource) => DEPOSITS[stateId]?.[resource] ?? 0,
  preferFragileMarketSupply: true,
  ...overrides,
});

const mine = (stateId: string): UnownedSector =>
  ({
    _id: new ObjectId(),
    stateId,
    countryId: "US" as CountryId,
    sectorType: "extraction",
    revenue: 100_000,
    headroomUnits: 100_000,
  }) as UnownedSector;

const sector = (stateId: string, strategyId: string): CorporateSector =>
  ({
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    stateId,
    sectorType: "extraction",
    strategyId,
    revenue: 100_000,
  }) as unknown as CorporateSector;

describe("fragile market supply respects the deposit a mine would extract", () => {
  it("routes a rare earth founding to the state that holds rare earth", () => {
    const pool = new Map([["US", [mine("TIMBER"), mine("RARE")]]]);
    const pick = findBestUnownedSector(
      "US",
      "TIMBER",
      "extraction",
      null,
      new Set(),
      pool,
      new Set(),
      prices,
      false,
      1,
      signals()
    );
    expect(pick?.stateId).toBe("RARE");
    const treatment = resolveFragileEntryTreatment(pick, signals(), prices);
    expect(treatment.foundingStrategyId).toBe("rare_earth_mining");
    expect(treatment.interventionTargetCommodity).toBe("rare_earth");
  });

  it("never founds a rare earth recipe in a state without rare earth", () => {
    const treatment = resolveFragileEntryTreatment(mine("TIMBER"), signals(), prices);
    expect(treatment.foundingStrategyId).toBeUndefined();
    expect(treatment.interventionTargetCommodity).toBeNull();
    // The entry gates read the timber glut, not the rare earth shortage.
    expect(treatment.candidatePriceRatioOf("rare_earth", "US")).toBeNull();
    expect(treatment.candidatePriceRatioOf("timber", "US")).toBe(0.6);
  });

  it("keeps legacy behavior when the per-resource signal is not loaded", () => {
    const legacy = signals({ extractionResourceHeadroomOf: undefined });
    const treatment = resolveFragileEntryTreatment(mine("TIMBER"), legacy, prices);
    expect(treatment.foundingStrategyId).toBe("rare_earth_mining");
  });

  it("a depositless rare earth mine gets no reinvestment priority or growth room", () => {
    const phantom = sector("TIMBER", "rare_earth_mining");
    expect(fragileReinvestmentPriority(phantom, "US", signals(), prices, 10)).toBe(0);
    expect(extractionGrowthHeadroom(phantom, signals(), 10)).toBe(0);

    const real = sector("RARE", "rare_earth_mining");
    expect(fragileReinvestmentPriority(real, "US", signals(), prices, 10)).toBeCloseTo(2.3);
    expect(extractionGrowthHeadroom(real, signals(), 10)).toBeCloseTo(0.9);
  });

  it("growth falls back to the aggregate state signal without per-resource data", () => {
    const legacy = signals({ extractionResourceHeadroomOf: undefined });
    expect(extractionGrowthHeadroom(sector("TIMBER", "rare_earth_mining"), legacy, 10)).toBe(1);
  });
});

describe("per-resource extraction headroom", () => {
  const caps = [
    { stateId: "A", resources: { iron: 1000, timber: 1000 } },
    { stateId: "B", resources: {} },
  ];

  it("reports each held resource separately and omits resources the state lacks", () => {
    const byResource = computeExtractionHeadroomByStateResource(caps, [], 1, false);
    expect(byResource.get("A")).toEqual({ iron: 1, timber: 1 });
    expect(byResource.get("B")).toEqual({});
  });

  it("the aggregate signal is unchanged", () => {
    const aggregate = computeExtractionHeadroomByState(caps, [], 1, false);
    expect(aggregate.get("A")).toBe(1);
    expect(aggregate.get("B")).toBe(0);
  });

  it("weights a recipe's headroom by output value and reads a missing deposit as 0", () => {
    expect(extractionHeadroomForSupply({ rare_earth: 0.72 }, () => 0)).toBe(0);
    expect(
      extractionHeadroomForSupply({ iron: 0.5, timber: 0.5 }, (r) => (r === "iron" ? 1 : 0))
    ).toBeGreaterThan(0);
    expect(extractionHeadroomForSupply({ iron: 0.78 }, () => 0.4)).toBeCloseTo(0.4);
  });
});
