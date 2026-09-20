/**
 * Assembles per-preset expected values from existing authored seed sources.
 * Do NOT duplicate numbers into new tables — read the seed modules.
 */

import type { CountryId } from "@/lib/constants/countries";
import { COUNTRY_CONFIGS, DEFAULT_LEGACY_COUNTRY_ID } from "@/lib/constants/countries";
import { FOREX_ACTIVE_COUNTRIES, getInitialRates } from "@/lib/constants/currencies";
import { getStartingYearForPreset, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
// Re-exported so existing consumers keep their import path; the definition moved
// to break the readiness/seed import cycle. See regionBundles.ts.
import { expectedRegionCount } from "./regionBundles";
export { expectedRegionCount };
import { COUNTRY_READINESS_EXPECTATIONS } from "@/lib/constants/countryReadinessExpectations";
import { getBranches } from "@/lib/constants/military";
import { ESTATE_PORTFOLIO_BY_COUNTRY } from "@/lib/constants/cabinetEstates";
import { ENERGY_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetEnergy";
import { INFRA_POSITION_BY_COUNTRY } from "@/lib/constants/cabinetInfra";
import {
  eraForPreset,
  isKnownPreset,
  selectPresetBundleOptional,
  type EraId,
  type ResetPresetId,
} from "@/lib/seeds/presetSelector";
import { getNationalBudgetSeedConfigsForPreset } from "@/lib/seeds/reference/budgets";
import { countriesByTier, SHIPPING_PRESETS } from "@/lib/world/eraRoster";
import {
  getPresetEnablementCountries,
  getPresetEnablementTier,
} from "@/lib/admin/seed/seedCountryGameStates";
import { ERA_COMPOSITIONS, getEraComposition } from "@/lib/seeds/demographicCategories";
import { getStateSectorWeights } from "@/lib/seeds/reference/sectorSeedWeights";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import {
  getPresetMonetaryScope,
  type MonetaryCoverageExclusion,
} from "@/lib/monetaryPolicy/presetMonetaryScope";
import { states } from "@/lib/seeds/reference/states";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { states1979 } from "@/lib/seeds/reference/states1979";
import { states1991 } from "@/lib/seeds/reference/states1991";
import { states1999 } from "@/lib/seeds/reference/states1999";
import { states2007 } from "@/lib/seeds/reference/states2007";
import { states2023 } from "@/lib/seeds/reference/states2023";
import { stateMetrics } from "@/lib/seeds/reference/stateMetrics";
import { stateMetrics1953 } from "@/lib/seeds/reference/stateMetrics1953";
import { stateMetrics1979 } from "@/lib/seeds/reference/stateMetrics1979";
import { stateMetrics1991 } from "@/lib/seeds/reference/stateMetrics1991";
import { stateMetrics1999 } from "@/lib/seeds/reference/stateMetrics1999";
import { stateMetrics2007 } from "@/lib/seeds/reference/stateMetrics2007";
import { stateMetrics2023 } from "@/lib/seeds/reference/stateMetrics2023";
import { stateMetrics2027 } from "@/lib/seeds/reference/stateMetrics2027";
import { stateCensusData } from "@/lib/seeds/stateDemographics";
import { stateCensusData1953 } from "@/lib/seeds/stateCensusData1953";
import { stateCensusData1979 } from "@/lib/seeds/stateCensusData1979";
import { stateCensusData1991 } from "@/lib/seeds/stateCensusData1991";
import { stateCensusData1999 } from "@/lib/seeds/stateCensusData1999";
import { stateCensusData2007 } from "@/lib/seeds/stateCensusData2007";
import { stateCensusData2023 } from "@/lib/seeds/stateCensusData2023";
import { stateCensusData2027 } from "@/lib/seeds/stateCensusData2027";
import { states2027 } from "@/lib/seeds/reference/states2027";

// Per-country region seed bundles (same maps the country seeders use).

export { TURNS_PER_YEAR };

/**
 * Countries the world seeds but never registers: they appear in budget seed
 * tables and on the map, yet are absent from `COUNTRY_ORDER`, so nothing may
 * iterate them as countries.
 *
 * Derived from the era roster's `latent` tier rather than hand-listed. The hand
 * list held BLR and BAL and omitted UKR, which is the same country-set drift the
 * roster exists to end — inert here only because none of the three is in
 * `COUNTRY_ORDER`, so the shipping path cannot reach them either way.
 */
const LATENT_COUNTRY_IDS: ReadonlySet<string> = new Set(
  SHIPPING_PRESETS.flatMap((preset) => countriesByTier(preset, "latent"))
);

/**
 * Countries the active preset actually seeds as countries.
 * Always includes US. Excludes latent SSR republics (BLR/BAL).
 */
export function seededCountryIdsForPreset(preset: string): CountryId[] {
  const enabled = getPresetEnablementCountries(preset);
  const ids = new Set<CountryId>([DEFAULT_LEGACY_COUNTRY_ID]);
  if (enabled) {
    for (const id of enabled) {
      if (!LATENT_COUNTRY_IDS.has(id)) ids.add(id);
    }
    return [...ids];
  }
  // No enablement map (2019 / empty aliases): budget countries + readiness set.
  for (const c of getNationalBudgetSeedConfigsForPreset(preset)) {
    if (!LATENT_COUNTRY_IDS.has(c.countryId)) ids.add(c.countryId as CountryId);
  }
  for (const id of Object.keys(COUNTRY_READINESS_EXPECTATIONS) as CountryId[]) {
    if (!LATENT_COUNTRY_IDS.has(id)) ids.add(id);
  }
  return [...ids];
}

/**
 * Countries that get political / readiness / region-structure checks.
 * Restricted to seeded countries that have readiness expectations AND are not
 * coming-soon NPP-only tiers (those lack parties/officials by design).
 */
export function readinessCountryIds(preset: string): CountryId[] {
  const seeded = new Set(seededCountryIdsForPreset(preset));
  const out: CountryId[] = [];
  for (const id of Object.keys(COUNTRY_READINESS_EXPECTATIONS) as CountryId[]) {
    if (!seeded.has(id)) continue;
    const tier = getPresetEnablementTier(preset, id);
    // No enablement map → treat as playable (modern presets).
    // NPP / coming-soon tiers skip readiness (pre-politics / colony).
    if (tier && tier.status === "coming-soon") continue;
    out.push(id);
  }
  // US runs off global GameState (never in enablement maps) but is always playable.
  if (
    seeded.has(DEFAULT_LEGACY_COUNTRY_ID) &&
    COUNTRY_READINESS_EXPECTATIONS[DEFAULT_LEGACY_COUNTRY_ID] &&
    !out.includes(DEFAULT_LEGACY_COUNTRY_ID)
  ) {
    out.unshift(DEFAULT_LEGACY_COUNTRY_ID);
  }
  return out;
}

export interface NationalBudgetExpectation {
  countryId: string;
  budgetId: string;
  gdp: number;
  population: number;
  debtPrincipal: number;
  debtInterestRate: number;
  gdpGrowth: number;
  wageGrowth: number;
  inflationRate: number;
}

export interface SeedExpectations {
  preset: string;
  era: EraId;
  startingYear: number;
  knownPreset: boolean;
  nationalBudgets: NationalBudgetExpectation[];
  /** Country ids that should have federalBudget / sector rows for this preset. */
  seededCountryIds: CountryId[];
  forexRates: Partial<Record<CountryId, number>>;
  forexActiveCountries: readonly CountryId[];
  /** Effective central-bank coverage and explicit currency-only exclusions. */
  monetaryCoverage: {
    centralBankCountries: CountryId[];
    exclusions: MonetaryCoverageExclusion[];
  };
  /** Domains where selectPresetBundle would silently fall back to 2019. */
  bundleFallbacks: Array<{ domain: string; note: string }>;
  /** True when ERA_COMPOSITIONS has an explicit entry for this era. */
  eraCompositionOk: boolean;
}

const STATES_BUNDLES = {
  "1953-default": states1953,
  "1979-default": states1979,
  "1991-default": states1991,
  "1999-default": states1999,
  "2007-default": states2007,
  "2019-default": states,
  "2023-default": states2023,
  "2027-default": states2027,
} as const;

const STATE_METRICS_BUNDLES = {
  "1953-default": stateMetrics1953,
  "1979-default": stateMetrics1979,
  "1991-default": stateMetrics1991,
  "1999-default": stateMetrics1999,
  "2007-default": stateMetrics2007,
  "2019-default": stateMetrics,
  "2023-default": stateMetrics2023,
  "2027-default": stateMetrics2027,
} as const;

const CENSUS_BUNDLES = {
  "1953-default": stateCensusData1953,
  "1979-default": stateCensusData1979,
  "1991-default": stateCensusData1991,
  "1999-default": stateCensusData1999,
  "2007-default": stateCensusData2007,
  "2019-default": stateCensusData,
  "2023-default": stateCensusData2023,
  "2027-default": stateCensusData2027,
} as const;

/**
 * True when the preset would resolve via the silent 2019-default fallback
 * rather than an explicit authored bundle. Intentional aliases (empty,
 * 2019-no-parties) are not treated as fallbacks.
 */
export function wouldSilentlyFallback(
  preset: string,
  bundles: Partial<Record<ResetPresetId, unknown>>
): boolean {
  if (preset === "empty" || preset === "2019-no-parties") return false;
  const explicit = bundles[preset as ResetPresetId];
  if (explicit != null) return false;
  return bundles["2019-default"] != null;
}

function collectBundleFallbacks(preset: string): Array<{ domain: string; note: string }> {
  const domains: Array<{ domain: string; bundles: Partial<Record<ResetPresetId, unknown>> }> = [
    { domain: "states", bundles: STATES_BUNDLES },
    { domain: "stateMetrics", bundles: STATE_METRICS_BUNDLES },
    { domain: "census", bundles: CENSUS_BUNDLES },
  ];
  const out: Array<{ domain: string; note: string }> = [];
  for (const { domain, bundles } of domains) {
    if (wouldSilentlyFallback(preset, bundles)) {
      out.push({
        domain,
        note: `selectPresetBundle would fall back to 2019-default for "${preset}"`,
      });
    }
    void selectPresetBundleOptional(preset, bundles);
  }
  return out;
}

/**
 * Expected prime rate for conformance (turn 1): the value the forex seeder
 * actually writes (`COUNTRY_CONFIGS.centralBank.defaultPrimeRate`). Era monetary
 * baselines are runtime steering targets, not seed-time truth.
 */
export function expectedPrimeRate(countryId: CountryId, _startingYear?: number): number {
  return COUNTRY_CONFIGS[countryId]?.centralBank.defaultPrimeRate ?? 0;
}

/** Country-level normalised sector weight shares for the preset. */
export function expectedSectorShares(countryId: CountryId, preset: string): Record<string, number> {
  const weights = getStateSectorWeights("_national_", countryId, preset);
  const out: Record<string, number> = {};
  for (const t of CORPORATION_TYPES) {
    out[t] = weights[t] ?? 0;
  }
  return out;
}

/**
 * Which countries each region-derived collection is SUPPOSED to cover.
 *
 * Resolved through the very config each seeder gates on — the same technique
 * `expectedRegionCount` uses — so the expectation cannot drift from the seeder
 * and cannot be era-blind. A hard-coded roster here would re-create the DE
 * RegionMetrics false positive (an expectation authored for one era, applied to
 * all of them).
 *
 * This exists because these six collections had NO diagnostic coverage at all,
 * and they are exactly the ones the two largest seed defects on record broke:
 * the region-derived seeders ran while only US states existed, leaving
 * `militaryUnits` at 13 documents across 1 country in a 226-region, 24-country
 * world, and the diagnostic reported a clean bill. Coverage — the country SET,
 * not the row count — is what makes that visible: 13/1 against an expected 20
 * is unmistakable, whereas "some rows exist" is not.
 */
export function expectedRegionDerivedCoverage(
  preset: string,
  seededCountryIds: readonly CountryId[]
): { collection: string; countries: CountryId[]; note: string }[] {
  const startingYear = getStartingYearForPreset(preset);
  const seeded = new Set(seededCountryIds);
  const within = (ids: CountryId[]) => ids.filter((c) => seeded.has(c));

  return [
    {
      collection: "militaryUnits",
      // Era-gated: AT/DD/DE/NG have no era-active branches on some presets, and
      // a country with none is correctly absent rather than missing.
      countries: within(
        (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
          (c) => getBranches(c, startingYear).length > 0
        )
      ),
      note: "countries with era-active military branches",
    },
    {
      collection: "cabinetEstates",
      countries: within(
        (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
          (c) => ESTATE_PORTFOLIO_BY_COUNTRY[c] !== undefined
        )
      ),
      note: "countries with an authored estate portfolio",
    },
    {
      collection: "energyPlants",
      countries: within(
        (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
          (c) => ENERGY_POSITION_BY_COUNTRY[c] !== undefined
        )
      ),
      note: "countries with an energy cabinet position",
    },
    {
      collection: "infraProjects",
      countries: within(
        (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
          (c) => INFRA_POSITION_BY_COUNTRY[c] !== undefined
        )
      ),
      note: "countries with an infrastructure cabinet position",
    },
    {
      // Gated on population > 0, i.e. every country whose regions exist.
      collection: "nationalManpower",
      countries: [...seededCountryIds],
      note: "every seeded country (gated on regional population)",
    },
  ];
}

export function buildSeedExpectations(preset: string): SeedExpectations {
  const era = eraForPreset(preset);
  const startingYear = getStartingYearForPreset(preset);
  const seededCountryIds = seededCountryIdsForPreset(preset);
  const seededSet = new Set<string>(seededCountryIds);
  const configs = getNationalBudgetSeedConfigsForPreset(preset).filter((c) =>
    seededSet.has(c.countryId)
  );
  const monetaryScope = getPresetMonetaryScope(preset);

  let eraCompositionOk = false;
  try {
    getEraComposition(era);
    eraCompositionOk = era in ERA_COMPOSITIONS;
  } catch {
    eraCompositionOk = false;
  }

  return {
    preset,
    era,
    startingYear,
    knownPreset: isKnownPreset(preset),
    nationalBudgets: configs.map((c) => ({
      countryId: c.countryId,
      budgetId: c.budgetId,
      gdp: c.gdp,
      population: c.population,
      debtPrincipal: c.debt.principal,
      debtInterestRate: c.debt.interestRate,
      gdpGrowth: c.economicFactors.gdpGrowth,
      wageGrowth: c.economicFactors.wageGrowth,
      inflationRate: c.economicFactors.inflationRate,
    })),
    seededCountryIds,
    forexRates: getInitialRates(preset),
    forexActiveCountries: FOREX_ACTIVE_COUNTRIES,
    monetaryCoverage: {
      centralBankCountries: monetaryScope.centralBankCountries,
      exclusions: monetaryScope.exclusions,
    },
    bundleFallbacks: collectBundleFallbacks(preset),
    eraCompositionOk,
  };
}

export { getStartingYearForPreset, eraForPreset, isKnownPreset, FOREX_ACTIVE_COUNTRIES };
