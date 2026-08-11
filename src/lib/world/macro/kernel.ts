import {
  COMMODITY_BASE_PRICES,
  COMMODITY_TYPES,
  SECTOR_DEMAND,
  SECTOR_SUPPLY,
  dollarsToUnits,
  type CommodityType,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import type { MacroCountryState, MacroMarketContribution, MacroSectorState } from "./types";

/** Softens domestic demand when stability falls; keeps demand alive at low stability. */
function stabilityDemandModifier(stability: number): number {
  return 0.5 + 0.5 * clamp01(stability);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function emptyCommodityBalances(): Map<CommodityType, { supply: number; demand: number }> {
  const map = new Map<CommodityType, { supply: number; demand: number }>();
  for (const commodity of COMMODITY_TYPES) {
    map.set(commodity, { supply: 0, demand: 0 });
  }
  return map;
}

function addFlows(
  target: Map<CommodityType, { supply: number; demand: number }>,
  dollarFlow: number,
  flows: { commodity: CommodityType; rate: number }[] | undefined,
  side: "supply" | "demand"
): void {
  if (!flows || dollarFlow <= 0) return;
  for (const flow of flows) {
    const units = dollarsToUnits(dollarFlow * flow.rate, COMMODITY_BASE_PRICES[flow.commodity]);
    if (units <= 0) continue;
    const bal = target.get(flow.commodity)!;
    bal[side] += units;
  }
}

/**
 * Planned economies clear most trade inside COMECON/bilateral clearing, so only
 * a fraction of authored tradeExposure leaks into the shared world market.
 */
export const PLANNED_MARKET_LEAKAGE = 0.55;

/**
 * Epic P1 kernel (aggregate form):
 *   output = capacity × productivity × stability × shockModifier
 *   demand = domesticDemand × stabilityDemandModifier
 *   exposed = clamp(tradeExposure, 0, 1) × plannedLeakage(economicSystem)
 * Market contribution = exposed share of commodity supply/demand derived from
 * canonical SECTOR_SUPPLY / SECTOR_DEMAND flows, plus resource endowments.
 */
export function computeMacroContribution(
  state: Pick<
    MacroCountryState,
    | "sectors"
    | "resources"
    | "stability"
    | "tradeExposure"
    | "shockModifier"
    | "population"
    | "economicSystem"
  >,
  turn: number
): MacroMarketContribution {
  const stability = clamp01(state.stability);
  const plannedLeak = state.economicSystem === "planned" ? PLANNED_MARKET_LEAKAGE : 1;
  const exposure = clamp01(state.tradeExposure) * plannedLeak;
  const shock =
    Number.isFinite(state.shockModifier) && state.shockModifier > 0 ? state.shockModifier : 1;
  const demandMod = stabilityDemandModifier(stability);

  const commodityUnits = emptyCommodityBalances();
  const bySector: Partial<Record<CorporationType, { output: number; demand: number }>> = {};

  for (const sectorType of CORPORATION_TYPES) {
    const sector: MacroSectorState | undefined = state.sectors[sectorType];
    if (!sector) continue;

    const output = Math.max(0, sector.capacity * sector.productivity * stability * shock);
    const demand = Math.max(0, sector.domesticDemand * demandMod);
    bySector[sectorType] = {
      output: Math.round(output * 100) / 100,
      demand: Math.round(demand * 100) / 100,
    };

    addFlows(commodityUnits, output, SECTOR_SUPPLY[sectorType], "supply");
    addFlows(commodityUnits, demand, SECTOR_DEMAND[sectorType], "demand");
  }

  // Resource endowments contribute extractable supply independent of sector weights.
  for (const [resource, endowment] of Object.entries(state.resources) as [
    ExtractableResource,
    number,
  ][]) {
    if (!Number.isFinite(endowment) || endowment <= 0) continue;
    const units = dollarsToUnits(endowment * stability * shock, COMMODITY_BASE_PRICES[resource]);
    if (units <= 0) continue;
    commodityUnits.get(resource)!.supply += units;
  }

  // Population-scaled retail consumer pressure (income proxy from total sector capacity).
  const totalCapacity = Object.values(state.sectors).reduce(
    (sum, sector) => sum + (sector?.capacity ?? 0),
    0
  );
  const incomeProxy = state.population > 0 ? totalCapacity / state.population : 0;
  const basketDollars = state.population * incomeProxy * 0.08 * demandMod;
  if (basketDollars > 0) {
    addFlows(commodityUnits, basketDollars, SECTOR_DEMAND.retail, "demand");
  }

  const byCommodity: MacroMarketContribution["byCommodity"] = {};
  for (const commodity of COMMODITY_TYPES) {
    const bal = commodityUnits.get(commodity)!;
    const supply = Math.round(bal.supply * exposure * 100) / 100;
    const demand = Math.round(bal.demand * exposure * 100) / 100;
    if (supply > 0 || demand > 0) {
      byCommodity[commodity] = { supply, demand };
    }
  }

  return {
    byCommodity,
    bySector,
    computedOnTurn: turn,
  };
}
