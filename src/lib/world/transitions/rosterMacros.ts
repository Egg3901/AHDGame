import type { CorporationType } from "@/lib/constants/corporations";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { MacroCountryState, MacroSectorState } from "@/lib/world/macro/types";
import { computeMacroContribution } from "@/lib/world/macro/kernel";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { getGhanaMacroCountry } from "./ghana";
import {
  ALGERIA_ENTITY_ID,
  ANGOLA_ENTITY_ID,
  CONGO_ENTITY_ID,
  GHANA_ENTITY_ID,
  GUYANA_ENTITY_ID,
  MOZAMBIQUE_ENTITY_ID,
  SOMALIA_ENTITY_ID,
  SOUTH_YEMEN_ENTITY_ID,
} from "./rules";

const TURNS_PER_YEAR = 48;

interface MacroProfile {
  entityId: WorldEntityId;
  displayName: string;
  population: number;
  annualGdp: number;
  fiscalCapacity: number;
  stability: number;
  tradeExposure: number;
  sectorWeights: Partial<Record<CorporationType, number>>;
  resources: Partial<Record<ExtractableResource, number>>;
}

function buildSectors(
  annualGdp: number,
  weights: Partial<Record<CorporationType, number>>
): Partial<Record<CorporationType, MacroSectorState>> {
  const perTurnGdp = annualGdp / TURNS_PER_YEAR;
  const weightSum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  const sectors: Partial<Record<CorporationType, MacroSectorState>> = {};

  for (const [sectorType, weight] of Object.entries(weights) as [CorporationType, number][]) {
    if (weight <= 0) continue;
    const capacity = (perTurnGdp * weight) / weightSum;
    const demandRatio =
      sectorType === "agriculture" || sectorType === "extraction"
        ? 0.7
        : sectorType === "retail" || sectorType === "healthcare"
          ? 1.05
          : 0.92;
    sectors[sectorType] = {
      capacity: Math.round(capacity * 100) / 100,
      productivity: 1,
      domesticDemand: Math.round(capacity * demandRatio * 100) / 100,
    };
  }
  return sectors;
}

function buildMacroCountry(profile: MacroProfile, turn: number, now: Date): MacroCountryState {
  const sectors = buildSectors(profile.annualGdp, profile.sectorWeights);
  const base = {
    _id: profile.entityId,
    entityId: profile.entityId,
    presetId: "1953-default",
    displayName: profile.displayName,
    economicSystem: "market" as const,
    population: profile.population,
    fiscalCapacity: profile.fiscalCapacity,
    stability: profile.stability,
    tradeExposure: profile.tradeExposure,
    shockModifier: 1,
    resources: profile.resources,
    sectors,
    dataQuality: {
      provenance: "authored-1953" as const,
      economicSystem: "market" as const,
      missingFields: [] as string[],
      fallbackFields: [] as string[],
    },
    lastMacroTickTurn: null as number | null,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...base,
    contribution: computeMacroContribution(base, turn),
    lastMacroTickTurn: turn,
  };
}

/** Independence-era sphere-macro profiles for the #3727 roster (plus Ghana via registry). */
const ROSTER_PROFILES: Readonly<Record<string, MacroProfile>> = Object.freeze({
  [SOMALIA_ENTITY_ID]: {
    entityId: SOMALIA_ENTITY_ID,
    displayName: "Somalia",
    population: 2_900_000,
    annualGdp: 1_400,
    fiscalCapacity: 0.12,
    stability: 0.48,
    tradeExposure: 0.4,
    sectorWeights: {
      agriculture: 40,
      extraction: 4,
      manufacturing: 6,
      logistics: 8,
      retail: 8,
      energy: 3,
      construction: 4,
      financial: 3,
      real_estate: 2,
      healthcare: 3,
      telecommunications: 2,
      media: 2,
      entertainment: 1,
      defense: 4,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 2, iron: 1, oil: 0, coal: 0, natural_gas: 0, rare_earth: 0 },
  },
  [CONGO_ENTITY_ID]: {
    entityId: CONGO_ENTITY_ID,
    displayName: "Congo",
    population: 15_300_000,
    annualGdp: 4_200,
    fiscalCapacity: 0.14,
    stability: 0.35,
    tradeExposure: 0.5,
    sectorWeights: {
      agriculture: 28,
      extraction: 26,
      manufacturing: 8,
      logistics: 7,
      retail: 6,
      energy: 5,
      construction: 4,
      financial: 3,
      real_estate: 2,
      healthcare: 3,
      telecommunications: 2,
      media: 2,
      entertainment: 1,
      defense: 3,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 18, iron: 8, oil: 2, coal: 4, natural_gas: 0, rare_earth: 6 },
  },
  [ALGERIA_ENTITY_ID]: {
    entityId: ALGERIA_ENTITY_ID,
    displayName: "Algeria",
    population: 11_000_000,
    annualGdp: 5_800,
    fiscalCapacity: 0.2,
    stability: 0.45,
    tradeExposure: 0.48,
    sectorWeights: {
      agriculture: 22,
      extraction: 18,
      energy: 14,
      manufacturing: 12,
      logistics: 7,
      retail: 6,
      construction: 5,
      financial: 4,
      real_estate: 3,
      healthcare: 3,
      telecommunications: 2,
      media: 2,
      entertainment: 1,
      defense: 1,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 2, iron: 10, oil: 22, coal: 2, natural_gas: 14, rare_earth: 0 },
  },
  [GUYANA_ENTITY_ID]: {
    entityId: GUYANA_ENTITY_ID,
    displayName: "Guyana",
    population: 600_000,
    annualGdp: 900,
    fiscalCapacity: 0.16,
    stability: 0.55,
    tradeExposure: 0.6,
    sectorWeights: {
      agriculture: 30,
      extraction: 16,
      manufacturing: 8,
      logistics: 8,
      retail: 8,
      energy: 4,
      construction: 5,
      financial: 4,
      real_estate: 3,
      healthcare: 4,
      telecommunications: 2,
      media: 2,
      entertainment: 2,
      defense: 2,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 16, iron: 4, oil: 0, coal: 0, natural_gas: 0, rare_earth: 2 },
  },
  [SOUTH_YEMEN_ENTITY_ID]: {
    entityId: SOUTH_YEMEN_ENTITY_ID,
    displayName: "South Yemen",
    population: 1_500_000,
    annualGdp: 1_100,
    fiscalCapacity: 0.15,
    stability: 0.42,
    tradeExposure: 0.55,
    sectorWeights: {
      logistics: 18,
      agriculture: 22,
      extraction: 6,
      manufacturing: 8,
      retail: 10,
      energy: 5,
      construction: 5,
      financial: 4,
      real_estate: 3,
      healthcare: 4,
      telecommunications: 3,
      media: 2,
      entertainment: 2,
      defense: 6,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 1, iron: 1, oil: 4, coal: 0, natural_gas: 2, rare_earth: 0 },
  },
  [ANGOLA_ENTITY_ID]: {
    entityId: ANGOLA_ENTITY_ID,
    displayName: "Angola",
    population: 6_800_000,
    annualGdp: 3_600,
    fiscalCapacity: 0.13,
    stability: 0.32,
    tradeExposure: 0.52,
    sectorWeights: {
      agriculture: 26,
      extraction: 22,
      energy: 10,
      manufacturing: 8,
      logistics: 7,
      retail: 6,
      construction: 5,
      financial: 3,
      real_estate: 2,
      healthcare: 3,
      telecommunications: 2,
      media: 2,
      entertainment: 1,
      defense: 3,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 12, iron: 6, oil: 20, coal: 2, natural_gas: 4, rare_earth: 1 },
  },
  [MOZAMBIQUE_ENTITY_ID]: {
    entityId: MOZAMBIQUE_ENTITY_ID,
    displayName: "Mozambique",
    population: 10_200_000,
    annualGdp: 2_400,
    fiscalCapacity: 0.12,
    stability: 0.38,
    tradeExposure: 0.45,
    sectorWeights: {
      agriculture: 36,
      extraction: 10,
      manufacturing: 8,
      logistics: 9,
      retail: 7,
      energy: 5,
      construction: 5,
      financial: 3,
      real_estate: 2,
      healthcare: 4,
      telecommunications: 2,
      media: 2,
      entertainment: 1,
      defense: 4,
      automobiles: 0,
      chemical_industries: 0,
      technology: 0,
    },
    resources: { timber: 14, iron: 4, oil: 2, coal: 8, natural_gas: 6, rare_earth: 1 },
  },
});

/**
 * Build the Tier-2 macro document for a post-sovereignty target entity.
 * Returns null when the target is not authored as sphere-macro (Tier-3 only).
 */
export function getTransitionMacroCountry(
  entityId: WorldEntityId,
  turn: number,
  now = new Date()
): MacroCountryState | null {
  if (entityId === GHANA_ENTITY_ID) {
    return getGhanaMacroCountry(turn, now);
  }
  const profile = ROSTER_PROFILES[entityId];
  if (!profile) return null;
  return buildMacroCountry(profile, turn, now);
}

export function hasTransitionMacroSeed(entityId: WorldEntityId): boolean {
  return entityId === GHANA_ENTITY_ID || entityId in ROSTER_PROFILES;
}
