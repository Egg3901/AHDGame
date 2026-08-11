import type { CorporationType } from "@/lib/constants/corporations";
import type { MacroCountryState, MacroSectorState } from "@/lib/world/macro/types";
import { computeMacroContribution } from "@/lib/world/macro/kernel";
import { GHANA_ENTITY_ID } from "./rules";

/**
 * 1957 Ghana as a sphere-macro (Tier-2) country.
 *
 * Era notes (strong defaults):
 * - Population ~6.2M at independence (1957).
 * - Cocoa / gold / timber export economy; modest industry.
 * - Commonwealth primary sphere with secondary US ties.
 */
const GHANA_1957_SECTOR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  agriculture: 32,
  extraction: 14,
  manufacturing: 10,
  logistics: 8,
  retail: 7,
  energy: 5,
  construction: 5,
  financial: 4,
  real_estate: 3,
  healthcare: 3,
  telecommunications: 2,
  media: 2,
  entertainment: 2,
  defense: 2,
  automobiles: 1,
  chemical_industries: 0,
  technology: 0,
};

/** Annual GDP in game units (millions) — small open tropical export economy. */
const GHANA_1957_GDP = 2_800;
const TURNS_PER_YEAR = 48;

function buildSectors(): Partial<Record<CorporationType, MacroSectorState>> {
  const perTurnGdp = GHANA_1957_GDP / TURNS_PER_YEAR;
  const weightSum = Object.values(GHANA_1957_SECTOR_WEIGHTS).reduce((a, b) => a + (b ?? 0), 0);
  const sectors: Partial<Record<CorporationType, MacroSectorState>> = {};

  for (const [sectorType, weight] of Object.entries(GHANA_1957_SECTOR_WEIGHTS) as [
    CorporationType,
    number,
  ][]) {
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

export function buildGhanaMacroSeed(
  turn: number,
  now = new Date()
): Omit<MacroCountryState, "contribution"> & {
  contribution?: MacroCountryState["contribution"];
} {
  const sectors = buildSectors();
  const base = {
    _id: GHANA_ENTITY_ID,
    entityId: GHANA_ENTITY_ID,
    presetId: "1953-default",
    displayName: "Ghana",
    economicSystem: "market" as const,
    population: 6_200_000,
    fiscalCapacity: 0.18,
    stability: 0.62,
    tradeExposure: 0.55,
    shockModifier: 1,
    resources: {
      timber: 12, // forest belt
      iron: 8, // stand-in for Obuasi / Tarkwa gold-mining endowment
      oil: 0,
      coal: 1,
      natural_gas: 0,
      rare_earth: 0,
    },
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
  };
}

export function getGhanaMacroCountry(turn = 1, now = new Date()): MacroCountryState {
  const seed = buildGhanaMacroSeed(turn, now);
  return {
    ...seed,
    contribution: seed.contribution!,
    lastMacroTickTurn: turn,
  };
}
