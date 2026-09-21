import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import { isDecadeReached } from "@/lib/constants/techTree/decades";
import { getStrategyAvailability } from "@/lib/constants/techTree/strategyAvailability";
import { getProductKind } from "./catalog";

/**
 * Industrial-manufacturing start requirements (issues #2236/#2238).
 *
 * Pure rules: which corporation types, plants, production strategies, era,
 * and technologies a manufactured product kind needs before development may
 * start. Only outputs already modeled by the commodity system appear here
 * (vehicles, electronics, steel, building_materials); nothing here may
 * introduce a new commodity.
 *
 * Strategy lists are drawn from the strategies whose supply mix contains the
 * kind's output commodity. A kind's `minDecade` mirrors the era floor of its
 * most basic compatible strategy; stricter strategy-era gates (e.g. the 2029
 * autonomous factory) are enforced through the running strategy's own
 * availability check, not duplicated here.
 */
export interface ManufacturingKindRequirement {
  kindId: string;
  outputCommodity: CommodityType;
  /** Corporation sector types that can build this kind. */
  sectorTypes: readonly CorporationType[];
  /** Compatible production-strategy ids within those sector types. */
  strategyIds: readonly string[];
  /** Era floor; absent means buildable in any era. */
  minDecade?: string;
}

const REQUIREMENTS: readonly ManufacturingKindRequirement[] = [
  {
    kindId: "passenger_car",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles"],
    strategyIds: ["standard", "ev", "autonomous_driving"],
  },
  {
    kindId: "truck",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles"],
    strategyIds: ["heavy_machinery", "standard"],
  },
  {
    kindId: "commercial_vehicle",
    outputCommodity: "vehicles",
    sectorTypes: ["automobiles"],
    strategyIds: ["heavy_machinery", "standard", "ev"],
  },
  {
    kindId: "consumer_electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing"],
    minDecade: "1979",
  },
  {
    kindId: "industrial_electronics",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing", "additive_manufacturing"],
    minDecade: "1979",
  },
  {
    kindId: "electronic_components",
    outputCommodity: "electronics",
    sectorTypes: ["manufacturing"],
    strategyIds: ["electronics_manufacturing"],
    minDecade: "1979",
  },
  {
    kindId: "structural_steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "heavy_metals"],
  },
  {
    kindId: "sheet_steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "heavy_metals", "autonomous_factory"],
  },
  {
    kindId: "specialty_steel",
    outputCommodity: "steel",
    sectorTypes: ["manufacturing"],
    strategyIds: ["heavy_metals", "additive_manufacturing", "autonomous_factory"],
  },
  {
    kindId: "cement",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory"],
  },
  {
    kindId: "prefabricated_components",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory", "additive_manufacturing"],
  },
  {
    kindId: "construction_materials",
    outputCommodity: "building_materials",
    sectorTypes: ["manufacturing"],
    strategyIds: ["standard", "autonomous_factory", "additive_manufacturing"],
  },
];

const REQUIREMENT_BY_KIND = new Map<string, ManufacturingKindRequirement>(
  REQUIREMENTS.map((requirement) => [requirement.kindId, requirement])
);

/** Start requirements for one manufactured kind, if it is one. */
export function manufacturingKindRequirements(
  kindId: string
): ManufacturingKindRequirement | undefined {
  return REQUIREMENT_BY_KIND.get(kindId);
}

/** Display names for a kind's compatible strategies. */
export function manufacturingStrategyLabels(kindId: string): string[] {
  const requirement = REQUIREMENT_BY_KIND.get(kindId);
  if (!requirement) return [];
  const labels: string[] = [];
  for (const sectorType of requirement.sectorTypes) {
    const strategies = SECTOR_STRATEGIES[sectorType] ?? [];
    for (const strategyId of requirement.strategyIds) {
      const strategy = strategies.find((candidate) => candidate.id === strategyId);
      if (strategy && !labels.includes(strategy.name)) labels.push(strategy.name);
    }
  }
  return labels;
}

export interface ManufacturingPlantInput {
  /** Boundary values stay unknown-typed; the guards below narrow them. */
  sectorType: unknown;
  strategyId?: unknown;
  capacity?: unknown;
  mothballed?: unknown;
}

interface UsablePlant {
  sectorType: string;
  strategyId?: unknown;
  capacity?: unknown;
  mothballed?: unknown;
}

export interface ValidateManufacturingStartInput {
  kindId: string;
  /** Corporation type plus secondary type when present. */
  corporationTypes: readonly string[];
  plants: readonly ManufacturingPlantInput[];
  /** World year; a gated kind with no usable year fails closed. */
  currentYear?: number | null;
  /** Technology ids the corporation unlocked. */
  unlockedTechnologyIds?: readonly string[];
  /** Tech-tree gating master switch; off skips era/tech strategy checks. */
  techTreesEnabled?: boolean;
}

export type ManufacturingStartRejectReason =
  | "unknown_product_kind"
  | "incompatible_corporation_type"
  | "no_compatible_plant"
  | "incompatible_strategy"
  | "era_locked"
  | "technology_locked";

export type ValidateManufacturingStartResult =
  | {
      ok: true;
      requirement: ManufacturingKindRequirement;
      sectorType: string;
      strategyId: string;
    }
  | { ok: false; reason: ManufacturingStartRejectReason; message: string };

function isUsablePlant(
  plant: ManufacturingPlantInput,
  sectorTypes: readonly string[]
): plant is UsablePlant {
  if (!plant || typeof plant.sectorType !== "string") return false;
  if (!sectorTypes.includes(plant.sectorType)) return false;
  if (plant.mothballed === true) return false;
  return (
    typeof plant.capacity === "number" && Number.isFinite(plant.capacity) && plant.capacity > 0
  );
}

/**
 * Validates an industrial-manufacturing product start. Pure: plain data in,
 * verdict out. Checks run cheapest-first so the message names the actual
 * blocker: kind, corporation type, plant/capacity, strategy, era, technology.
 */
export function validateManufacturingProductStart(
  input: ValidateManufacturingStartInput
): ValidateManufacturingStartResult {
  const kind = getProductKind(input.kindId);
  const requirement = REQUIREMENT_BY_KIND.get(input.kindId);
  if (!kind || kind.family !== "industrial_manufacturing" || !requirement) {
    return {
      ok: false,
      reason: "unknown_product_kind",
      message: `Unknown industrial product "${input.kindId}"`,
    };
  }

  const corpTypes = Array.isArray(input.corporationTypes)
    ? input.corporationTypes.filter((type): type is string => typeof type === "string")
    : [];
  const eligibleType = requirement.sectorTypes.some((sectorType) => corpTypes.includes(sectorType));
  if (!eligibleType) {
    return {
      ok: false,
      reason: "incompatible_corporation_type",
      message: `"${kind.label}" needs a ${requirement.sectorTypes.join(" or ")} corporation`,
    };
  }

  const plants = Array.isArray(input.plants) ? input.plants : [];
  const usable = plants.filter((plant) =>
    isUsablePlant(plant, requirement.sectorTypes as readonly string[])
  );
  if (usable.length === 0) {
    return {
      ok: false,
      reason: "no_compatible_plant",
      message: `"${kind.label}" needs an active ${requirement.sectorTypes.join(" or ")} plant with capacity`,
    };
  }

  const matched = usable.filter(
    (plant) =>
      typeof plant.strategyId === "string" && requirement.strategyIds.includes(plant.strategyId)
  );
  if (matched.length === 0) {
    return {
      ok: false,
      reason: "incompatible_strategy",
      message:
        `"${kind.label}" needs a plant running a compatible process: ` +
        requirement.strategyIds.join(", "),
    };
  }

  const year = input.currentYear;
  const yearUsable = typeof year === "number" && Number.isFinite(year);
  if (requirement.minDecade) {
    if (!yearUsable || !isDecadeReached(requirement.minDecade, year)) {
      return {
        ok: false,
        reason: "era_locked",
        message: `"${kind.label}" unlocks once the world reaches the ${requirement.minDecade}s`,
      };
    }
  }

  const catalogRequired = kind.requiredTechnologyIds ?? [];
  if (catalogRequired.length > 0) {
    const unlocked = new Set(
      (Array.isArray(input.unlockedTechnologyIds) ? input.unlockedTechnologyIds : []).filter(
        (id): id is string => typeof id === "string"
      )
    );
    const missing = catalogRequired.filter((id) => !unlocked.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: "technology_locked",
        message: `"${kind.label}" needs research the corporation has not unlocked yet`,
      };
    }
  }

  if (input.techTreesEnabled === true && yearUsable) {
    const unlockedIds = (
      Array.isArray(input.unlockedTechnologyIds) ? input.unlockedTechnologyIds : []
    ).filter((id): id is string => typeof id === "string");
    const corpType = corpTypes.find((type): type is CorporationType =>
      (requirement.sectorTypes as readonly string[]).includes(type)
    );
    if (corpType) {
      const unlocked = matched.some((plant) => {
        const strategies = SECTOR_STRATEGIES[corpType] ?? [];
        const strategy = strategies.find((candidate) => candidate.id === plant.strategyId);
        if (!strategy) return false;
        const availability = getStrategyAvailability(
          { type: corpType, unlockedTechNodeIds: unlockedIds },
          strategy,
          year,
          true
        );
        return !availability.locked;
      });
      if (!unlocked) {
        const reasons = new Set(
          matched.map((plant) => {
            const strategies = SECTOR_STRATEGIES[corpType] ?? [];
            const strategy = strategies.find((candidate) => candidate.id === plant.strategyId);
            if (!strategy) return "tech";
            return (
              getStrategyAvailability(
                { type: corpType, unlockedTechNodeIds: unlockedIds },
                strategy,
                year,
                true
              ).reason ?? "tech"
            );
          })
        );
        if (reasons.has("era") && reasons.size === 1) {
          return {
            ok: false,
            reason: "era_locked",
            message: `"${kind.label}" needs a production process the current era has not reached`,
          };
        }
        return {
          ok: false,
          reason: "technology_locked",
          message: `"${kind.label}" needs a production process the corporation has not unlocked yet`,
        };
      }
    }
  }

  const first = matched[0];
  if (!first || typeof first.strategyId !== "string") {
    return {
      ok: false,
      reason: "incompatible_strategy",
      message:
        `"${kind.label}" needs a plant running a compatible process: ` +
        requirement.strategyIds.join(", "),
    };
  }
  return {
    ok: true,
    requirement,
    sectorType: first.sectorType,
    strategyId: first.strategyId,
  };
}
