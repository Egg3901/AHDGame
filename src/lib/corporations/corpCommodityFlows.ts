/**
 * Corporation-level commodity flows for the Commodities tab.
 *
 * This mirrors the world supply ledger (`computeRawSupplyDemand` in
 * `src/lib/constants/commodities.ts`) leg for leg, because the tab's whole job
 * is to tell a CEO what their corporation actually puts on the market. Any
 * derivation of its own drifts from the number every other surface reports.
 *
 * Under the plants tier a sector has already MEASURED what it made, so real
 * output is `plantsSupplyScaledUnits(producedUnits) × commodityMixWeight` — the
 * same canonical chain the ledger, the clearing offer and the supply-agreement
 * capacity check use. The revenue nameplate (`revenue × rate / basePrice`) is
 * only the fallback for a sector that has never run a plants turn, and the sole
 * path for extraction, which carries its own deposit-capacity rationing that
 * `producedUnits` would double-count.
 *
 * Revenue arrives in the sector's HOST currency. Every nameplate leg therefore
 * runs on `revenueAnchor` (₳), never `revenue` — dividing francs by an ₳ base
 * price reports a French sector at its FX rate, not its output (ticket #1177).
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
  NATCORP_COMMODITY_MULTIPLIER,
  commodityMixWeight,
  dollarsToUnits,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
} from "@/lib/constants/commodities";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import {
  applyPlannedEconomyOutputMix,
  getEffectiveStrategyRates,
  plannedEconomyMediaSupplyFactor,
} from "@/lib/constants/sectorStrategies";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { freshMilitaryDiversion } from "@/lib/military/arsenal";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import { getInputMultiplier, getOutputMultiplier } from "@/lib/utils/productionPolicy";

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

export type FlowSector = Pick<
  CorporateSector,
  | "sectorType"
  | "stateId"
  | "revenue"
  | "strategyId"
  | "transitionFromStrategyId"
  | "transitionStartTurn"
> & {
  _id?: CorporateSector["_id"];
  /**
   * `revenue` normalized to ₳ at the sector's HOST-state rate. Every nameplate
   * leg runs on this; `revenue` itself is host currency and is only the
   * fallback for callers with no FX table loaded.
   */
  revenueAnchor?: number | null;
  /** Units the plant physically made last turn. Absent before its first plants turn. */
  producedUnits?: number | null;
  /** Nameplate capacity (`capitalStock`), the denominator of plant utilization. */
  capacityUnits?: number | null;
  mothballed?: boolean | null;
  productionPolicyLevel?: number | null;
  embargoSuspended?: boolean | null;
  embargoExportExposure?: number | null;
  /** Share of output taken by a state arsenal — it never reaches the market. */
  militaryDivertedFraction?: number | null;
  /** Turn the diversion was booked. Older than one turn means the contract ended. */
  militaryDivertedTurn?: number | null;
  /** Host country, for the planned-economy output remap. */
  countryId?: string | null;
};

/** World context the flow derivation needs beyond the sectors themselves. */
export interface CorpCommodityFlowContext {
  /** `marketSystemMode >= "plants"` — measured production replaces the nameplate. */
  plantsEnabled?: boolean;
  /** State-owned corp: carries `NATCORP_COMMODITY_MULTIPLIER`. */
  isNatcorp?: boolean;
  /** Era unit basis (`getEraUnitScale`); 1 on every modern preset. */
  eraUnitScale?: number;
  /** `gameState.currentYear` — with the flag below, resolves planned economies. */
  currentYear?: number | null;
  /** `gameConfig.commandEconomyEnabled`. */
  commandEconomyEnabled?: boolean | null;
  /**
   * stateId → the state's extractable deposits. An absent key means "no
   * capacity document" (legacy/uncapped); `null` means a document with no
   * resources, i.e. zero capacity for all of them.
   */
  stateResourcesByState?: ReadonlyMap<
    string,
    Partial<Record<ExtractableResource, number>> | null | undefined
  >;
}

/**
 * One sector's per-commodity physical supply and demand, mirroring the world
 * supply ledger's chain leg for leg. Shared by the Commodities tab and the
 * corporation history snapshot so the two cannot report different output.
 *
 * Returns empty maps for a mothballed plant — it is cold: it supplies nothing
 * and buys nothing.
 */
export function computeSectorCommodityUnits(
  sector: FlowSector,
  currentTurn: number,
  context: CorpCommodityFlowContext = {}
): {
  supply: Map<CommodityType, number>;
  demand: Map<CommodityType, number>;
  inMix: Set<CommodityType>;
} {
  const supply = new Map<CommodityType, number>();
  const demand = new Map<CommodityType, number>();
  /** Commodities in this sector's output mix, whatever it actually made. */
  const inMix = new Set<CommodityType>();
  const plantsEnabled = context.plantsEnabled === true;
  const isNatcorp = context.isNatcorp === true;
  const eraUnitScale =
    typeof context.eraUnitScale === "number" &&
    Number.isFinite(context.eraUnitScale) &&
    context.eraUnitScale > 0
      ? context.eraUnitScale
      : 1;
  const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

  // D12: a mothballed plant is cold — it supplies nothing and buys nothing.
  if (plantsEnabled && sector.mothballed === true) return { supply, demand, inMix };

  const rates = getEffectiveStrategyRates(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    currentTurn
  );
  const plannedEconomy = isPlannedEconomy(
    sector.countryId,
    context.currentYear,
    context.commandEconomyEnabled
  );
  // Order matters, and matches the ledger and the clearing offer: the
  // planned-economy remap runs FIRST because it can swap the commodity
  // entirely (a command economy's media makes state information, not sold
  // advertising), then the capacity filter culls what the state cannot
  // extract. A sector cannot supply a resource its state has no reserves of;
  // the turn engine, the world ledger and the sector page all filter on that,
  // and without it the corp surfaces invent output it could never have made.
  const supplyRates = applyExtractionResourceCapacityToSupply(
    sector.sectorType,
    applyPlannedEconomyOutputMix(sector.sectorType, rates.supply, plannedEconomy),
    context.stateResourcesByState?.get(sector.stateId ?? "")
  );

  const isExtraction = sector.sectorType === "extraction";
  const revenueAnchor =
    typeof sector.revenueAnchor === "number" && Number.isFinite(sector.revenueAnchor)
      ? sector.revenueAnchor
      : sector.revenue;
  const natcorpScale = isNatcorp ? NATCORP_COMMODITY_MULTIPLIER : 1;
  // Output sold to a state arsenal never reaches the market. Read through
  // `freshMilitaryDiversion` — the field is not cleared when a contract ends,
  // so a raw read keeps shaving output off forever while the world market
  // books the sector in full.
  const militaryRetained =
    1 -
    clamp01(
      freshMilitaryDiversion(
        {
          militaryDivertedFraction: sector.militaryDivertedFraction ?? undefined,
          militaryDivertedTurn: sector.militaryDivertedTurn ?? undefined,
        },
        currentTurn
      )
    );
  const policyLevel = sector.productionPolicyLevel ?? 0;

  // Plants: real production replaces the nameplate. Extraction is excluded on
  // purpose — its supply already carries the deposit-capacity rationing that
  // `producedUnits` also contains, and mixing the two double-counts it.
  //
  // EXTRACTION IS THE ONE FAMILY THIS SURFACE CANNOT MATCH THE LEDGER ON, and
  // that is deliberate. The ledger's extraction leg also carries
  // `extractionRealizedFraction`, `extractionOutputScaleFor` and the per-sector
  // deposit-capacity multipliers. The first is never persisted (the ledger
  // computes it in-memory each turn, see commodityPriceTurn), and the last
  // needs every extraction sector in the state plus the live contract book —
  // a turn pass, not something a display route can re-run without becoming a
  // second source of truth that drifts.
  //
  // So extraction stays on the nameplate plus the state-capacity filter, which
  // is EXACTLY what the sector page reports. Do not "finish" this by adding
  // only the cheap leg: a partial chain matches neither surface, and the
  // comparison players actually make is this tab against their sector pages.
  const plantsSupplyUnits =
    plantsEnabled && !isExtraction
      ? plantsSupplyScaledUnits({
          producedUnits: sector.producedUnits,
          isNatcorp,
          // Mirrors the ledger and the clearing offer: the embargo haircut
          // times the media supply derate. Media is derated in EVERY economy
          // (a market media sector puts a tenth of its output on the
          // advertising book), so omitting it overstated media tenfold.
          embargoSupplyFactor:
            embargoSupplyFactorFor(sector) *
            plannedEconomyMediaSupplyFactor(sector.sectorType, plannedEconomy),
        })
      : null;
  // Utilization scales INPUT demand: a plant running at 60% of nameplate
  // consumes ~60% of its inputs rather than 100%.
  const plantsUtilization =
    plantsEnabled &&
    typeof sector.producedUnits === "number" &&
    typeof sector.capacityUnits === "number" &&
    sector.capacityUnits > 0
      ? clamp01(sector.producedUnits / sector.capacityUnits)
      : 1;

  for (const [commodity, rate] of Object.entries(supplyRates) as [CommodityType, number][]) {
    if (!rate || rate <= 0) continue;
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    if (!(basePrice > 0)) continue;
    // The sector CAN make this, which is what the CEO pricing links are for.
    // Recorded before the quantity, so an idle plant is still reachable.
    inMix.add(commodity);
    const units =
      plantsSupplyUnits != null
        ? plantsSupplyUnits *
          commodityMixWeight(supplyRates, COMMODITY_BASE_PRICES, commodity) *
          militaryRetained
        : dollarsToUnits(revenueAnchor * rate, basePrice) *
          eraUnitScale *
          natcorpScale *
          getOutputMultiplier(policyLevel) *
          militaryRetained;
    if (!(units > 0)) continue;
    supply.set(commodity, (supply.get(commodity) ?? 0) + units);
  }
  for (const [commodity, rate] of Object.entries(rates.demand) as [CommodityType, number][]) {
    if (!rate || rate <= 0) continue;
    const basePrice = COMMODITY_BASE_PRICES[commodity];
    if (!(basePrice > 0)) continue;
    const units =
      dollarsToUnits(revenueAnchor * rate, basePrice) *
      eraUnitScale *
      natcorpScale *
      getInputMultiplier(policyLevel) *
      plantsUtilization;
    if (!(units > 0)) continue;
    demand.set(commodity, (demand.get(commodity) ?? 0) + units);
  }

  return { supply, demand, inMix };
}

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
  privateSupplyByCommodity: ReadonlyMap<CommodityType, CorpPrivateSupplySnapshot> = new Map(),
  context: CorpCommodityFlowContext = {}
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
    const { supply, demand, inMix } = computeSectorCommodityUnits(sector, currentTurn, context);
    if (supply.size === 0 && demand.size === 0 && inMix.size === 0) continue;

    if (sector._id) {
      const sectorId = sector._id.toString();
      for (const commodity of inMix) {
        const list = outputSectorsByCommodity.get(commodity) ?? [];
        if (!list.some((s) => s.sectorId === sectorId)) {
          list.push({
            sectorId,
            label: CORPORATION_TYPE_LABELS[sector.sectorType],
          });
          outputSectorsByCommodity.set(commodity, list);
        }
      }
    }

    const stateMap =
      byState.get(sector.stateId) ??
      new Map<CommodityType, { output: number; consumption: number }>();
    byState.set(sector.stateId, stateMap);

    for (const [commodity, units] of supply) {
      bump(totals, commodity, "output", units);
      bump(stateMap, commodity, "output", units);
    }
    for (const [commodity, units] of demand) {
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
