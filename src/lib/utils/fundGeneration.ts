/**
 * Fund Generation Utility
 * Calculates campaign fund generation rates based on state population,
 * donor base level, office held, and handles tax calculations for party treasuries
 */

import type { OfficeType } from "@/lib/db/types";
import {
  gdpBaselinePerCapita,
  resolveCampaignGdpBaseline,
} from "@/lib/campaigns/rules/gdpBaseline";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

// Population tier thresholds
const SMALL_POPULATION_MAX = 2_000_000;
const MEDIUM_POPULATION_MAX = 8_000_000;
const LARGE_POPULATION_MAX = 20_000_000;

// Base fund generation rates per hour
export const FUND_GENERATION_RATES = {
  small: 5_000, // <2M population
  medium: 10_000, // 2-8M population
  large: 20_000, // 8-20M population
  mega: 40_000, // >20M population
} as const;

// Donor base level bonus per hour, scaled by population tier.
// Calibrated for a 0–75 level range: the same income ceiling as the old
// 0–5 system (small+$7.5k, mega+$60k at max) spread over 75 levels.
// Each level adds a modest amount; the base rate is a floor.
export const DONOR_BASE_BONUS_PER_LEVEL = {
  small: 100, // +$100/hr per level in small states  (L75 cap: +$7,500/hr)
  medium: 200, // +$200/hr per level in medium states (L75 cap: +$15,000/hr)
  large: 400, // +$400/hr per level in large states  (L75 cap: +$30,000/hr)
  mega: 800, // +$800/hr per level in mega states   (L75 cap: +$60,000/hr)
} as const;

// Flat fund generation bonuses for holding office (per hour).
// Keyed by OfficeType.type string — open Record so UK and future country offices
// can be added without touching the type signature.
export const OFFICE_FUND_BONUS: Record<string, number> = {
  // US offices
  house: 5_000, // +$5k/hr for House members
  senate: 15_000, // +$15k/hr for Senators
  stateSenate: 3_000, // +$3k/hr for State Senators
  governor: 15_000, // +$15k/hr for Governors (same as Senate)
  president: 50_000, // +$50k/hr for President
  vicePresident: 25_000, // +$25k/hr for Vice President
  // UK offices
  commons: 5_000, // +$5k/hr for MPs (Parliament Commons)
  primeMinister: 50_000, // +$50k/hr for Prime Minister
  // DE offices
  bundestag: 5_000,
  chancellor: 50_000,
  ministerPresident: 15_000,
  landtag: 3_000,
  // Cabinet members (parliamentary systems)
  parliamentaryCabinet: 5_000, // +$5k/hr (same as rank-and-file legislator)
  ukCabinet: 5_000, // +$5k/hr for UK cabinet ministers
};

// Maximum tax rate (percentage)
const MAX_TAX_RATE = 33;

export type PopulationTier = "small" | "medium" | "large" | "mega";

/**
 * Get the population tier for a state based on its population
 */
export function getPopulationTier(population: number): PopulationTier {
  if (population < SMALL_POPULATION_MAX) return "small";
  if (population < MEDIUM_POPULATION_MAX) return "medium";
  if (population < LARGE_POPULATION_MAX) return "large";
  return "mega";
}

/**
 * Get the base fund generation rate for a state based on its population
 */
export function getFundGenerationRate(population: number): number {
  const tier = getPopulationTier(population);
  return FUND_GENERATION_RATES[tier];
}

/**
 * Influence-based multiplier for donor income and fundraise yield.
 * Higher state influence (name recognition) means more donor engagement.
 * At 0% influence: 1.0x. At 50%: 1.5x. At 100%: 2.0x.
 */
export function getInfluenceMultiplier(stateInfluence: number): number {
  return 1 + Math.max(0, Math.min(100, stateInfluence)) / 100;
}

/**
 * Get the donor base bonus for a character based on their donor base level and state population
 * Larger states provide more bonus per level due to bigger donor pools.
 * Optionally scaled by state political influence (name recognition → donor engagement).
 */
export function getDonorBaseBonus(
  donorBaseLevel: number,
  population: number,
  stateInfluence?: number
): number {
  if (donorBaseLevel <= 0) return 0;
  const tier = getPopulationTier(population);
  const base = DONOR_BASE_BONUS_PER_LEVEL[tier] * donorBaseLevel;
  const multiplier = stateInfluence !== undefined ? getInfluenceMultiplier(stateInfluence) : 1;
  return Math.round(base * multiplier);
}

/**
 * Get the office holder bonus for fund generation
 * Returns a flat amount based on office type, regardless of state or seats held
 */
export function getOfficeFundBonus(currentOffice: OfficeType | null): number {
  if (!currentOffice) return 0;
  return OFFICE_FUND_BONUS[currentOffice.type] || 0;
}

/**
 * Per-country-era GDP-per-capita baseline for income and cost scaling.
 * Resolved from the single authoritative table in
 * `campaigns/rules/gdpBaseline.ts` (derived from the era's `State.gdp` seed
 * bundle, so units match regional GDP). Each country's regions are evaluated
 * relative to their own national average, so a UK player in an average UK
 * region gets the same scalar as a US player in an average US state.
 *
 * `preset` selects the era (defaults to `DEFAULT_SEED_PRESET`, preserving the
 * modern-era scale for callers with no world to ask). Runtime money paths
 * MUST pass the world's `gameState.preset`.
 *
 * Throws for countries without an explicit baseline row — by design, so an
 * unknown country can never silently inherit a mismatched US denomination.
 */
export function getGdpBaseline(countryId: string, preset?: string): number {
  return gdpBaselinePerCapita(countryId, preset);
}

export { resolveCampaignGdpBaseline };

/**
 * Era price level (#2119) is re-exported here so the income shell — the turn
 * phase that already imports `projectCharacterGeneration` from this module —
 * can resolve the flag-gated scalar from one import:
 * `resolveCampaignPriceLevel(gameConfig.campaignEraPriceLevelEnabled, preset)`.
 */
export { eraPriceLevelFor, resolveCampaignPriceLevel } from "@/lib/campaigns/rules/priceLevel";

/**
 * GDP-per-capita income scalar for fund generation.
 * Range 0.9–1.5: wealthy regions earn more, poorer regions earn slightly less.
 * Uses a per-country-era baseline so each country's regions are scaled relative to
 * their own national average rather than the US average.
 * gdpMillions: state GDP stored in millions (e.g. 289_500 = $289.5B).
 */
export function getIncomeGdpScalar(
  gdpMillions: number,
  population: number,
  countryId = "US",
  preset?: string
): number {
  const baseline = getGdpBaseline(countryId, preset);
  const gdpPerCapita = (gdpMillions * 1_000_000) / population;
  return Math.max(0.9, Math.min(1.5, gdpPerCapita / baseline));
}

/**
 * Get the total fund generation rate for a character (before taxes).
 * Combines base rate + donor base bonus (both GDP-scaled) + flat office bonus.
 * When stateGdpMillions is omitted, defaults to country average (scalar = 1.0).
 *
 * `priceLevel` (#2119) is the between-era deflator resolved at the shell from
 * the world's era; it scales the nominal income legs (base + donor bonus and
 * the flat office bonus) so a 1953 world's income deflates with its costs. It
 * defaults to 1, so an omitted/1 scalar reproduces today's arithmetic exactly.
 */
export function getTotalFundGeneration(
  population: number,
  donorBaseLevel: number,
  currentOffice: OfficeType | null,
  stateGdpMillions?: number,
  countryId = "US",
  stateInfluence?: number,
  preset?: string,
  priceLevel = 1
): number {
  const gdpScalar =
    stateGdpMillions !== undefined
      ? getIncomeGdpScalar(stateGdpMillions, population, countryId, preset)
      : 1.0;
  const baseRate = getFundGenerationRate(population);
  const donorBonus = getDonorBaseBonus(donorBaseLevel, population, stateInfluence);
  const officeBonus = getOfficeFundBonus(currentOffice);
  // Base and donor bonus scale with state wealth; office bonus is flat (tied to
  // the office). Every leg is nominal, so all scale with the era price level.
  return (
    Math.round((baseRate + donorBonus) * gdpScalar * priceLevel) +
    Math.round(officeBonus * priceLevel)
  );
}

/**
 * Calculate tax amount from a base amount
 */
export function calculateTaxAmount(baseAmount: number, taxRate: number): number {
  if (taxRate <= 0 || taxRate > MAX_TAX_RATE) return 0;
  return Math.floor(baseAmount * (taxRate / 100));
}

// ─── Logarithmic Population Scaling (New System) ─────────────────────────────

const LOG_MIN_RATE = 0;
const LOG_SCALE_FACTOR = 9_200;
const LOG_POP_DIVISOR = 330_000;

/**
 * Calculate base fund generation using logarithmic population scaling.
 * Compresses large-state advantage from 8x to ~4.7x.
 */
export function logarithmicPopulationScale(population: number): number {
  if (population <= 0) return LOG_MIN_RATE;
  return Math.round(LOG_MIN_RATE + LOG_SCALE_FACTOR * Math.log10(population / LOG_POP_DIVISOR + 1));
}

/**
 * Calculate donor base bonus with logarithmic population scaling.
 * Each level adds ~20% of base rate; level 5 doubles income.
 */
export function getDonorBaseBonusLogarithmic(donorBaseLevel: number, population: number): number {
  if (donorBaseLevel <= 0) return 0;
  const baseRate = logarithmicPopulationScale(population);
  const bonusPerLevel = baseRate * 0.2;
  return Math.round(bonusPerLevel * donorBaseLevel);
}

/**
 * Calculate fund distribution for a character
 * Returns the amounts for character, state party treasury, and national party treasury
 */
export interface FundDistribution {
  baseGeneration: number;
  donorBaseBonus: number;
  officeBonus: number;
  totalGeneration: number;
  stateTaxAmount: number;
  nationalTaxAmount: number;
  characterReceives: number;
}

/**
 * Full fund distribution calculation including donor base and office bonuses.
 * Base rate and donor bonus are scaled by state GDP per capita using a per-country
 * baseline; office bonus is flat. When stateGdpMillions is omitted, defaults to
 * country average (scalar = 1.0).
 *
 * `priceLevel` (#2119): the between-era deflator resolved at the shell. Scaling
 * every nominal income leg by the same scalar keeps the tax split proportional
 * and preserves within-era regional variance (a uniform factor). Defaults to 1,
 * so an omitted/1 scalar is byte-identical to today.
 */
export function calculateFullFundDistribution(
  statePopulation: number,
  donorBaseLevel: number,
  currentOffice: OfficeType | null,
  stateTaxRate: number,
  nationalTaxRate: number,
  stateGdpMillions?: number,
  countryId = "US",
  stateInfluence?: number,
  preset?: string,
  priceLevel = 1
): FundDistribution {
  const gdpScalar =
    stateGdpMillions !== undefined
      ? getIncomeGdpScalar(stateGdpMillions, statePopulation, countryId, preset)
      : 1.0;
  const baseGeneration = Math.round(
    getFundGenerationRate(statePopulation) * gdpScalar * priceLevel
  );
  const donorBaseBonus = Math.round(
    getDonorBaseBonus(donorBaseLevel, statePopulation, stateInfluence) * gdpScalar * priceLevel
  );
  const officeBonus = Math.round(getOfficeFundBonus(currentOffice) * priceLevel);
  const totalGeneration = baseGeneration + donorBaseBonus + officeBonus;

  // Taxes are applied to total generation
  const stateTaxAmount = calculateTaxAmount(totalGeneration, stateTaxRate);
  const nationalTaxAmount = calculateTaxAmount(totalGeneration, nationalTaxRate);
  const characterReceives = totalGeneration - stateTaxAmount - nationalTaxAmount;

  return {
    baseGeneration,
    donorBaseBonus,
    officeBonus,
    totalGeneration,
    stateTaxAmount,
    nationalTaxAmount,
    characterReceives,
  };
}

// ─── NPP Diminishing Returns ────────────────────────────────────────────────

const DIMINISHING_THRESHOLDS = [
  { max: 50_000, multiplier: 1.0 },
  { max: 150_000, multiplier: 0.75 },
  { max: 300_000, multiplier: 0.5 },
  { max: Infinity, multiplier: 0.25 },
] as const;

/**
 * Calculate diminishing returns multiplier based on current funds.
 * Used for NPP fund generation soft cap.
 */
export function diminishingReturnsMultiplier(currentFunds: number): number {
  for (const tier of DIMINISHING_THRESHOLDS) {
    if (currentFunds <= tier.max) return tier.multiplier;
  }
  return 0.25;
}

// ─── NPP Fund Generation ────────────────────────────────────────────────────

/** NPP generation rate multiplier (50% of player rate) */
const NPP_RATE_MULTIPLIER = 0.5;

/**
 * Calculate NPP fund generation for a turn.
 * - 50% of player rate
 * - No office bonuses
 * - Diminishing returns based on current funds
 */
export function calculateNppFundGeneration(
  population: number,
  donorBaseLevel: number,
  currentFunds: number
): number {
  const baseRate = logarithmicPopulationScale(population);
  const donorBonus = getDonorBaseBonusLogarithmic(donorBaseLevel, population);
  const grossRate = (baseRate + donorBonus) * NPP_RATE_MULTIPLIER;
  const multiplier = diminishingReturnsMultiplier(currentFunds);
  return Math.round(grossRate * multiplier);
}

// ─── Projection Helpers (single source of truth for display surfaces) ────────

/**
 * Project a character's gross per-turn fund generation (before tax), identical
 * to what processFundGeneration / caucusTax actually deposit. Display and GOTV
 * surfaces MUST call this rather than getTotalFundGeneration directly, so they
 * can never silently drop the GDP scalar or influence multiplier again.
 *
 * Pass stateGdpMillions straight through (do NOT coalesce a missing value to 0):
 * undefined yields the country-average scalar (1.0), matching the turn
 * processor, whereas an explicit 0 would clamp to the 0.9 floor.
 */
export function projectCharacterGeneration(args: {
  population: number;
  donorBaseLevel: number;
  currentOffice: OfficeType | null;
  stateGdpMillions?: number;
  countryId?: string;
  politicalInfluence?: number;
  /** World reset preset selecting the baseline era; defaults to modern. */
  preset?: string;
  /**
   * Resolved era price level (#2119) from the shell; undefined/1 = modern and
   * byte-identical to today. The turn phase passes
   * `resolveCampaignPriceLevel(gameConfig.campaignEraPriceLevelEnabled, preset)`.
   */
  priceLevel?: number;
}): number {
  return getTotalFundGeneration(
    args.population,
    args.donorBaseLevel,
    args.currentOffice,
    args.stateGdpMillions,
    args.countryId ?? "US",
    args.politicalInfluence ?? 0,
    args.preset ?? DEFAULT_SEED_PRESET,
    args.priceLevel ?? 1
  );
}

/**
 * Project an NPP's gross per-turn fund generation, identical to what
 * processNppFundGeneration deposits: log-scale x 50% x diminishing-returns.
 * NPP funds are stored in local currency in every country and the generation
 * formula operates entirely in local terms — there is no anchor/FX conversion.
 * NPPs receive no office bonus, which is why this must NOT route through
 * getTotalFundGeneration.
 *
 * `nppEconomyEnabled` mirrors the gate in processNppFundGeneration, which
 * early-returns (NPPs deposit $0) when the economy is disabled. Projection
 * surfaces MUST pass the live flag so displayed/GOTV revenue never counts NPP
 * income the treasury will not actually receive.
 */
export function projectNppGeneration(args: {
  population: number;
  donorBaseLevel: number;
  currentFundsLocal: number;
  nppEconomyEnabled: boolean;
}): number {
  if (!args.nppEconomyEnabled) return 0;
  return calculateNppFundGeneration(args.population, args.donorBaseLevel, args.currentFundsLocal);
}
