import type { CorporationType } from "@/lib/constants/corporations";
import type { MacroCountryState } from "./types";
import { buildMacroCountryFromSpec, type MacroCountrySeedSpec } from "./seedBuilder";

export const AUSTRIA_ENTITY_ID = "AT";

/**
 * 1953 Austria as a sphere-macro vertical slice — REFERENCE ORACLE for Tier-2.
 *
 * Era notes (strong defaults, not rails):
 * - Still under four-power occupation until the 1955 State Treaty; modelled as
 *   a sovereign macro actor with moderate Western lean and limited market exposure.
 * - Population ~6.95M (1951 census ~6.93M).
 * - GDP scaled to game units (~12% of West Germany's authored 1953 regional sum).
 * - Sector mix: VOEST steel / alpine hydro / Erzberg iron / Matzen oil / timber.
 */
const AUSTRIA_1953_SECTOR_WEIGHTS: Partial<Record<CorporationType, number>> = {
  manufacturing: 26,
  agriculture: 14,
  energy: 8,
  construction: 8,
  extraction: 6,
  chemical_industries: 5,
  logistics: 5,
  retail: 5,
  automobiles: 3,
  financial: 3,
  real_estate: 3,
  healthcare: 2,
  defense: 2,
  telecommunications: 2,
  media: 2,
  entertainment: 2,
  technology: 0,
};

export const AUSTRIA_1953_SPEC: MacroCountrySeedSpec = {
  entityId: AUSTRIA_ENTITY_ID,
  displayName: "Austria",
  economicSystem: "market",
  population: 6_950_000,
  annualGdpGameUnits: 7_500,
  fiscalCapacity: 0.22,
  stability: 0.72,
  // Occupation-era controls keep trade exposure moderate until neutrality settles.
  tradeExposure: 0.35,
  sectorWeights: AUSTRIA_1953_SECTOR_WEIGHTS,
  resources: {
    iron: 18, // Erzberg
    timber: 14, // alpine forestry
    oil: 6, // Matzen field (modest)
    coal: 3,
    natural_gas: 2,
    rare_earth: 0,
  },
};

export function buildAustria1953Seed(now = new Date()): MacroCountryState {
  return buildMacroCountryFromSpec(AUSTRIA_1953_SPEC, now, { markInitialTick: false });
}

export function getAustria1953MacroCountry(now = new Date()): MacroCountryState {
  return buildMacroCountryFromSpec(AUSTRIA_1953_SPEC, now, { markInitialTick: true });
}
