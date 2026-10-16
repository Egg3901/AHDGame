/**
 * Shell for the commodity-level build toll: loads a firm's sectors (with their
 * queues) and world demand, then hands them to the pure rules in
 * `rules/commodityDominance.ts`. Used by the build command, the build quote and
 * anything else that must price a build the way the server charges it.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import {
  COMMODITY_BASE_PRICES,
  COMMODITY_LABELS,
  type CommodityType,
} from "@/lib/constants/commodities";
import {
  applyPlannedEconomyOutputMix,
  getEffectiveStrategyRatesForOperatingModel,
} from "@/lib/constants/sectorStrategies";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { undeliveredUnits } from "@/lib/corporations/buildDelivery";
import type { CommodityTollModel } from "@/lib/corporations/rules/commodityDominanceRamp";
import {
  commodityDominanceRatio,
  type CommodityDominanceResult,
  type CommodityDominanceSector,
} from "@/lib/corporations/rules/commodityDominance";
import { computeSupplierCommodityCapacityUnits } from "@/lib/corporations/supplyAgreementCapacity";

/** Everything needed to price the commodity toll for one sector, any order size. */
export interface CommodityDominanceContext {
  sectors: CommodityDominanceSector[];
  /** Commodities the target sector makes. */
  commodities: CommodityType[];
  /** World demand per commodity (units/day), absent when unknown. */
  demand: Partial<Record<CommodityType, number>>;
  targetSectorId: string;
  isNatcorp: boolean;
  turn: number;
  currentYear: number;
  commandEconomyEnabled: boolean;
}

type FirmSectorRow = Pick<
  CorporateSector,
  | "_id"
  | "sectorType"
  | "industryModel"
  | "mediaDiscriminator"
  | "capitalStock"
  | "strategyId"
  | "transitionFromStrategyId"
  | "transitionStartTurn"
  | "retoolRescaleApplied"
  | "activeCapacityPercent"
  | "productionPolicyLevel"
  | "countryId"
  | "stateId"
  | "buildQueue"
>;

/**
 * Potential output ignores temporary states: a mothballed or embargoed plant
 * can be restarted, so it still counts toward what the firm could put on the
 * market. Queued units count in full (the whole point of looking at orders).
 */
function toDominanceSector(row: FirmSectorRow, turn: number): CommodityDominanceSector {
  const queued = (row.buildQueue ?? []).reduce((sum, o) => sum + undeliveredUnits(o, turn), 0);
  return {
    _id: row._id,
    sectorType: row.sectorType,
    industryModel: row.industryModel,
    mediaDiscriminator: row.mediaDiscriminator,
    capitalStock: row.capitalStock ?? 0,
    strategyId: row.strategyId,
    transitionFromStrategyId: row.transitionFromStrategyId,
    transitionStartTurn: row.transitionStartTurn,
    retoolRescaleApplied: row.retoolRescaleApplied,
    activeCapacityPercent: row.activeCapacityPercent,
    productionPolicyLevel: row.productionPolicyLevel,
    countryId: row.countryId,
    stateId: row.stateId,
    queuedUnits: queued,
  };
}

/** Commodities a sector's output mix contains, honouring the planned-economy remap. */
export function sectorOutputCommodities(
  sector: Pick<
    CommodityDominanceSector,
    | "sectorType"
    | "industryModel"
    | "mediaDiscriminator"
    | "strategyId"
    | "transitionFromStrategyId"
    | "transitionStartTurn"
    | "countryId"
  >,
  turn: number,
  currentYear: number,
  commandEconomyEnabled: boolean
): CommodityType[] {
  const rates = getEffectiveStrategyRatesForOperatingModel(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn,
    sector.industryModel,
    sector.mediaDiscriminator
  );
  const mix = applyPlannedEconomyOutputMix(
    sector.sectorType,
    rates.supply ?? {},
    isPlannedEconomy(sector.countryId, currentYear, commandEconomyEnabled),
    sector.mediaDiscriminator
  );
  return (Object.keys(mix) as CommodityType[]).filter(
    (c) => (mix[c] ?? 0) > 0 && COMMODITY_BASE_PRICES[c] > 0
  );
}

/**
 * Load the commodity-toll context for one sector. Returns null when the sector
 * makes nothing measurable or the read fails: a hiccup must not turn into a
 * phantom toll, and the local dominance toll still applies either way.
 */
export async function loadCommodityDominanceContext(
  db: Db,
  args: {
    corporation: Pick<Corporation, "_id" | "countryOwnerId">;
    sector: Pick<CorporateSector, "_id">;
    turn: number;
    currentYear: number;
  }
): Promise<CommodityDominanceContext | null> {
  try {
    const [rows, config] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find(
          { corporationId: args.corporation._id },
          {
            projection: {
              sectorType: 1,
              industryModel: 1,
              mediaDiscriminator: 1,
              capitalStock: 1,
              strategyId: 1,
              transitionFromStrategyId: 1,
              transitionStartTurn: 1,
              retoolRescaleApplied: 1,
              activeCapacityPercent: 1,
              productionPolicyLevel: 1,
              countryId: 1,
              stateId: 1,
              buildQueue: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<{ commandEconomyEnabled?: boolean }>("gameConfig")
        .findOne({ _id: "default" as never }, { projection: { commandEconomyEnabled: 1 } }),
    ]);
    const commandEconomyEnabled = config?.commandEconomyEnabled === true;
    const sectors = (rows as FirmSectorRow[]).map((r) => toDominanceSector(r, args.turn));
    const target = sectors.find((s) => String(s._id) === String(args.sector._id));
    if (!target) return null;
    const commodities = sectorOutputCommodities(
      target,
      args.turn,
      args.currentYear,
      commandEconomyEnabled
    );
    if (commodities.length === 0) return null;
    const priceDocs = await db
      .collection<CommodityPrice>("commodityPrices")
      .find({ commodity: { $in: commodities } }, { projection: { commodity: 1, globalDemand: 1 } })
      .toArray();
    const demand: Partial<Record<CommodityType, number>> = {};
    for (const doc of priceDocs) demand[doc.commodity] = doc.globalDemand;
    return {
      sectors,
      commodities,
      demand,
      targetSectorId: String(args.sector._id),
      isNatcorp: !!args.corporation.countryOwnerId,
      turn: args.turn,
      currentYear: args.currentYear,
      commandEconomyEnabled,
    };
  } catch (err) {
    console.error("[commodityDominance] context load failed", err);
    return null;
  }
}

/** Potential/demand ratio for the target sector after an order of `extraUnits`. */
export function commodityDominanceFor(
  ctx: CommodityDominanceContext,
  extraUnits: number
): CommodityDominanceResult {
  return commodityDominanceRatio({
    sectors: ctx.sectors,
    commodities: ctx.commodities,
    demandOf: (c) => ctx.demand[c],
    targetSectorId: ctx.targetSectorId,
    extraUnits,
    isNatcorp: ctx.isNatcorp,
    turn: ctx.turn,
    currentYear: ctx.currentYear,
    commandEconomyEnabled: ctx.commandEconomyEnabled,
  });
}

/**
 * Linearisation of the toll for a client that re-prices quantities locally: per
 * commodity, the firm's current potential and how many commodity units one new
 * capacity unit adds. Empty when nothing is measurable.
 */
export function commodityTollModels(ctx: CommodityDominanceContext): CommodityTollModel[] {
  const probe = 1e6;
  const models: CommodityTollModel[] = [];
  for (const commodity of ctx.commodities) {
    const demandUnits = ctx.demand[commodity];
    if (!(typeof demandUnits === "number" && demandUnits > 0)) continue;
    const potentialAt = (extra: number): number =>
      computeSupplierCommodityCapacityUnits({
        sectors: ctx.sectors.map((s) => ({
          ...s,
          capitalStock:
            (s.capitalStock ?? 0) +
            (Number.isFinite(s.queuedUnits) ? Math.max(0, s.queuedUnits as number) : 0) +
            (String(s._id) === ctx.targetSectorId ? extra : 0),
        })),
        commodity,
        isNatcorp: ctx.isNatcorp,
        turn: ctx.turn,
        currentYear: ctx.currentYear,
        commandEconomyEnabled: ctx.commandEconomyEnabled,
      });
    const potentialUnits = potentialAt(0);
    const yieldPerUnit = (potentialAt(probe) - potentialUnits) / probe;
    models.push({
      commodity,
      label: COMMODITY_LABELS[commodity] ?? commodity,
      demandUnits,
      potentialUnits,
      yieldPerUnit,
    });
  }
  return models;
}
