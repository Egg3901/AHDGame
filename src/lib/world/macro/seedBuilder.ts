import type { CorporationType } from "@/lib/constants/corporations";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { computeMacroContribution } from "./kernel";
import type {
  MacroCountryDataQuality,
  MacroCountryState,
  MacroEconomicSystem,
  MacroSectorState,
} from "./types";

export const MACRO_TURNS_PER_YEAR = 48;
export const MACRO_1953_PRESET_ID = "1953-default";

/** Authored seed inputs for a sphere-macro country. Never inherit another era. */
export interface MacroCountrySeedSpec {
  entityId: WorldEntityId;
  displayName: string;
  economicSystem: MacroEconomicSystem;
  population: number;
  /** Annual GDP in game units (millions), same scale as Austria's 7_500. */
  annualGdpGameUnits: number;
  fiscalCapacity: number;
  stability: number;
  tradeExposure: number;
  sectorWeights: Partial<Record<CorporationType, number>>;
  resources: Partial<Record<ExtractableResource, number>>;
}

const REQUIRED_SCALAR_FIELDS = [
  "population",
  "fiscalCapacity",
  "stability",
  "tradeExposure",
  "annualGdpGameUnits",
] as const;

/**
 * Domestic demand vs capacity. Planned economies run chronic consumer
 * shortages (retail/healthcare demand > capacity) while heavy industry
 * overproduces relative to domestic absorption.
 */
function demandRatio(sectorType: CorporationType, economicSystem: MacroEconomicSystem): number {
  if (economicSystem === "planned") {
    if (sectorType === "retail" || sectorType === "healthcare" || sectorType === "entertainment") {
      return 1.25;
    }
    if (
      sectorType === "manufacturing" ||
      sectorType === "extraction" ||
      sectorType === "defense" ||
      sectorType === "energy"
    ) {
      return 0.75;
    }
    return 0.9;
  }

  if (sectorType === "manufacturing" || sectorType === "extraction" || sectorType === "energy") {
    return 0.85;
  }
  if (sectorType === "retail" || sectorType === "healthcare") {
    return 1.05;
  }
  return 0.95;
}

export function buildSectorsFromSpec(
  spec: Pick<MacroCountrySeedSpec, "annualGdpGameUnits" | "sectorWeights" | "economicSystem">
): Partial<Record<CorporationType, MacroSectorState>> {
  const perTurnGdp = spec.annualGdpGameUnits / MACRO_TURNS_PER_YEAR;
  const weightSum = Object.values(spec.sectorWeights).reduce((a, b) => a + (b ?? 0), 0);
  if (weightSum <= 0) {
    throw new Error("Macro seed sector weights must sum to a positive total.");
  }

  const sectors: Partial<Record<CorporationType, MacroSectorState>> = {};
  for (const [sectorType, weight] of Object.entries(spec.sectorWeights) as [
    CorporationType,
    number,
  ][]) {
    if (weight <= 0) continue;
    const capacity = (perTurnGdp * weight) / weightSum;
    const ratio = demandRatio(sectorType, spec.economicSystem);
    sectors[sectorType] = {
      capacity: Math.round(capacity * 100) / 100,
      productivity: 1,
      domesticDemand: Math.round(capacity * ratio * 100) / 100,
    };
  }
  return sectors;
}

/**
 * Assess authored-seed completeness. Fallback fields must stay empty — Tier-2
 * countries never silently inherit modern-preset bundles (#3719).
 */
export function assessMacroSeedDataQuality(
  spec: MacroCountrySeedSpec,
  sectors: Partial<Record<CorporationType, MacroSectorState>>
): MacroCountryDataQuality {
  const missingFields: string[] = [];
  const fallbackFields: string[] = [];

  for (const field of REQUIRED_SCALAR_FIELDS) {
    const value = spec[field];
    if (!Number.isFinite(value) || value <= 0) missingFields.push(field);
  }
  if (spec.fiscalCapacity > 1) missingFields.push("fiscalCapacity(outOfRange)");
  if (spec.stability > 1) missingFields.push("stability(outOfRange)");
  if (spec.tradeExposure > 1) missingFields.push("tradeExposure(outOfRange)");

  if (Object.keys(sectors).length === 0) missingFields.push("sectors");
  if (Object.keys(spec.resources).length === 0) missingFields.push("resources");
  if (!spec.economicSystem) missingFields.push("economicSystem");

  return {
    provenance: "authored-1953",
    economicSystem: spec.economicSystem,
    missingFields,
    fallbackFields,
  };
}

export function buildMacroCountryFromSpec(
  spec: MacroCountrySeedSpec,
  now = new Date(),
  options: { markInitialTick?: boolean } = {}
): MacroCountryState {
  const sectors = buildSectorsFromSpec(spec);
  const dataQuality = assessMacroSeedDataQuality(spec, sectors);
  if (dataQuality.missingFields.length > 0) {
    throw new Error(
      `Macro seed ${spec.entityId} is incomplete: missing ${dataQuality.missingFields.join(", ")}`
    );
  }
  if (dataQuality.fallbackFields.length > 0) {
    throw new Error(
      `Macro seed ${spec.entityId} illegally falls back: ${dataQuality.fallbackFields.join(", ")}`
    );
  }

  const base: Omit<MacroCountryState, "contribution"> = {
    _id: spec.entityId,
    entityId: spec.entityId,
    presetId: MACRO_1953_PRESET_ID,
    displayName: spec.displayName,
    economicSystem: spec.economicSystem,
    population: spec.population,
    fiscalCapacity: spec.fiscalCapacity,
    stability: spec.stability,
    tradeExposure: spec.tradeExposure,
    shockModifier: 1,
    resources: spec.resources,
    sectors,
    dataQuality,
    lastMacroTickTurn: options.markInitialTick ? 1 : null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...base,
    contribution: computeMacroContribution(base, 1),
    lastMacroTickTurn: options.markInitialTick ? 1 : null,
  };
}
