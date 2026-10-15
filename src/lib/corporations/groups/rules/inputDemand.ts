/** Input demand uses the market ledger recipe, production utilization and era unit scale. */
import {
  energyProductivityMultiplier,
  plantUtilizationForInputs,
} from "@/lib/corporations/rules/energyProductivityRamp";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { getInputMultiplier } from "@/lib/utils/productionPolicy";
import {
  COMMODITY_BASE_PRICES,
  NATCORP_COMMODITY_MULTIPLIER,
  dollarsToUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import {
  supplyAgreementRequiresState,
  supplyAgreementScopeKey,
} from "@/lib/market/commodityMarketScope";
import type { SupplyAgreementDemandSector } from "@/lib/turn/corporation/settleSupplyAgreementsAllocation";
export function computeSupplyAgreementBuyerDemand(args: {
  preset?: string;
  hardwareInputReliefStartTurn?: number;
  sectors: readonly SupplyAgreementDemandSector[];
  currentTurn: number;
  unitScale: number;
  plantsEnabled: boolean;
}): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const unitScale = Number.isFinite(args.unitScale) && args.unitScale > 0 ? args.unitScale : 1;

  for (const sector of args.sectors) {
    if (args.plantsEnabled && sector.mothballed === true) continue;
    const rates = getEffectiveStrategyRatesForOperatingModel(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      args.currentTurn,
      sector.industryModel,
      sector.mediaDiscriminator,
      args.preset,
      args.hardwareInputReliefStartTurn
    );
    const utilization =
      args.plantsEnabled &&
      typeof sector.producedUnits === "number" &&
      typeof sector.capacityUnits === "number" &&
      sector.capacityUnits > 0
        ? plantUtilizationForInputs(
            sector.producedUnits,
            sector.capacityUnits,
            energyProductivityMultiplier(sector.sectorType, args.currentTurn, args.preset)
          )
        : 1;
    const inputMultiplier = getInputMultiplier(sector.productionPolicyLevel ?? 0);
    const natcorpMultiplier = sector.isNatcorp ? NATCORP_COMMODITY_MULTIPLIER : 1;
    for (const [commodity, rate] of Object.entries(rates.demand ?? {}) as [
      CommodityType,
      number,
    ][]) {
      const basePrice = COMMODITY_BASE_PRICES[commodity];
      if (!(rate > 0) || !(basePrice > 0)) continue;
      const units =
        dollarsToUnits(Math.max(0, sector.revenueAnchor) * rate, basePrice) *
        unitScale *
        inputMultiplier *
        natcorpMultiplier *
        utilization;
      if (!(units > 0)) continue;
      const byKey = result.get(sector.corporationId) ?? new Map<string, number>();
      byKey.set(commodity, (byKey.get(commodity) ?? 0) + units);
      if (sector.stateId && supplyAgreementRequiresState(commodity)) {
        const stateKey = supplyAgreementScopeKey(commodity, sector.stateId);
        byKey.set(stateKey, (byKey.get(stateKey) ?? 0) + units);
      }
      result.set(sector.corporationId, byKey);
    }
  }

  return result;
}
