import type { CommodityType } from "@/lib/constants/commodities";
import { commodityMixWeight, eraScaledBasePrices } from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { analyzeSectorProfitability } from "@/lib/turn/npp/sectorProfitability";
import {
  isLegalManufacturingProductForPlant,
  legalManufacturingProductKinds,
  type ManufacturingPlant,
  type ProductPlantAllocation,
} from "./manufacturingEligibility";
import {
  chooseNppManufacturingProduct,
  type NppManufacturingProductCandidate,
} from "./manufacturingNpp";

/** Selects an NPP product from its current, legal plants and operating mix. */
export function selectNppManufacturingProduct(input: {
  corporationId: string;
  sectors: readonly CorporateSector[];
  turn: number;
  currentYear?: number;
  techTreesEnabled: boolean;
  unlockedTechNodeIds?: readonly string[];
  eraUnitScale: number;
  priceRatioOf: (commodity: CommodityType) => number;
}): NppManufacturingProductCandidate | undefined {
  const plants: ManufacturingPlant[] = input.sectors.map((sector) => ({
    sectorId: sector._id.toString(),
    corporationId: input.corporationId,
    sectorType: sector.sectorType,
    strategyId: sector.strategyId,
    capitalStock: sector.capitalStock ?? 0,
    plantCount: sector.plantCount ?? 0,
    mothballed: sector.mothballed,
  }));
  const legalKinds = legalManufacturingProductKinds(plants, {
    currentYear: input.currentYear,
    techTreesEnabled: input.techTreesEnabled,
    unlockedTechNodeIds: input.unlockedTechNodeIds,
  });
  const profits = analyzeSectorProfitability(input.sectors, true);
  const sectorById = new Map(input.sectors.map((sector) => [sector._id.toString(), sector]));
  const marginBySectorId = new Map(
    profits.map((profit) => [profit.sector._id.toString(), profit.margin])
  );
  const basePrices = eraScaledBasePrices(input.eraUnitScale);
  const candidates = legalKinds.flatMap((kind) => {
    const compatiblePlants = plants.filter((plant) =>
      isLegalManufacturingProductForPlant(kind.id, plant)
    );
    const capacityStock = compatiblePlants.reduce((sum, plant) => sum + plant.capitalStock, 0);
    if (capacityStock <= 0) return [];
    const marginWeighted = compatiblePlants.reduce(
      (sum, plant) => sum + plant.capitalStock * (marginBySectorId.get(plant.sectorId) ?? 0),
      0
    );
    const mixWeight = compatiblePlants.reduce((sum, plant) => {
      const sector = sectorById.get(plant.sectorId);
      const currentRates = getEffectiveStrategyRates(
        plant.sectorType,
        plant.strategyId ?? "standard",
        sector?.transitionFromStrategyId,
        sector?.transitionStartTurn,
        input.turn
      );
      return (
        sum +
        plant.capitalStock *
          commodityMixWeight(currentRates.supply, basePrices, kind.outputCommodity)
      );
    }, 0);
    return [
      {
        kindId: kind.id,
        outputCommodity: kind.outputCommodity,
        allocations: compatiblePlants.map((plant): ProductPlantAllocation => ({
          sectorId: plant.sectorId,
          share: 1,
        })),
        capacityStock,
        capacityWeightedMarginPct: marginWeighted / capacityStock,
        scarcityPriceRatio: input.priceRatioOf(kind.outputCommodity),
        supplyMixWeight: mixWeight / capacityStock,
      },
    ];
  });
  return chooseNppManufacturingProduct(candidates);
}
