import type { CountryId } from "@/lib/constants/countries";
import { getVoterArchetypeCategoriesForCountry } from "./countryDemographics";

/**
 * Census-category → voter-archetype derived turnout.
 *
 * Archetype countries (UK/JP/DE/IE/CN/BR) store turnout per voter archetype
 * (`<cc>_voterGroups`), but the region census tab displays real-world census
 * buckets (age/education/income/urbanization/ethnicity). To show a turnout
 * estimate per census bucket we average the turnout of the archetypes that
 * predominantly fall in that bucket.
 *
 * The US deliberately has NO entry here: US census dimensions
 * (race/age/education/wealth/ideology) ARE its turnout buckets, so the tab reads
 * turnout directly — no derivation, no duplication. `calculateDerivedTurnout`
 * returning undefined for the US is correct.
 *
 * Each country needs its own map because both halves are country-specific: the
 * census keys differ (JP `high_school` vs UK `no_qualifications`) and the
 * archetype ids differ (`salaryman_conservative` vs `post_industrial_workers`).
 * Assignments are approximations grounded in each archetype's seed definition,
 * mirroring the UK map that already shipped.
 *
 * Ethnicity scope: mapped only where a country has an explicit migrant/ethnic
 * archetype (UK, DE `migranten_communities`, IE `new_irish`). Omitted for
 * JP/CN/BR — mapping census ethnicity onto socioeconomic archetypes there would
 * be fabricated (e.g. CN has no ethnic archetypes at all). Those ethnicity cards
 * simply show no derived-turnout estimate, same as before this helper existed.
 */
export interface TurnoutEntry {
  baseline: number;
  modifier: number;
  actual: number;
}

// Bucket values may be undefined (a country only populates its own
// `<cc>_voterGroups` bucket); calculateDerivedTurnout guards for that.
type TurnoutByGroup = Record<string, Record<string, TurnoutEntry> | undefined>;

// Shared by the UK and the seceded nations (SCO/WAL), which use the same
// `uk_voterGroups` archetype scheme and UK census categories.
const UK_CENSUS_TO_ARCHETYPE: Record<string, string[]> = {
  // age
  young: ["young_renters", "urban_progressives", "green_activists"],
  mid: ["post_industrial_workers", "public_sector", "new_britons", "moderate_centrists"],
  mature: ["suburban_homeowners", "small_business"],
  senior: ["retirees", "rural_traditionalists", "populist_right"],
  // education
  no_qualifications: ["post_industrial_workers", "rural_traditionalists", "populist_right"],
  gcse_equivalent: ["young_renters", "public_sector"],
  a_level_equivalent: ["suburban_homeowners", "moderate_centrists", "small_business"],
  degree_plus: ["urban_progressives", "green_activists", "new_britons"],
  // income
  low: ["young_renters", "post_industrial_workers", "green_activists"],
  middle: ["public_sector", "moderate_centrists", "urban_progressives", "new_britons"],
  high: ["suburban_homeowners", "small_business", "retirees"],
  // urbanization
  urban: ["urban_progressives", "young_renters", "new_britons", "public_sector"],
  suburban: ["suburban_homeowners", "moderate_centrists", "small_business"],
  rural: ["rural_traditionalists", "retirees", "populist_right"],
  // ethnicity
  white_british: [
    "post_industrial_workers",
    "rural_traditionalists",
    "retirees",
    "suburban_homeowners",
    "moderate_centrists",
    "populist_right",
    "green_activists",
  ],
  asian_british: ["new_britons", "urban_progressives"],
  black_british: ["new_britons", "urban_progressives"],
  mixed: ["young_renters", "urban_progressives"],
  other: ["new_britons"],
};

export const CENSUS_TO_ARCHETYPE: Partial<Record<CountryId, Record<string, string[]>>> = {
  UK: UK_CENSUS_TO_ARCHETYPE,
  SCO: UK_CENSUS_TO_ARCHETYPE,
  WAL: UK_CENSUS_TO_ARCHETYPE,
  JP: {
    // age
    young: ["young_urban", "urban_progressive", "working_mothers"],
    mid: ["salaryman_conservative", "public_sector", "working_mothers", "small_business"],
    mature: ["salaryman_conservative", "small_business", "rural_traditionalist"],
    senior: ["retiree", "rural_traditionalist", "komeito_faithful"],
    // education
    high_school: ["rural_traditionalist", "small_business", "reform_populist"],
    vocational: ["small_business", "public_sector", "working_mothers"],
    university: ["salaryman_conservative", "urban_progressive", "public_sector"],
    graduate: ["urban_progressive", "salaryman_conservative"],
    // income
    low: ["young_urban", "working_mothers", "reform_populist"],
    middle: ["salaryman_conservative", "public_sector", "komeito_faithful", "small_business"],
    high: ["salaryman_conservative", "urban_progressive", "small_business"],
    // urbanization
    urban: [
      "urban_progressive",
      "young_urban",
      "salaryman_conservative",
      "komeito_faithful",
      "public_sector",
    ],
    suburban: ["salaryman_conservative", "working_mothers", "small_business"],
    rural: ["rural_traditionalist", "retiree"],
    // ethnicity omitted (Japan ~homogeneous; archetypes are not ethnic)
  },
  DE: {
    // age
    young: ["junge_grossstadt", "urbane_progressive"],
    mid: ["gewerkschafter", "wirtschaftsliberale", "gruene_mittelschicht", "migranten_communities"],
    mature: ["katholische_konservative", "landwirte_dorf", "mittelstand_selbstaendige"],
    senior: ["rentner_west", "ost_post_industriell", "protest_waehler_ost"],
    // education
    no_degree: ["ost_post_industriell", "gewerkschafter", "protest_waehler_ost"],
    berufsausbildung: [
      "gewerkschafter",
      "landwirte_dorf",
      "mittelstand_selbstaendige",
      "migranten_communities",
    ],
    abitur: ["katholische_konservative", "wirtschaftsliberale", "rentner_west"],
    hochschulabschluss: [
      "urbane_progressive",
      "gruene_mittelschicht",
      "wirtschaftsliberale",
      "junge_grossstadt",
    ],
    // income
    low: ["ost_post_industriell", "migranten_communities", "junge_grossstadt"],
    middle: ["gewerkschafter", "gruene_mittelschicht", "katholische_konservative", "rentner_west"],
    high: ["wirtschaftsliberale", "mittelstand_selbstaendige"],
    // urbanization
    urban: [
      "urbane_progressive",
      "junge_grossstadt",
      "migranten_communities",
      "gruene_mittelschicht",
    ],
    suburban: [
      "katholische_konservative",
      "wirtschaftsliberale",
      "mittelstand_selbstaendige",
      "rentner_west",
    ],
    rural: ["landwirte_dorf", "ost_post_industriell", "protest_waehler_ost"],
    // ethnicity (DE has a single explicit migrant archetype)
    german: [
      "katholische_konservative",
      "gewerkschafter",
      "urbane_progressive",
      "wirtschaftsliberale",
      "ost_post_industriell",
      "gruene_mittelschicht",
      "rentner_west",
      "landwirte_dorf",
      "junge_grossstadt",
      "protest_waehler_ost",
      "mittelstand_selbstaendige",
    ],
    turkish_russian_diaspora: ["migranten_communities"],
    mena: ["migranten_communities"],
    eu_southern_eastern: ["migranten_communities"],
    other: ["migranten_communities"],
  },
  IE: {
    // age
    young: ["young_urban", "new_irish"],
    mid: ["urban_professional", "working_class", "small_business", "new_irish"],
    mature: ["rural_traditional", "small_business", "border_communities"],
    senior: ["retirees", "rural_traditional"],
    // education
    primary_or_less: ["rural_traditional", "retirees", "working_class"],
    leaving_cert: ["working_class", "small_business", "border_communities"],
    post_secondary: ["small_business", "young_urban", "new_irish"],
    third_level: ["urban_professional", "young_urban", "new_irish"],
    // income
    low: ["working_class", "new_irish", "young_urban"],
    middle: ["rural_traditional", "retirees", "small_business", "border_communities"],
    high: ["urban_professional", "small_business"],
    // urbanization
    urban: ["urban_professional", "young_urban", "new_irish"],
    suburban: ["small_business", "working_class", "retirees"],
    rural: ["rural_traditional", "border_communities"],
    // ethnicity (IE has an explicit migrant archetype)
    irish: [
      "urban_professional",
      "rural_traditional",
      "working_class",
      "small_business",
      "retirees",
      "young_urban",
      "border_communities",
    ],
    uk_british: ["rural_traditional", "border_communities"],
    eu_other: ["new_irish"],
    rest_of_world: ["new_irish"],
  },
  CN: {
    // age
    young: ["youth", "migrant_worker"],
    mid: ["urban_professional", "industrial_worker", "entrepreneur", "migrant_worker"],
    mature: ["party_cadre", "rural_peasant", "industrial_worker", "entrepreneur"],
    senior: ["rural_peasant", "party_cadre"],
    // education
    primary_or_below: ["rural_peasant", "migrant_worker"],
    secondary: ["industrial_worker", "migrant_worker", "youth"],
    vocational: ["industrial_worker", "entrepreneur"],
    university: ["urban_professional", "party_cadre", "entrepreneur", "youth"],
    // income
    low: ["rural_peasant", "migrant_worker", "industrial_worker"],
    middle: ["industrial_worker", "youth", "party_cadre"],
    high: ["urban_professional", "entrepreneur", "party_cadre"],
    // urbanization
    urban: ["urban_professional", "entrepreneur", "party_cadre", "migrant_worker", "youth"],
    suburban: ["industrial_worker", "party_cadre"],
    rural: ["rural_peasant"],
    // ethnicity omitted (no ethnic archetypes; mapping would be fabricated)
  },
  BR: {
    // age
    young: ["young_progressive", "urban_poor"],
    mid: ["working_class_pt", "urban_middle_class", "business_financial", "afro_brazilian"],
    mature: ["evangelical_conservative", "rural_agribusiness", "urban_middle_class"],
    senior: ["evangelical_conservative", "rural_agribusiness"],
    // education
    fundamental: ["urban_poor", "rural_agribusiness", "working_class_pt"],
    medio: ["working_class_pt", "evangelical_conservative", "urban_middle_class"],
    superior: ["urban_middle_class", "business_financial", "young_progressive"],
    // income
    low: ["urban_poor", "working_class_pt", "afro_brazilian"],
    middle: ["working_class_pt", "urban_middle_class", "evangelical_conservative"],
    high: ["business_financial", "rural_agribusiness", "urban_middle_class"],
    // urbanization
    urban: [
      "urban_middle_class",
      "urban_poor",
      "business_financial",
      "young_progressive",
      "afro_brazilian",
    ],
    suburban: ["working_class_pt", "evangelical_conservative"],
    rural: ["rural_agribusiness"],
    // ethnicity omitted (race↔archetype mapping too sensitive to fabricate)
  },
};

/**
 * Weighted-average turnout for a census category, derived from the country's
 * voter archetypes. Returns undefined when the country has no map (US), the
 * census key is unmapped, turnout data is missing, or none of the mapped
 * archetypes are present in the bucket.
 */
export function calculateDerivedTurnout(
  countryId: string | undefined,
  censusCategory: string,
  turnout: TurnoutByGroup | undefined
): TurnoutEntry | undefined {
  if (!countryId || !turnout) return undefined;
  const cc = countryId.toUpperCase() as CountryId;
  const archetypes = CENSUS_TO_ARCHETYPE[cc]?.[censusCategory];
  if (!archetypes || archetypes.length === 0) return undefined;

  const bucketKey = getVoterArchetypeCategoriesForCountry(cc)[0]?.key;
  if (!bucketKey) return undefined;
  const bucket = turnout[bucketKey];
  if (!bucket) return undefined;

  let totalBaseline = 0;
  let totalModifier = 0;
  let count = 0;
  for (const archetype of archetypes) {
    const data = bucket[archetype];
    if (data) {
      totalBaseline += data.baseline;
      totalModifier += data.modifier;
      count++;
    }
  }
  if (count === 0) return undefined;

  const baseline = totalBaseline / count;
  const modifier = totalModifier / count;
  return { baseline, modifier, actual: baseline + modifier };
}
