/**
 * Manufacturing product lines are limited by owned active plants, their current production
 * strategy, and that strategy's modeled output commodities. See legalManufacturingProductKinds.
 */
import { validateProductAllocations, type ProductPlantAllocation } from "./plantAllocations";
export { validateProductAllocations, type ProductPlantAllocation } from "./plantAllocations";
import { getOperatingSectorType, SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { CorporationType, ManufacturingIndustryModel } from "@/lib/constants/corporations";
import { getStrategyAvailability } from "@/lib/constants/techTree/strategyAvailability";
import type { TechLane } from "@/lib/constants/techTree/nodes";
import { getManufacturingProductKind, MANUFACTURING_PRODUCT_KINDS } from "../manufacturingCatalog";

export interface ManufacturingPlant {
  sectorId: string;
  corporationId: string;
  sectorType: string;
  industryModel?: ManufacturingIndustryModel | null;
  strategyId?: string | null;
  capitalStock: number;
  plantCount: number;
  mothballed?: boolean;
}

export interface ManufacturingCapacityAllocation {
  sectorId: string;
  capacityStock: number;
  share: number;
}

export interface ManufacturingProductEligibilityOptions {
  currentYear?: number;
  techTreesEnabled?: boolean;
  unlockedTechNodeIds?: readonly string[];
  techDecadeLane?: Record<string, TechLane>;
}

function hasRealCapacity(plant: ManufacturingPlant): boolean {
  return (
    !plant.mothballed &&
    Number.isFinite(plant.capitalStock) &&
    plant.capitalStock > 0 &&
    Number.isInteger(plant.plantCount) &&
    plant.plantCount > 0
  );
}

/** Returns product kinds whose commodity is in the current strategy of an owned active plant. */
export function legalManufacturingProductKinds(
  plants: readonly ManufacturingPlant[],
  options?: ManufacturingProductEligibilityOptions
) {
  const legal = new Set<string>();
  for (const plant of plants) {
    if (!hasRealCapacity(plant)) continue;
    const operatingType = getOperatingSectorType(plant.sectorType, plant.industryModel);
    const strategies = SECTOR_STRATEGIES[operatingType as keyof typeof SECTOR_STRATEGIES];
    const strategy = strategies?.find(
      (candidate) => candidate.id === (plant.strategyId ?? "standard")
    );
    if (!strategy) continue;
    if (options?.techTreesEnabled && options.currentYear != null) {
      const availability = getStrategyAvailability(
        {
          type: operatingType as CorporationType,
          unlockedTechNodeIds: options.unlockedTechNodeIds
            ? [...options.unlockedTechNodeIds]
            : undefined,
          techDecadeLane: options.techDecadeLane,
        },
        strategy,
        options.currentYear,
        true
      );
      if (availability.locked) continue;
    }
    for (const kind of MANUFACTURING_PRODUCT_KINDS) {
      if (
        kind.sectorTypes.includes(operatingType as CorporationType) &&
        kind.strategyIds.includes(strategy.id) &&
        (strategy.supply[kind.outputCommodity] ?? 0) > 0
      ) {
        legal.add(kind.id);
      }
    }
  }
  return MANUFACTURING_PRODUCT_KINDS.filter((kind) => legal.has(kind.id));
}

/** Resolves allocated plant capacity from real `capitalStock`, never synthetic capacity fields. */
export function allocationsForPlantCapacity(
  plants: readonly ManufacturingPlant[],
  allocations: readonly ProductPlantAllocation[]
): ManufacturingCapacityAllocation[] {
  if (!validateProductAllocations(allocations)) return [];
  const plantById = new Map(plants.map((plant) => [plant.sectorId, plant]));
  return allocations.flatMap(({ sectorId, share }) => {
    const plant = plantById.get(sectorId);
    if (!plant || !hasRealCapacity(plant) || share <= 0) return [];
    return [{ sectorId, capacityStock: plant.capitalStock * share, share }];
  });
}

export function isLegalManufacturingProductForPlant(
  kindId: string,
  plant: ManufacturingPlant,
  options?: ManufacturingProductEligibilityOptions
): boolean {
  const kind = getManufacturingProductKind(kindId);
  if (
    !kind ||
    !hasRealCapacity(plant) ||
    !kind.sectorTypes.includes(
      getOperatingSectorType(plant.sectorType, plant.industryModel) as CorporationType
    )
  ) {
    return false;
  }
  const operatingType = getOperatingSectorType(plant.sectorType, plant.industryModel);
  const strategy = SECTOR_STRATEGIES[operatingType as keyof typeof SECTOR_STRATEGIES]?.find(
    (candidate) => candidate.id === (plant.strategyId ?? "standard")
  );
  if (
    strategy &&
    options?.techTreesEnabled &&
    options.currentYear != null &&
    getStrategyAvailability(
      {
        type: operatingType as CorporationType,
        industryModel: plant.industryModel,
        unlockedTechNodeIds: options.unlockedTechNodeIds
          ? [...options.unlockedTechNodeIds]
          : undefined,
        techDecadeLane: options.techDecadeLane,
      },
      strategy,
      options.currentYear,
      true
    ).locked
  ) {
    return false;
  }
  return (
    !!strategy &&
    kind.strategyIds.includes(strategy.id) &&
    (strategy.supply[kind.outputCommodity] ?? 0) > 0
  );
}
