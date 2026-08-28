import type { CorporateSector } from "@/lib/db/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CorporationType } from "@/lib/constants/corporations";
import { COMMODITY_BASE_PRICES, SECTOR_SUPPLY } from "@/lib/constants/commodities";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import type {
  EmptyMarketCell,
  EmptyMarketClassification,
  MarketFormationSnapshot,
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
} from "@/lib/db/types/marketFormation";

export type {
  EmptyMarketCell,
  EmptyMarketClassification,
  MarketFormationSnapshot,
} from "@/lib/db/types/marketFormation";

type MarketValue = {
  demand: number;
  supply: number;
  delivered: number;
  observations: number;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function marketValueFor(
  stateId: string,
  sectorType: CorporationType,
  pricesByCommodity: ReadonlyMap<string, CommodityPrice>
): MarketValue {
  const output = SECTOR_SUPPLY[sectorType] ?? [];
  let demand = 0;
  let supply = 0;
  let delivered = 0;
  let observations = 0;
  for (const { commodity, rate } of output) {
    const price = pricesByCommodity.get(commodity);
    const base = COMMODITY_BASE_PRICES[commodity];
    if (!price || !(base > 0) || !(rate > 0)) continue;
    const stateDemand = price.stateDemand?.[stateId];
    const stateSupply = price.stateSupply?.[stateId];
    const stateDelivered = price.stateDeliveredSupply?.[stateId];
    if (typeof stateDemand !== "number" || !Number.isFinite(stateDemand)) continue;
    observations += 1;
    const weight = base * rate;
    demand += Math.max(0, stateDemand) * weight;
    supply += Math.max(0, Number.isFinite(stateSupply) ? stateSupply : 0) * weight;
    delivered += Math.max(0, Number.isFinite(stateDelivered) ? stateDelivered! : 0) * weight;
  }
  return { demand, supply, delivered, observations };
}

function countBy<T extends string>(
  rows: EmptyMarketCell[],
  keyOf: (row: EmptyMarketCell) => T
): Map<T, { cells: number; facilityReady: number }> {
  const result = new Map<T, { cells: number; facilityReady: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = result.get(key) ?? { cells: 0, facilityReady: 0 };
    current.cells += 1;
    if (row.facilityReady) current.facilityReady += 1;
    result.set(key, current);
  }
  return result;
}

function targetDiagnostics(
  funnel: NppMarketEntryFunnel | null | undefined
): Map<string, NppMarketEntryDiagnostic[]> {
  const result = new Map<string, NppMarketEntryDiagnostic[]>();
  for (const row of funnel?.diagnostics ?? []) {
    if (!row.targetStateId || !row.targetSectorType) continue;
    const key = bucketKey(row.targetStateId, row.targetSectorType);
    const list = result.get(key) ?? [];
    list.push(row);
    result.set(key, list);
  }
  return result;
}

export function computeMarketFormationSnapshot(args: {
  sectors: CorporateSector[];
  unownedSectors: UnownedSector[];
  prices: CommodityPrice[];
  entryFunnel?: NppMarketEntryFunnel | null;
  eraUnitScale: number;
}): MarketFormationSnapshot {
  const activeBuckets = new Set(
    args.sectors
      .filter((sector) => sector.mothballed !== true)
      .map((sector) => bucketKey(sector.stateId, sector.sectorType))
  );
  const universe = new Map<string, UnownedSector>();
  for (const pool of args.unownedSectors)
    universe.set(bucketKey(pool.stateId, pool.sectorType), pool);
  for (const sector of args.sectors) {
    const key = bucketKey(sector.stateId, sector.sectorType);
    if (!universe.has(key)) {
      universe.set(key, {
        _id: sector._id,
        countryId: sector.countryId,
        stateId: sector.stateId,
        sectorType: sector.sectorType,
        revenue: 0,
        headroomUnits: 0,
        createdAt: sector.createdAt,
        updatedAt: sector.updatedAt,
      });
    }
  }

  const pricesByCommodity = new Map(args.prices.map((price) => [price.commodity, price]));
  const targeted = targetDiagnostics(args.entryFunnel);
  const facilityReadyByState = new Map<string, number>();
  const rawEmpty = [...universe.entries()].flatMap(([key, pool]) => {
    if (activeBuckets.has(key)) return [];
    const starterUnits = foundingStarterUnits(pool.sectorType);
    const headroomUnits = unownedHeadroomUnitsOf(
      pool.sectorType,
      pool.headroomUnits,
      pool.revenue,
      args.eraUnitScale
    );
    const facilityReady = starterUnits > 0 && headroomUnits >= starterUnits;
    if (facilityReady) {
      facilityReadyByState.set(pool.stateId, (facilityReadyByState.get(pool.stateId) ?? 0) + 1);
    }
    return [{ key, pool, starterUnits, headroomUnits, facilityReady }];
  });

  const emptyMarketCells: EmptyMarketCell[] = rawEmpty.map(
    ({ key, pool, starterUnits, headroomUnits, facilityReady }) => {
      const market = marketValueFor(pool.stateId, pool.sectorType, pricesByCommodity);
      const inbound = Math.max(0, market.delivered - market.supply);
      const targetRows = targeted.get(key) ?? [];
      const rejectionReasons = [
        ...new Set(targetRows.filter((row) => row.reason !== "entered").map((row) => row.reason)),
      ];

      let classification: EmptyMarketClassification;
      let classificationBasis: string;
      if (market.observations === 0 || (facilityReady && market.demand <= 0)) {
        classification = "data_zero";
        classificationBasis = "No positive state demand observation for a facility-ready pool.";
      } else if (!facilityReady) {
        classification = "fundamental_zero";
        classificationBasis = "Open headroom is smaller than one founding facility.";
      } else if (inbound > 0) {
        classification = "import_served";
        classificationBasis = "Delivered output value exceeds same-state output value.";
      } else if (rejectionReasons.length > 0) {
        classification = "entry_gap";
        classificationBasis =
          "At least one NPP targeted the cell and was rejected by a recorded gate.";
      } else if ((facilityReadyByState.get(pool.stateId) ?? 0) >= 3) {
        classification = "coordination_gap";
        classificationBasis =
          "The state has at least three facility-ready empty sectors and no NPP targeted this cell.";
      } else {
        classification = "unserved";
        classificationBasis =
          "Positive local use and facility headroom exist without local output, inbound delivery, or a targeted NPP attempt.";
      }

      return {
        countryId: pool.countryId,
        stateId: pool.stateId,
        sectorType: pool.sectorType,
        classification,
        classificationBasis,
        headroomUnits,
        starterUnits,
        facilityReady,
        localDemandValueAnchor: market.observations > 0 ? market.demand : null,
        localSupplyValueAnchor: market.observations > 0 ? market.supply : null,
        deliveredSupplyValueAnchor: market.observations > 0 ? market.delivered : null,
        inboundSupplyValueAnchor: market.observations > 0 ? inbound : null,
        targetedNppCorporations: targetRows.length,
        targetedRejectionReasons: rejectionReasons,
      };
    }
  );

  const classifications: Record<EmptyMarketClassification, number> = {
    fundamental_zero: 0,
    import_served: 0,
    unserved: 0,
    entry_gap: 0,
    coordination_gap: 0,
    data_zero: 0,
  };
  for (const cell of emptyMarketCells) classifications[cell.classification] += 1;

  const byCountry = countBy(emptyMarketCells, (row) => row.countryId);
  const bySector = countBy(emptyMarketCells, (row) => row.sectorType);
  const byState = countBy(emptyMarketCells, (row) => `${row.countryId}\u0000${row.stateId}`);
  const emptyStates = new Set(
    emptyMarketCells.map((row) => `${row.countryId}\u0000${row.stateId}`)
  );
  const states = new Set(
    [...universe.values()].map((row) => `${row.countryId}\u0000${row.stateId}`)
  );
  const funnel = args.entryFunnel;
  const explained = funnel
    ? funnel.diagnostics.filter((row) => typeof row.reason === "string").length
    : 0;

  return {
    cellsObserved: universe.size,
    activeCells: activeBuckets.size,
    emptyCells: emptyMarketCells.length,
    emptyShare: ratio(emptyMarketCells.length, universe.size),
    facilityReadyEmptyCells: emptyMarketCells.filter((row) => row.facilityReady).length,
    facilityReadyEmptyShare: ratio(
      emptyMarketCells.filter((row) => row.facilityReady).length,
      emptyMarketCells.length
    ),
    statesObserved: states.size,
    statesWithEmptyCells: emptyStates.size,
    classificationCounts: classifications,
    entryFunnel: {
      corporationsObserved: funnel?.corporationsObserved ?? 0,
      entered: funnel?.entered ?? 0,
      rejected: funnel?.rejected ?? 0,
      explainedOutcomeShare: ratio(explained, funnel?.corporationsObserved ?? 0),
      reasonCounts: funnel?.reasonCounts ?? {},
    },
    emptyByCountry: [...byCountry.entries()]
      .map(([countryId, value]) => ({ countryId, ...value }))
      .sort((a, b) => b.cells - a.cells || a.countryId.localeCompare(b.countryId)),
    emptyBySector: [...bySector.entries()]
      .map(([sectorType, value]) => ({ sectorType, ...value }))
      .sort((a, b) => b.cells - a.cells || a.sectorType.localeCompare(b.sectorType)),
    emptyByState: [...byState.entries()]
      .map(([key, value]) => {
        const [countryId, stateId] = key.split("\u0000");
        return { countryId: countryId!, stateId: stateId!, cells: value.cells };
      })
      .sort((a, b) => b.cells - a.cells || a.stateId.localeCompare(b.stateId)),
    emptyMarketCells,
    basis:
      "active corporate sectors plus unowned pools; facility headroom; state demand, local supply, and delivered supply; current-turn NPP entry outcomes",
  };
}
