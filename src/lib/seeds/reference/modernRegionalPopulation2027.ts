/**
 * Regional residents in 2027 worlds. Existing regional shares are allocated
 * to the national budget's population total; see modernRegionalPopulation2027.
 * These game anchors do not replace dated census observations.
 */
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";

/**
 * Fiscal population anchors from `getNationalBudgetSeedConfigsForPreset`.
 * They are game budget inputs, not claimed to be official demographic counts.
 * Regional shares remain the documented modern seed shares until each country
 * has a sourced contemporary regional series.
 */
export const MODERN_REGIONAL_POPULATION_ANCHORS_2027 = {
  IE: 5_100_000,
  CN: 1_412_000_000,
  NG: 200_000_000,
  FR: 67_000_000,
  IT: 60_400_000,
  ES: 47_000_000,
  SE: 10_300_000,
  GR: 10_700_000,
  AT: 8_900_000,
  FI: 5_500_000,
} as const;

export type ModernRegionalPopulationCountry = keyof typeof MODERN_REGIONAL_POPULATION_ANCHORS_2027;

/** Keep regional ratios and allocate integer residents to the fiscal anchor. */
export function modernRegionalPopulation2027<T extends { _id: string; population: number }>(
  countryId: ModernRegionalPopulationCountry,
  regions: readonly T[]
): T[] {
  return allocatePopulationTotal(regions, MODERN_REGIONAL_POPULATION_ANCHORS_2027[countryId]);
}
