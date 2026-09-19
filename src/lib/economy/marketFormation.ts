import type { CorporateSector } from "@/lib/db/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CorporationType } from "@/lib/constants/corporations";
import { COMMODITY_BASE_PRICES, SECTOR_SUPPLY } from "@/lib/constants/commodities";
import { foundingStarterUnits } from "@/lib/corporations/foundingPlant";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import type {
  CommoditySupplyBreadth,
  CountrySectorCoverage,
  EmptyMarketCell,
  EmptyMarketClassification,
  MarketFormationSnapshot,
  NppMarketEntryDiagnostic,
  NppMarketEntryFunnel,
  StateSectorCoverage,
} from "@/lib/db/types/marketFormation";

export type {
  CommoditySupplyBreadth,
  CountrySectorCoverage,
  EmptyMarketCell,
  EmptyMarketClassification,
  MarketFormationSnapshot,
  StateSectorCoverage,
} from "@/lib/db/types/marketFormation";

/**
 * How many empty-cell rows the per-turn snapshot keeps. The list is a
 * diagnostic sample, not a data source: at ~460 bytes a row the uncapped list
 * reached ~1MB on every turn's document.
 */
const EMPTY_MARKET_CELL_SAMPLE_CAP = 250;

type MarketValue = {
  demand: number;
  supply: number;
  delivered: number;
  placed: number;
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
  let placed = 0;
  let observations = 0;
  for (const { commodity, rate } of output) {
    const price = pricesByCommodity.get(commodity);
    const base = COMMODITY_BASE_PRICES[commodity];
    if (!price || !(base > 0) || !(rate > 0)) continue;
    const stateDemand = price.stateDemand?.[stateId];
    const stateSupply = price.stateSupply?.[stateId];
    const stateDelivered = price.stateDeliveredSupply?.[stateId];
    const statePlaced = price.statePlacedSupply?.[stateId];
    if (typeof stateDemand !== "number" || !Number.isFinite(stateDemand)) continue;
    observations += 1;
    const weight = base * rate;
    demand += Math.max(0, stateDemand) * weight;
    supply += Math.max(0, Number.isFinite(stateSupply) ? stateSupply : 0) * weight;
    delivered += Math.max(0, Number.isFinite(stateDelivered) ? stateDelivered! : 0) * weight;
    placed += Math.max(0, Number.isFinite(statePlaced) ? statePlaced! : 0) * weight;
  }
  return { demand, supply, delivered, placed, observations };
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
  const liveSectors = args.sectors.filter((sector) => sector.mothballed !== true);
  const activeBuckets = new Set(
    liveSectors.map((sector) => bucketKey(sector.stateId, sector.sectorType))
  );
  const firmsByBucket = new Map<string, number>();
  const corpsByBucket = new Map<string, Set<string>>();
  for (const sector of liveSectors) {
    const key = bucketKey(sector.stateId, sector.sectorType);
    firmsByBucket.set(key, (firmsByBucket.get(key) ?? 0) + 1);
    let corps = corpsByBucket.get(key);
    if (!corps) {
      corps = new Set();
      corpsByBucket.set(key, corps);
    }
    corps.add(sector.corporationId.toString());
  }
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
  const cellStats = [...universe.entries()].map(([key, pool]) => {
    const starterUnits = foundingStarterUnits(pool.sectorType);
    const headroomUnits = unownedHeadroomUnitsOf(
      pool.sectorType,
      pool.headroomUnits,
      pool.revenue,
      args.eraUnitScale
    );
    const facilityReady = starterUnits > 0 && headroomUnits >= starterUnits;
    if (facilityReady && !activeBuckets.has(key)) {
      facilityReadyByState.set(pool.stateId, (facilityReadyByState.get(pool.stateId) ?? 0) + 1);
    }
    const market = marketValueFor(pool.stateId, pool.sectorType, pricesByCommodity);
    const inbound = Math.max(0, market.delivered - market.supply);
    return {
      key,
      pool,
      active: activeBuckets.has(key),
      firms: firmsByBucket.get(key) ?? 0,
      corps: corpsByBucket.get(key)?.size ?? 0,
      starterUnits,
      headroomUnits,
      facilityReady,
      market,
      inbound,
      // Demand contestable by a local entrant: gross local use minus the part
      // already served by inbound delivery. Built from the engine's calibrated
      // state books, never inferred from firm counts.
      localProducerDemand: Math.max(0, market.demand - inbound),
    };
  });

  const emptyMarketCells: EmptyMarketCell[] = cellStats
    .filter((cell) => !cell.active)
    .map(
      ({
        key,
        pool,
        firms,
        corps,
        starterUnits,
        headroomUnits,
        facilityReady,
        market,
        inbound,
        localProducerDemand,
      }) => {
        const targetRows = targeted.get(key) ?? [];
        const rejectionReasons = [
          ...new Set(targetRows.filter((row) => row.reason !== "entered").map((row) => row.reason)),
        ];

        let classification: EmptyMarketClassification;
        let classificationBasis: string;
        if (market.observations === 0) {
          // Unknown, not zero: without a demand observation no claim about
          // local use is licensed, whatever the headroom says.
          classification = "data_zero";
          classificationBasis = "No state demand observation for this cell's outputs.";
        } else if (market.demand <= 0 && facilityReady) {
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
          activeFirms: firms,
          activeCorps: corps,
          localDemandValueAnchor: market.observations > 0 ? market.demand : null,
          localSupplyValueAnchor: market.observations > 0 ? market.supply : null,
          deliveredSupplyValueAnchor: market.observations > 0 ? market.delivered : null,
          inboundSupplyValueAnchor: market.observations > 0 ? inbound : null,
          localProducerDemandValueAnchor: market.observations > 0 ? localProducerDemand : null,
          outputValueAnchor: market.observations > 0 ? market.placed : null,
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

  // Full coverage per state across active AND empty cells. Demand values are
  // cell-summed base-price-weighted anchors: one commodity's use is counted
  // once per sector type whose outputs include it, so rows compare states to
  // each other but do not reconcile to accounting totals.
  const coverageAccum = new Map<string, StateSectorCoverage & { corps: Set<string> }>();
  for (const cell of cellStats) {
    const stateKey = `${cell.pool.countryId}\u0000${cell.pool.stateId}`;
    let row = coverageAccum.get(stateKey);
    if (!row) {
      row = {
        countryId: cell.pool.countryId,
        stateId: cell.pool.stateId,
        cells: 0,
        activeCells: 0,
        emptyCells: 0,
        facilityReadyEmptyCells: 0,
        activeFirms: 0,
        activeCorps: 0,
        openHeadroomUnits: 0,
        residentDemandValue: 0,
        localProducerDemandValue: 0,
        inboundSupplyValue: 0,
        outputValue: 0,
        corps: new Set<string>(),
      };
      coverageAccum.set(stateKey, row);
    }
    row.cells += 1;
    if (cell.active) {
      row.activeCells += 1;
      row.activeFirms += cell.firms;
    } else {
      row.emptyCells += 1;
      if (cell.facilityReady) row.facilityReadyEmptyCells += 1;
      row.openHeadroomUnits += Math.max(0, cell.headroomUnits);
    }
    if (cell.market.observations > 0) {
      row.residentDemandValue += cell.market.demand;
      row.localProducerDemandValue += cell.localProducerDemand;
      row.inboundSupplyValue += cell.inbound;
      row.outputValue += cell.market.placed;
    }
  }
  for (const sector of liveSectors) {
    const row = coverageAccum.get(`${sector.countryId}\u0000${sector.stateId}`);
    row?.corps.add(sector.corporationId.toString());
  }
  const coverageByState: StateSectorCoverage[] = [...coverageAccum.values()]
    .map(({ corps, ...row }) => ({ ...row, activeCorps: corps.size }))
    .sort((a, b) => b.emptyCells - a.emptyCells || a.stateId.localeCompare(b.stateId));
  const countryAccum = new Map<string, CountrySectorCoverage & { corps: Set<string> }>();
  for (const row of coverageAccum.values()) {
    let country = countryAccum.get(row.countryId);
    if (!country) {
      country = {
        countryId: row.countryId,
        states: 0,
        cells: 0,
        activeCells: 0,
        emptyCells: 0,
        facilityReadyEmptyCells: 0,
        activeFirms: 0,
        activeCorps: 0,
        openHeadroomUnits: 0,
        residentDemandValue: 0,
        localProducerDemandValue: 0,
        inboundSupplyValue: 0,
        outputValue: 0,
        corps: new Set<string>(),
      };
      countryAccum.set(row.countryId, country);
    }
    country.states += 1;
    country.cells += row.cells;
    country.activeCells += row.activeCells;
    country.emptyCells += row.emptyCells;
    country.facilityReadyEmptyCells += row.facilityReadyEmptyCells;
    country.activeFirms += row.activeFirms;
    country.openHeadroomUnits += row.openHeadroomUnits;
    country.residentDemandValue += row.residentDemandValue;
    country.localProducerDemandValue += row.localProducerDemandValue;
    country.inboundSupplyValue += row.inboundSupplyValue;
    country.outputValue += row.outputValue;
    for (const corpId of row.corps) country.corps.add(corpId);
  }
  const coverageByCountry: CountrySectorCoverage[] = [...countryAccum.values()]
    .map(({ corps, ...row }) => ({ ...row, activeCorps: corps.size }))
    .sort((a, b) => b.emptyCells - a.emptyCells || a.countryId.localeCompare(b.countryId));

  // Per-commodity seller/buyer breadth from the state books. A fragile market
  // (advertising, fertilizers, freight, rare earths) shows here as few seller
  // states with a high top-seller share against broad buyer states.
  const commodityBreadth: CommoditySupplyBreadth[] = args.prices
    .map((price): CommoditySupplyBreadth => {
      let sellerStates = 0;
      let buyerStates = 0;
      let topSellerUnits = 0;
      for (const [stateId, demand] of Object.entries(price.stateDemand ?? {})) {
        if (typeof demand === "number" && Number.isFinite(demand) && demand > 0) {
          buyerStates += 1;
        }
        const supply = price.stateSupply?.[stateId];
        if (typeof supply === "number" && Number.isFinite(supply) && supply > 0) {
          sellerStates += 1;
          if (supply > topSellerUnits) topSellerUnits = supply;
        }
      }
      const globalSupply =
        typeof price.globalSupply === "number" && Number.isFinite(price.globalSupply)
          ? Math.max(0, price.globalSupply)
          : 0;
      return {
        commodity: price.commodity,
        sellerStates,
        buyerStates,
        topSellerShare: globalSupply > 0 ? topSellerUnits / globalSupply : null,
        globalDemandUnits:
          typeof price.globalDemand === "number" && Number.isFinite(price.globalDemand)
            ? Math.max(0, price.globalDemand)
            : 0,
        globalSupplyUnits: globalSupply,
      };
    })
    .sort((a, b) => a.commodity.localeCompare(b.commodity));
  const funnel = args.entryFunnel;
  const explained = funnel
    ? funnel.diagnostics.filter((row) => typeof row.reason === "string").length
    : 0;

  // Persisted snapshots are one document per turn, and the full cell list was
  // ~1MB of each. Nothing outside this module reads it; every aggregate a
  // consumer needs is computed above and returned alongside. Keep a bounded,
  // deterministically ordered sample so the diagnostic ("show me examples")
  // survives, and record how many rows were dropped.
  //
  // Order: facility-ready first (the actionable ones — a corporation could
  // enter tomorrow), then largest headroom, then a stable key so the sample
  // does not churn between turns for no reason.
  const sampledEmptyCells = [...emptyMarketCells]
    .sort(
      (a, b) =>
        Number(b.facilityReady) - Number(a.facilityReady) ||
        b.headroomUnits - a.headroomUnits ||
        a.countryId.localeCompare(b.countryId) ||
        a.stateId.localeCompare(b.stateId) ||
        a.sectorType.localeCompare(b.sectorType)
    )
    .slice(0, EMPTY_MARKET_CELL_SAMPLE_CAP);
  const omittedEmptyCells = emptyMarketCells.length - sampledEmptyCells.length;

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
    emptyMarketCells: sampledEmptyCells,
    ...(omittedEmptyCells > 0 ? { emptyMarketCellsOmitted: omittedEmptyCells } : {}),
    coverageByState,
    coverageByCountry,
    commodityBreadth,
    basis:
      "active corporate sectors plus unowned pools; facility headroom; state demand, local supply, delivered supply, and placed output; current-turn NPP entry outcomes",
  };
}

export { normalizeMarketFormationSnapshot } from "./marketFormationSnapshot";
