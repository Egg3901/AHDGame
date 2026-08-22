/**
 * Corporation-level commodity flows for the Commodities tab.
 *
 * There is no persisted per-corp per-commodity quantity — the turn engine keeps
 * only per-sector revenue and global (per-commodity) flow ledger rows. So we
 * recompute a corp's physical output/consumption exactly the way the sector
 * detail page does: `units = sector.revenue × effectiveRate / basePrice`
 * (see `src/lib/corporations/queries/sectorDetail.ts`), summed across all the
 * corp's sectors and grouped by home state for the regional breakdown.
 *
 * Global market context (price, stock, cover, spoilage) is read from the latest
 * `commodityFlows` ledger row per commodity — that data is only global, so it is
 * surfaced as market context, not attributed to the corp.
 */

import type { CorporateSector } from "@/lib/db/types";
import type { CommodityFlow } from "@/lib/db/types/commodityFlow";
import {
  COMMODITY_BASE_PRICES,
  COMMODITY_COLORS,
  COMMODITY_ICONS,
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  dollarsToUnits,
} from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

/** Market context for one commodity, from the latest global flow ledger row. */
export interface CommodityMarketContext {
  price: number | null;
  stockUnits: number | null;
  coverTurns: number | null;
  spoiledUnits: number | null;
  surplusUnits: number | null;
  unmetDemandUnits: number | null;
}

/** Latest private-agreement supply delivered to this corporation. */
export interface CorpPrivateSupply {
  /** Sum of the active agreements' maximum units for this commodity. */
  contractedUnits: number;
  /** Units actually delivered in the latest settled turn. */
  deliveredUnits: number;
  /** Delivered units that matched this corporation's consumption. */
  consumptionCoveredUnits: number;
  /** Share of consumption covered by delivered agreements, from 0 to 100. */
  coveragePercent: number;
  /** Turn the delivery quantities came from. */
  turn: number;
}

/** Persisted agreement rollup supplied by the corporation commodities query. */
export interface CorpPrivateSupplySnapshot {
  contractedUnits: number;
  deliveredUnits: number;
  turn: number;
}

/** A commodity this corporation produces and/or consumes. */
export interface CorpCommodityFlow {
  commodity: CommodityType;
  label: string;
  icon: string;
  color: string;
  unit: string;
  /** Physical output units per turn (0 when the corp only consumes it). */
  outputUnits: number;
  /** Physical consumption units per turn (0 when the corp only produces it). */
  consumptionUnits: number;
  /** outputUnits − consumptionUnits (net physical position). */
  netUnits: number;
  market: CommodityMarketContext;
  /** Buyer-side outcome from active private supply agreements. */
  privateSupply?: CorpPrivateSupply;
  /** Sectors that produce this commodity (for CEO pricing links). */
  outputSectors?: Array<{ sectorId: string; label: string }>;
}

/** Per-state breakdown of one commodity's flows for this corporation. */
export interface CorpCommodityRegionRow {
  commodity: CommodityType;
  label: string;
  icon: string;
  outputUnits: number;
  consumptionUnits: number;
}

export interface CorpCommodityRegion {
  stateId: string;
  stateName: string;
  region: string | null;
  rows: CorpCommodityRegionRow[];
}

export interface CorpCommodityFlowsResult {
  commodities: CorpCommodityFlow[];
  regions: CorpCommodityRegion[];
}

type FlowSector = Pick<
  CorporateSector,
  | "sectorType"
  | "stateId"
  | "revenue"
  | "strategyId"
  | "transitionFromStrategyId"
  | "transitionStartTurn"
> & { _id?: CorporateSector["_id"] };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Aggregate a corporation's per-commodity output and consumption across all its
 * sectors, plus a per-state regional breakdown. Pure — no DB access.
 */
export function computeCorpCommodityFlows(
  sectors: FlowSector[],
  currentTurn: number,
  latestFlowByCommodity: ReadonlyMap<CommodityType, CommodityFlow>,
  stateInfoById: ReadonlyMap<string, { name: string; region: string | null }>,
  privateSupplyByCommodity: ReadonlyMap<CommodityType, CorpPrivateSupplySnapshot> = new Map()
): CorpCommodityFlowsResult {
  // commodity → { output, consumption } across the whole corp.
  const totals = new Map<CommodityType, { output: number; consumption: number }>();
  // commodity → sectors that supply it.
  const outputSectorsByCommodity = new Map<
    CommodityType,
    Array<{ sectorId: string; label: string }>
  >();
  // stateId → commodity → { output, consumption }.
  const byState = new Map<string, Map<CommodityType, { output: number; consumption: number }>>();

  const bump = (
    map: Map<CommodityType, { output: number; consumption: number }>,
    commodity: CommodityType,
    key: "output" | "consumption",
    units: number
  ) => {
    const entry = map.get(commodity) ?? { output: 0, consumption: 0 };
    entry[key] += units;
    map.set(commodity, entry);
  };

  for (const sector of sectors) {
    const rates = getEffectiveStrategyRates(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn
    );
    const stateMap =
      byState.get(sector.stateId) ??
      new Map<CommodityType, { output: number; consumption: number }>();
    byState.set(sector.stateId, stateMap);

    for (const [commodity, rate] of Object.entries(rates.supply) as [CommodityType, number][]) {
      if (!rate || rate <= 0) continue;
      const basePrice = COMMODITY_BASE_PRICES[commodity];
      if (!(basePrice > 0)) continue;
      const units = dollarsToUnits(sector.revenue * rate, basePrice);
      bump(totals, commodity, "output", units);
      bump(stateMap, commodity, "output", units);
      if (sector._id) {
        const list = outputSectorsByCommodity.get(commodity) ?? [];
        const sectorId = sector._id.toString();
        if (!list.some((s) => s.sectorId === sectorId)) {
          list.push({
            sectorId,
            label: CORPORATION_TYPE_LABELS[sector.sectorType],
          });
          outputSectorsByCommodity.set(commodity, list);
        }
      }
    }
    for (const [commodity, rate] of Object.entries(rates.demand) as [CommodityType, number][]) {
      if (!rate || rate <= 0) continue;
      const basePrice = COMMODITY_BASE_PRICES[commodity];
      if (!(basePrice > 0)) continue;
      const units = dollarsToUnits(sector.revenue * rate, basePrice);
      bump(totals, commodity, "consumption", units);
      bump(stateMap, commodity, "consumption", units);
    }
  }

  // A contract for a commodity this corporation does not otherwise consume is
  // still important information: it is delivered surplus, not an invisible row.
  for (const commodity of privateSupplyByCommodity.keys()) {
    if (!totals.has(commodity)) totals.set(commodity, { output: 0, consumption: 0 });
  }

  const commodities: CorpCommodityFlow[] = [];
  for (const [commodity, { output, consumption }] of totals) {
    const flow = latestFlowByCommodity.get(commodity);
    const privateSupply = privateSupplyByCommodity.get(commodity);
    if (output <= 0 && consumption <= 0 && !privateSupply) continue;
    const consumptionCoveredUnits = privateSupply
      ? Math.min(Math.max(0, privateSupply.deliveredUnits), Math.max(0, consumption))
      : 0;
    commodities.push({
      commodity,
      label: COMMODITY_LABELS[commodity],
      icon: COMMODITY_ICONS[commodity],
      color: COMMODITY_COLORS[commodity],
      unit: COMMODITY_UNITS[commodity],
      outputUnits: round2(output),
      consumptionUnits: round2(consumption),
      netUnits: round2(output - consumption),
      market: {
        price: flow ? flow.price : null,
        stockUnits: flow ? flow.stockUnits : null,
        coverTurns: flow ? flow.coverTurns : null,
        spoiledUnits: flow ? round2(flow.spoiledUnits) : null,
        surplusUnits: flow ? round2(flow.surplusUnits) : null,
        unmetDemandUnits: flow ? round2(flow.unmetDemandUnits) : null,
      },
      ...(privateSupply
        ? {
            privateSupply: {
              contractedUnits: round2(Math.max(0, privateSupply.contractedUnits)),
              deliveredUnits: round2(Math.max(0, privateSupply.deliveredUnits)),
              consumptionCoveredUnits: round2(consumptionCoveredUnits),
              coveragePercent:
                consumption > 0
                  ? round2(Math.min(100, (consumptionCoveredUnits / consumption) * 100))
                  : 0,
              turn: privateSupply.turn,
            },
          }
        : {}),
      ...(output > 0 && outputSectorsByCommodity.has(commodity)
        ? { outputSectors: outputSectorsByCommodity.get(commodity) }
        : {}),
    });
  }
  // Largest physical throughput first.
  commodities.sort(
    (a, b) => b.outputUnits + b.consumptionUnits - (a.outputUnits + a.consumptionUnits)
  );

  const regions: CorpCommodityRegion[] = [];
  for (const [stateId, stateMap] of byState) {
    const info = stateInfoById.get(stateId);
    const rows: CorpCommodityRegionRow[] = [];
    for (const [commodity, { output, consumption }] of stateMap) {
      if (output <= 0 && consumption <= 0) continue;
      rows.push({
        commodity,
        label: COMMODITY_LABELS[commodity],
        icon: COMMODITY_ICONS[commodity],
        outputUnits: round2(output),
        consumptionUnits: round2(consumption),
      });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => b.outputUnits + b.consumptionUnits - (a.outputUnits + a.consumptionUnits));
    regions.push({
      stateId,
      stateName: info?.name ?? stateId,
      region: info?.region ?? null,
      rows,
    });
  }
  regions.sort((a, b) => a.stateName.localeCompare(b.stateName));

  return { commodities, regions };
}
