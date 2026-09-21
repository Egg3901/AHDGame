import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import type { CommodityPrice, CorporateSector, UnownedSector } from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CommodityType } from "@/lib/constants/commodities";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { computeMarketFormationSnapshot } from "./marketFormation";
import { normalizeMarketFormationSnapshot } from "./marketFormationSnapshot";
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
        pool("AR", "media_entertainment"),
        pool("AR", "retail"),
        pool("WY", "manufacturing", foundingStarterUnits("manufacturing") - 1),
        pool("AK", "media_entertainment"),
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

describe("empty-cell sampling", () => {
  /**
   * The snapshot is persisted once per turn. The full empty-cell list reached
   * ~1MB per document and nothing outside the producer reads it, so it is
   * capped to a sample. These pin the properties that make the cap safe:
   * the true total stays exact, the dropped count is reported, and the sample
   * is deterministic rather than whatever order the scan happened to produce.
   */
  function manyEmptyPools(count: number): UnownedSector[] {
    return Array.from({ length: count }, (_, i) =>
      pool(`S${String(i).padStart(4, "0")}`, "manufacturing")
    );
  }

  it("keeps the exact total while capping the sample, and says how many it dropped", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: manyEmptyPools(400),
      prices: [],
      eraUnitScale: 1,
    });

    expect(snapshot.emptyCells).toBe(400);
    expect(snapshot.emptyMarketCells.length).toBe(250);
    expect(snapshot.emptyMarketCellsOmitted).toBe(150);
    // The rolled-up views must still describe every cell, not just the sample.
    const byStateCells = snapshot.emptyByState.reduce((sum, row) => sum + row.cells, 0);
    expect(byStateCells).toBe(400);
  });

  it("omits the dropped-count field entirely when nothing was dropped", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: manyEmptyPools(3),
      prices: [],
      eraUnitScale: 1,
    });

    expect(snapshot.emptyMarketCells.length).toBe(3);
    expect(snapshot.emptyMarketCellsOmitted).toBeUndefined();
  });

  it("samples deterministically, so the same world yields the same rows", () => {
    const input = {
      sectors: [],
      unownedSectors: manyEmptyPools(400),
      prices: [],
      eraUnitScale: 1,
    };
    const a = computeMarketFormationSnapshot({ ...input });
    const b = computeMarketFormationSnapshot({ ...input });

    expect(a.emptyMarketCells.map((c) => `${c.stateId}:${c.sectorType}`)).toEqual(
      b.emptyMarketCells.map((c) => `${c.stateId}:${c.sectorType}`)
    );
  });

  it("puts facility-ready cells first, since those are the actionable ones", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: manyEmptyPools(400),
      prices: [],
      eraUnitScale: 1,
    });

    const readyFlags = snapshot.emptyMarketCells.map((c) => c.facilityReady);
    const firstNotReady = readyFlags.indexOf(false);
    // Once a non-ready cell appears, no ready one may follow it.
    if (firstNotReady !== -1) {
      expect(readyFlags.slice(firstNotReady).some(Boolean)).toBe(false);
    }
  });
});

describe("state-sector coverage", () => {
  it("names an unserved positive-use cell without hiding it", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 0), price("building_materials", "PA", 100, 0, 0)],
      eraUnitScale: 1,
    });

    expect(snapshot.classificationCounts.unserved).toBe(1);
    expect(snapshot.emptyMarketCells[0]).toMatchObject({
      classification: "unserved",
      activeFirms: 0,
      activeCorps: 0,
    });
  });

  it("treats unobserved cells as unknown rather than fundamental zeros", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [pool("AK", "media_entertainment", 0)],
      prices: [],
      eraUnitScale: 1,
    });

    expect(snapshot.classificationCounts.data_zero).toBe(1);
    expect(snapshot.emptyMarketCells[0]?.classificationBasis).toMatch(/no.*demand observation/i);
  });

  it("separates resident demand from local-producer demand and output", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 80), price("building_materials", "PA", 100, 0, 80)],
      eraUnitScale: 1,
    });

    const cell = snapshot.emptyMarketCells[0]!;
    expect(cell.localDemandValueAnchor).toBeGreaterThan(0);
    expect(cell.inboundSupplyValueAnchor).toBeGreaterThan(0);
    // Contestable demand is gross use minus the import-served part.
    expect(cell.localProducerDemandValueAnchor).toBe(
      cell.localDemandValueAnchor! - cell.inboundSupplyValueAnchor!
    );
    // Nothing placed: no statePlacedSupply on the book.
    expect(cell.outputValueAnchor).toBe(0);
  });

  it("covers active cells with firms, corps, and demand anchors", () => {
    const corpId = new ObjectId();
    const live = (id: ObjectId): CorporateSector => ({
      ...sector("NY", "manufacturing"),
      corporationId: id,
    });
    const snapshot = computeMarketFormationSnapshot({
      sectors: [live(corpId), live(corpId), live(new ObjectId())],
      unownedSectors: [pool("NY", "manufacturing"), pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 0), price("building_materials", "PA", 100, 0, 0)],
      eraUnitScale: 1,
    });

    const ny = snapshot.coverageByState.find((row) => row.stateId === "NY")!;
    expect(ny).toMatchObject({ cells: 1, activeCells: 1, emptyCells: 0, activeFirms: 3 });
    expect(ny.activeCorps).toBe(2);
    const pa = snapshot.coverageByState.find((row) => row.stateId === "PA")!;
    expect(pa.emptyCells).toBe(1);
    expect(pa.facilityReadyEmptyCells).toBe(1);
    const us = snapshot.coverageByCountry.find((row) => row.countryId === "US")!;
    expect(us).toMatchObject({ states: 2, cells: 2, activeCells: 1, emptyCells: 1 });
    expect(us.activeCorps).toBe(2);
  });

  it("reports per-commodity seller and buyer breadth", () => {
    const steel = price("steel", "PA", 100, 60, 60);
    steel.stateSupply.NY = 40;
    steel.stateDemand.NY = 50;
    steel.globalSupply = 100;
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [],
      prices: [steel],
      eraUnitScale: 1,
    });

    expect(snapshot.commodityBreadth).toHaveLength(1);
    expect(snapshot.commodityBreadth[0]).toMatchObject({
      commodity: "steel",
      sellerStates: 2,
      buyerStates: 2,
    });
    expect(snapshot.commodityBreadth[0]!.topSellerShare).toBeCloseTo(0.6, 5);
  });
});

describe("empty-cell classification invariants", () => {
  const classifications = [
    "fundamental_zero",
    "import_served",
    "unserved",
    "entry_gap",
    "coordination_gap",
    "data_zero",
  ];

  it("gives every empty cell exactly one known classification", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [sector("NY", "manufacturing")],
      unownedSectors: [
        pool("NY", "manufacturing"),
        pool("PA", "manufacturing"),
        pool("PA", "retail", 0),
        pool("OH", "retail"),
      ],
      prices: [price("steel", "PA", 100, 0, 80), price("building_materials", "PA", 100, 0, 80)],
      eraUnitScale: 1,
    });

    expect(snapshot.emptyCells).toBeGreaterThan(0);
    for (const cell of snapshot.emptyMarketCells) {
      expect(classifications).toContain(cell.classification);
      expect(cell.classificationBasis.length).toBeGreaterThan(0);
    }
    const counted = Object.values(snapshot.classificationCounts).reduce((a, b) => a + b, 0);
    expect(counted).toBe(snapshot.emptyCells);
  });

  it("never calls a positive-use facility-ready cell fundamental or data zero", () => {
    const snapshot = computeMarketFormationSnapshot({
      sectors: [],
      unownedSectors: [pool("PA", "manufacturing")],
      prices: [price("steel", "PA", 100, 0, 0), price("building_materials", "PA", 100, 0, 0)],
      eraUnitScale: 1,
    });

    expect(snapshot.emptyMarketCells).toHaveLength(1);
    const cell = snapshot.emptyMarketCells[0]!;
    expect(cell.facilityReady).toBe(true);
    expect(cell.localDemandValueAnchor).toBeGreaterThan(0);
    expect(["import_served", "entry_gap", "coordination_gap", "unserved"]).toContain(
      cell.classification
    );
  });
});

describe("normalizeMarketFormationSnapshot", () => {
  it("serves a pre-coverage snapshot with empty evidence sections", () => {
    const normalized = normalizeMarketFormationSnapshot({
      cellsObserved: 10,
      activeCells: 6,
      emptyCells: 4,
      emptyShare: 0.4,
      classificationCounts: { unserved: 4 },
      entryFunnel: { corporationsObserved: 3, entered: 1, rejected: 2 },
      basis: "legacy",
    });

    expect(normalized).toMatchObject({
      cellsObserved: 10,
      emptyCells: 4,
      emptyShare: 0.4,
      basis: "legacy",
    });
    expect(normalized?.coverageByState).toEqual([]);
    expect(normalized?.coverageByCountry).toEqual([]);
    expect(normalized?.commodityBreadth).toEqual([]);
    expect(normalized?.emptyMarketCells).toEqual([]);
    expect(normalized?.classificationCounts).toEqual({
      fundamental_zero: 0,
      import_served: 0,
      unserved: 4,
      entry_gap: 0,
      coordination_gap: 0,
      data_zero: 0,
    });
    expect(normalized?.entryFunnel).toMatchObject({
      corporationsObserved: 3,
      entered: 1,
      rejected: 2,
      explainedOutcomeShare: null,
      reasonCounts: {},
    });
  });

  it("rejects non-documents", () => {
    expect(normalizeMarketFormationSnapshot(null)).toBeNull();
    expect(normalizeMarketFormationSnapshot([])).toBeNull();
  });
});
