import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CommodityPrice, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { computeMarketFormationSnapshot } from "./marketFormation";
import { summarizeNppMarketEntryFunnel } from "@/lib/turn/npp/entryDiagnostics";

const now = new Date("2026-08-28T00:00:00Z");

function pool(
  stateId: string,
  sectorType: CorporationType,
  headroomUnits = foundingStarterUnits(sectorType)
): UnownedSector {
  return {
    _id: new ObjectId(),
    stateId,
    countryId: "US",
    sectorType,
    revenue: 1_000_000,
    headroomUnits,
    createdAt: now,
    updatedAt: now,
  };
}

function sector(stateId: string, sectorType: CorporationType): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: new ObjectId(),
    stateId,
    countryId: "US",
    sectorType,
    revenue: 1_000_000,
    profitMargin: 20,
    targetGrowthRate: 2,
    createdAt: now,
    updatedAt: now,
  } as CorporateSector;
}

function price(
  commodity: CommodityType,
  stateId: string,
  demand: number,
  supply: number,
  delivered: number
): CommodityPrice {
  return {
    commodity,
    basePrice: 1,
    globalPrice: 1,
    globalSupply: supply,
    globalDemand: demand,
    statePrices: { [stateId]: 1 },
    stateSupply: { [stateId]: supply },
    stateDemand: { [stateId]: demand },
    stateDeliveredSupply: { [stateId]: delivered },
    turn: 440,
    updatedAt: now,
  };
}

describe("computeMarketFormationSnapshot", () => {
  it("separates active cells from facility-ready import-served empty cells", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [sector("NY", "manufacturing")],
      unownedSectors: [pool("NY", "manufacturing"), pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 80), price("building_materials", "PA", 100, 0, 80)],
      eraUnitScale: 1,
    });

    expect(snapshot.cellsObserved).toBe(2);
    expect(snapshot.activeCells).toBe(1);
    expect(snapshot.emptyCells).toBe(1);
    expect(snapshot.facilityReadyEmptyCells).toBe(1);
    expect(snapshot.classificationCounts.import_served).toBe(1);
    expect(snapshot.emptyMarketCells[0]).toMatchObject({
      stateId: "PA",
      sectorType: "manufacturing",
      facilityReady: true,
      classification: "import_served",
    });
  });

  it("marks a targeted rejected market as an entry gap", () => {
    const funnel = summarizeNppMarketEntryFunnel({
      turn: 440,
      now,
      diagnostics: [
        {
          corporationId: "corp-1",
          countryId: "US",
          reason: "cash_floor",
          sectorCount: 2,
          logisticsSupportedSectors: 10,
          profitable: true,
          marginPct: 30,
          marginFloorPct: 15,
          cohortEligible: true,
          strategyAllowsExpansion: true,
          targetStateId: "PA",
          targetSectorType: "manufacturing",
        },
      ],
    });
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 0), price("building_materials", "PA", 100, 0, 0)],
      entryFunnel: funnel,
      eraUnitScale: 1,
    });

    expect(snapshot.classificationCounts.entry_gap).toBe(1);
    expect(snapshot.entryFunnel.explainedOutcomeShare).toBe(1);
    expect(snapshot.emptyMarketCells[0]?.targetedRejectionReasons).toEqual(["cash_floor"]);
  });

  it("uses transparent fallbacks for clustered, undersized, and missing-demand cells", () => {
    const steel = price("steel", "AR", 10, 0, 0);
    steel.statePrices.WY = 1;
    steel.stateDemand.WY = 10;
    steel.stateSupply.WY = 0;
    steel.stateDeliveredSupply!.WY = 0;
    const materials = price("building_materials", "AR", 10, 0, 0);
    materials.statePrices.WY = 1;
    materials.stateDemand.WY = 10;
    materials.stateSupply.WY = 0;
    materials.stateDeliveredSupply!.WY = 0;
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [
        pool("AR", "manufacturing"),
        pool("AR", "media"),
        pool("AR", "retail"),
        pool("WY", "manufacturing", foundingStarterUnits("manufacturing") - 1),
        pool("AK", "media"),
      ],
      prices: [
        steel,
        materials,
        price("advertising", "AR", 10, 0, 0),
        price("retail", "AR", 10, 0, 0),
      ],
      eraUnitScale: 1,
    });

    expect(snapshot.classificationCounts.coordination_gap).toBe(3);
    expect(snapshot.classificationCounts.fundamental_zero).toBe(1);
    expect(snapshot.classificationCounts.data_zero).toBe(1);
  });
});
