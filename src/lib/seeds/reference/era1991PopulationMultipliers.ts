import type { CountryId } from "@/lib/constants/countries";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_POPULATION_MULTIPLIERS } from "@/lib/countries/us/geographyFacts";
import { UK_POPULATION_MULTIPLIERS } from "@/lib/countries/uk/geographyFacts";
import { DE_POPULATION_MULTIPLIERS } from "@/lib/countries/de/geographyFacts";
import { CN_POPULATION_MULTIPLIERS } from "@/lib/countries/cn/geographyFacts";

/**
 * 1991-era cohort multipliers, per country.
 *
 * ⚠ THIS LIVES IN ITS OWN MODULE TO BREAK A TYPE CYCLE, NOT FOR TIDINESS.
 * It was declared inside `stateDemographics1991.ts`, which VALUE-imports
 * `JP_GEOGRAPHY`. Six seed files reach that module through
 * `await import(...)`, and a dynamic import makes TypeScript resolve the whole
 * public type surface of the target. Exporting this constant added
 * `Partial<Record<CountryId, ...>>` to that surface, TypeScript hit the cycle
 * back through `jp/geography` and gave up -- so
 * `applyEra1991DemographicAdjustments` started returning `unknown` and
 * seedBR, seedCN, seedDE and seedIE failed to compile, none of which had been
 * touched.
 *
 * A one-word change to an unrelated file broke four others. Keeping the value
 * somewhere with nothing behind it but a type import is what stops that.
 *
 * ⚠ SIX COUNTRIES, SO IT STAYS SHARED. US, UK, DE, CN, IE and BR each have
 * an entry; a country missing from the map passes through unchanged at 1.0.
 * This is not one country's data and does not belong in a country folder.
 */
export const POPULATION_MULTIPLIERS: Partial<Record<CountryId, Record<string, number>>> = {
  US: US_POPULATION_MULTIPLIERS,
  UK: UK_POPULATION_MULTIPLIERS,
  JP: JP_GEOGRAPHY.populationMultipliers,
  DE: DE_POPULATION_MULTIPLIERS,
  CN: CN_POPULATION_MULTIPLIERS,
  IE: {
    urban_professional: 0.4, // Pre-MNC FDI tech boom
    rural_traditional: 1.4, // Pre-Celtic-Tiger urban migration
    working_class: 1.2, // Industrial decline not yet hit
    new_irish: 0.1, // 1991 immigration negligible — Ireland still emigrating
    small_business: 0.9,
    retirees: 0.85,
    young_urban: 0.7, // Emigration of young people peaked 1989-93
    border_communities: 1.1, // Troubles peak
  },
  BR: {
    evangelical_conservative: 0.5, // 1991 Pentecostal share ~13% vs ~30% in 2020
    working_class_pt: 1.15, // PT young + growing in 1991
    rural_agribusiness: 1.2, // Pre-agro-modernization frontier
    urban_middle_class: 0.8, // Hyperinflation-crushed
    urban_poor: 1.15, // Plano-Collor-II era peak
    afro_brazilian: 1.0,
    business_financial: 0.7, // Pre-Plano-Real
    young_progressive: 0.85,
  },
};
