import type { CountryId } from "@/lib/constants/countries";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";

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
  US: {
    new_immigrants: 0.4, // 1990 Census: Hispanic 9% / Asian 3%
    secular_professionals: 0.6, // Smaller college-educated cohort
    college_liberals: 0.6, // Bachelor's rate 21% vs 38% in 2020
    evangelicals: 1.2, // Peak religiosity in early 1990s
    rural_traditionalists: 1.15, // Higher rural share pre-suburbanization
    union_trades: 1.6, // Union density 16% in 1991 vs 10% in 2020
    young_renters: 0.85, // Less urban concentration
    retirees: 0.85, // 65+ cohort smaller in 1991
    small_business: 1.1, // Pre-corporate-consolidation
  },
  UK: {
    new_britons: 0.3, // Pre-2004 EU expansion immigration wave
    urban_progressives: 0.7, // Pre-NewLabour identity politics
    young_renters: 0.85, // Right-to-Buy era boosted home ownership
    post_industrial_workers: 1.4, // Manufacturing peak pre-deindustrialization
    rural_traditionalists: 1.15,
    retirees: 0.9, // Smaller 65+ cohort in 1991
    populist_right: 0.3, // No UKIP / Reform yet; BNP fringe
    green_activists: 0.4, // Green Party tiny in 1991
    suburban_homeowners: 1.15, // Right-to-Buy expansion
    moderate_centrists: 0.9, // Lib Dems just merged 1988
    public_sector: 1.15, // Pre-Thatcher-cuts hangover
  },
  JP: JP_GEOGRAPHY.populationMultipliers,
  DE: {
    katholische_konservative: 1.1, // Pre-secularisation
    gewerkschafter: 1.4, // 1991 union density ~32% vs ~17% in 2020
    urbane_progressive: 0.7,
    wirtschaftsliberale: 0.85, // Smaller FDP base
    ost_post_industriell: 3.0, // Post-reunification visible; cohort emigrated/retired by 2020
    gruene_mittelschicht: 0.5, // B90/Die Grünen merger just completed 1990
    rentner_west: 0.85, // Smaller retiree cohort in 1991 West
    migranten_communities: 0.5, // Pre-1992 asylum surge
    landwirte_dorf: 1.2, // More agricultural employment
    junge_grossstadt: 0.9,
    protest_waehler_ost: 2.5, // Post-reunification PDS/protest peak
  },
  CN: {
    party_cadre: 1.15, // Peak SOE party-state era
    urban_professional: 0.5, // Pre-private-sector boom
    rural_peasant: 1.6, // 1991 urbanization ~28% vs ~64% in 2020
    industrial_worker: 1.2, // Peak SOE industrial workforce
    migrant_worker: 0.4, // Hukou tightly controlled
    entrepreneur: 0.2, // Private sector tiny pre-1992
    youth: 1.1, // Post-Cultural-Revolution baby-boom echo
  },
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
