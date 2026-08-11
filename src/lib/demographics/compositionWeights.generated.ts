// GENERATED FILE — do not edit by hand.
// Regenerate with:  npm run generate:composition
//
// Archetype → Layer-1 bucket weights, lifted out of the country seeds so a
// client bundle can project archetype-keyed effects without pulling in ~460KB
// of census marginals. The seed remains the source of truth;
// compositionWeights.test.ts fails if this file drifts from it.

import type { ArchetypeBucketWeight } from "./archetypeBucketMap";

export const COMPOSITION_WEIGHTS: Record<string, Record<string, ArchetypeBucketWeight[]>> = {
  UK: {
    post_industrial_workers: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    urban_progressives: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "young",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.08,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.07,
      },
    ],
    suburban_homeowners: [
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.15,
      },
    ],
    young_renters: [
      {
        dim: "age",
        key: "young",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
      {
        dim: "education",
        key: "degree_plus",
        w: 0.1,
      },
    ],
    rural_traditionalists: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.1,
      },
    ],
    retirees: [
      {
        dim: "age",
        key: "senior",
        w: 0.6,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
    ],
    public_sector: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    moderate_centrists: [
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    populist_right: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
    ],
    green_activists: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.45,
      },
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
    small_business: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "gcse_equivalent",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    new_britons: [
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "mixed",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.12,
      },
      {
        dim: "income",
        key: "low",
        w: 0.08,
      },
    ],
  },
  DE: {
    katholische_konservative: [
      {
        dim: "ethnicity",
        key: "german",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.15,
      },
    ],
    gewerkschafter: [
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.4,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "income",
        key: "low",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    urbane_progressive: [
      {
        dim: "education",
        key: "hochschulabschluss",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
      {
        dim: "income",
        key: "high",
        w: 0.15,
      },
    ],
    wirtschaftsliberale: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "hochschulabschluss",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    ost_post_industriell: [
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.1,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.1,
      },
    ],
    gruene_mittelschicht: [
      {
        dim: "education",
        key: "hochschulabschluss",
        w: 0.35,
      },
      {
        dim: "education",
        key: "abitur",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.1,
      },
    ],
    rentner_west: [
      {
        dim: "age",
        key: "senior",
        w: 0.55,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.1,
      },
    ],
    migranten_communities: [
      {
        dim: "ethnicity",
        key: "turkish_russian_diaspora",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "mena",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "eu_southern_eastern",
        w: 0.15,
      },
      {
        dim: "ethnicity",
        key: "other",
        w: 0.1,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.12,
      },
      {
        dim: "income",
        key: "low",
        w: 0.08,
      },
    ],
    landwirte_dorf: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.2,
      },
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    junge_grossstadt: [
      {
        dim: "age",
        key: "young",
        w: 0.45,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "abitur",
        w: 0.15,
      },
      {
        dim: "income",
        key: "low",
        w: 0.1,
      },
    ],
    protest_waehler_ost: [
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.1,
      },
    ],
    mittelstand_selbstaendige: [
      {
        dim: "income",
        key: "high",
        w: 0.35,
      },
      {
        dim: "education",
        key: "berufsausbildung",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "education",
        key: "abitur",
        w: 0.1,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
  },
  JP: {
    salaryman_conservative: [
      {
        dim: "age",
        key: "mature",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
    ],
    urban_progressive: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.2,
      },
      {
        dim: "income",
        key: "high",
        w: 0.15,
      },
    ],
    rural_traditionalist: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.3,
      },
      {
        dim: "education",
        key: "high_school",
        w: 0.15,
      },
      {
        dim: "income",
        key: "low",
        w: 0.1,
      },
    ],
    young_urban: [
      {
        dim: "age",
        key: "young",
        w: 0.5,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
    ],
    retiree: [
      {
        dim: "age",
        key: "senior",
        w: 0.65,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
    ],
    public_sector: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    small_business: [
      {
        dim: "income",
        key: "middle",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    komeito_faithful: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.4,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.3,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
    ],
    reform_populist: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.3,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.15,
      },
    ],
    working_mothers: [
      {
        dim: "age",
        key: "mid",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "education",
        key: "university",
        w: 0.1,
      },
    ],
  },
  IE: {
    urban_professional: [
      {
        dim: "education",
        key: "third_level",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "high",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    rural_traditional: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.2,
      },
      {
        dim: "education",
        key: "leaving_cert",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.15,
      },
    ],
    working_class: [
      {
        dim: "education",
        key: "primary_or_less",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    new_irish: [
      {
        dim: "ethnicity",
        key: "eu_other",
        w: 0.45,
      },
      {
        dim: "ethnicity",
        key: "rest_of_world",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.1,
      },
    ],
    small_business: [
      {
        dim: "income",
        key: "high",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "education",
        key: "post_secondary",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    retirees: [
      {
        dim: "age",
        key: "senior",
        w: 0.6,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
    ],
    young_urban: [
      {
        dim: "age",
        key: "young",
        w: 0.45,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.15,
      },
      {
        dim: "education",
        key: "third_level",
        w: 0.1,
      },
    ],
    border_communities: [
      {
        dim: "ethnicity",
        key: "irish",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "leaving_cert",
        w: 0.2,
      },
      {
        dim: "income",
        key: "low",
        w: 0.1,
      },
    ],
  },
  BR: {
    evangelical_conservative: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "education",
        key: "fundamental",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
      {
        dim: "ethnicity",
        key: "branco",
        w: 0.08,
      },
      {
        dim: "ethnicity",
        key: "pardo",
        w: 0.07,
      },
    ],
    working_class_pt: [
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "education",
        key: "medio",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
      {
        dim: "ethnicity",
        key: "branco",
        w: 0.1,
      },
      {
        dim: "ethnicity",
        key: "pardo",
        w: 0.1,
      },
    ],
    rural_agribusiness: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.35,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
      {
        dim: "income",
        key: "high",
        w: 0.18,
      },
      {
        dim: "education",
        key: "fundamental",
        w: 0.07,
      },
      {
        dim: "ethnicity",
        key: "branco",
        w: 0.25,
      },
    ],
    urban_middle_class: [
      {
        dim: "education",
        key: "superior",
        w: 0.28,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.12,
      },
      {
        dim: "ethnicity",
        key: "branco",
        w: 0.25,
      },
    ],
    urban_poor: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "fundamental",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "age",
        key: "young",
        w: 0.05,
      },
      {
        dim: "ethnicity",
        key: "pardo",
        w: 0.15,
      },
      {
        dim: "ethnicity",
        key: "preto",
        w: 0.05,
      },
    ],
    afro_brazilian: [
      {
        dim: "ethnicity",
        key: "preto",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "pardo",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    business_financial: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "superior",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.1,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
      {
        dim: "ethnicity",
        key: "branco",
        w: 0.15,
      },
    ],
    young_progressive: [
      {
        dim: "age",
        key: "young",
        w: 0.4,
      },
      {
        dim: "education",
        key: "superior",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
  },
  CN: {
    party_cadre: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    urban_professional: [
      {
        dim: "education",
        key: "university",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "high",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    rural_peasant: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "education",
        key: "secondary",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    migrant_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.15,
      },
    ],
    entrepreneur: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.5,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
  },
  RU: {
    party_nomenklatura: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    industrial_worker: [
      {
        dim: "education",
        key: "secondary",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    urban_professional: [
      {
        dim: "education",
        key: "university",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    national_minority: [
      {
        dim: "ethnicity",
        key: "central_asian",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "caucasian",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "other",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.2,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.5,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
  },
  SE: {
    blue_collar_sap: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    public_sector_left: [
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    business_conservative: [
      {
        dim: "income",
        key: "high",
        w: 0.45,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    agrarian_centrist: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.5,
      },
      {
        dim: "ethnicity",
        key: "swedish",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    liberal_urban: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    radical_left: [
      {
        dim: "age",
        key: "young",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "income",
        key: "low",
        w: 0.15,
      },
    ],
    rural_north: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.4,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "swedish",
        w: 0.2,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.1,
      },
    ],
  },
  FR: {
    bourgeois_right: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    catholic_conservative: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.4,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "french",
        w: 0.2,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.1,
      },
    ],
    centrist_liberal: [
      {
        dim: "income",
        key: "middle",
        w: 0.35,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.2,
      },
    ],
    social_democrat: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.2,
      },
    ],
    communist_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.4,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "european_immigrant",
        w: 0.15,
      },
    ],
    rural_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.5,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "french",
        w: 0.1,
      },
    ],
    youth_student: [
      {
        dim: "age",
        key: "young",
        w: 0.5,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  IT: {
    catholic_dc: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "italian",
        w: 0.2,
      },
    ],
    industrial_north: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    communist_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.4,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    socialist: [
      {
        dim: "income",
        key: "middle",
        w: 0.35,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.2,
      },
    ],
    southern_client: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "italian",
        w: 0.15,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.15,
      },
    ],
    secular_liberal: [
      {
        dim: "education",
        key: "university",
        w: 0.4,
      },
      {
        dim: "income",
        key: "high",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    youth_radical: [
      {
        dim: "age",
        key: "young",
        w: 0.55,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  AT: {
    socialist_lager: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    catholic_conservative: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "austrian",
        w: 0.2,
      },
    ],
    national_liberal: [
      {
        dim: "education",
        key: "secondary",
        w: 0.3,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    rural_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
    ],
    urban_worker: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    business_professional: [
      {
        dim: "income",
        key: "high",
        w: 0.45,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    communist_left: [
      {
        dim: "income",
        key: "low",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.1,
      },
    ],
  },
  DD: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.5,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.45,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    christian_milieu: [
      {
        dim: "age",
        key: "senior",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "german",
        w: 0.15,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.55,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  ES: {
    conservative_catholic: [
      {
        dim: "age",
        key: "senior",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "spanish",
        w: 0.2,
      },
    ],
    centrist: [
      {
        dim: "income",
        key: "middle",
        w: 0.35,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
    ],
    socialist_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    communist_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    regional_nationalist: [
      {
        dim: "ethnicity",
        key: "regional",
        w: 0.6,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
    ],
    urban_professional: [
      {
        dim: "education",
        key: "university",
        w: 0.4,
      },
      {
        dim: "income",
        key: "high",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    youth_democratic: [
      {
        dim: "age",
        key: "young",
        w: 0.55,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  FI: {
    social_democrat: [
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.2,
      },
    ],
    agrarian_centre: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.4,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    conservative_right: [
      {
        dim: "income",
        key: "high",
        w: 0.35,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
    ],
    communist_left: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    swedish_liberal: [
      {
        dim: "ethnicity",
        key: "minority",
        w: 0.7,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
    ],
    urban_worker: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    rural_smallholder: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.25,
      },
    ],
  },
  GR: {
    conservative_right: [
      {
        dim: "age",
        key: "mature",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "greek",
        w: 0.2,
      },
    ],
    centrist_liberal: [
      {
        dim: "education",
        key: "secondary",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    socialist_left: [
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "education",
        key: "university",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
    ],
    communist_left: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
    rural_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
    ],
    urban_worker: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    shipping_business: [
      {
        dim: "income",
        key: "high",
        w: 0.45,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
  },
  NG: {
    northern_muslim_conservative: [
      {
        dim: "religion",
        key: "muslim",
        w: 0.4,
      },
      {
        dim: "ethnicity",
        key: "hausa_fulani",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.2,
      },
      {
        dim: "income",
        key: "low",
        w: 0.1,
      },
    ],
    yoruba_moderate: [
      {
        dim: "ethnicity",
        key: "yoruba",
        w: 0.45,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.15,
      },
    ],
    igbo_business: [
      {
        dim: "ethnicity",
        key: "igbo",
        w: 0.4,
      },
      {
        dim: "income",
        key: "high",
        w: 0.25,
      },
      {
        dim: "education",
        key: "tertiary",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    niger_delta_youth: [
      {
        dim: "ethnicity",
        key: "minority",
        w: 0.35,
      },
      {
        dim: "religion",
        key: "christian",
        w: 0.2,
      },
      {
        dim: "age",
        key: "young",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
    ],
    christian_conservative: [
      {
        dim: "religion",
        key: "christian",
        w: 0.45,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.15,
      },
    ],
    urban_young_progressive: [
      {
        dim: "age",
        key: "young",
        w: 0.35,
      },
      {
        dim: "education",
        key: "tertiary",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.15,
      },
    ],
    rural_agrarian: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.4,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "education",
        key: "basic",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    lagos_cosmopolitan: [
      {
        dim: "urbanization",
        key: "urban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "education",
        key: "tertiary",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
  },
  TR: {
    kemalist_secular: [
      {
        dim: "education",
        key: "university",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "turkish",
        w: 0.2,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.2,
      },
    ],
    conservative_religious: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.35,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "turkish",
        w: 0.15,
      },
    ],
    nationalist: [
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "turkish",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "education",
        key: "secondary",
        w: 0.2,
      },
    ],
    urban_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    rural_peasant: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "turkish",
        w: 0.15,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    kurdish_minority: [
      {
        dim: "ethnicity",
        key: "kurdish",
        w: 0.6,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.15,
      },
    ],
    business_liberal: [
      {
        dim: "income",
        key: "high",
        w: 0.45,
      },
      {
        dim: "education",
        key: "university",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.15,
      },
    ],
  },
  HU: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  PL: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  RO: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  YU: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  BG: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  BLR: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  CS: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  BAL: {
    party_nomenklatura: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "education",
        key: "university",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    industrial_worker: [
      {
        dim: "income",
        key: "low",
        w: 0.35,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.1,
      },
    ],
    collective_farmer: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.55,
      },
      {
        dim: "income",
        key: "low",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
    ],
    intelligentsia: [
      {
        dim: "education",
        key: "university",
        w: 0.5,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
    ],
    religious_traditional: [
      {
        dim: "age",
        key: "senior",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "rural",
        w: 0.3,
      },
      {
        dim: "education",
        key: "primary_or_below",
        w: 0.3,
      },
    ],
    youth: [
      {
        dim: "age",
        key: "young",
        w: 0.6,
      },
      {
        dim: "education",
        key: "vocational",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
    ],
  },
  SCO: {
    post_industrial_workers: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    urban_progressives: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "young",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.08,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.07,
      },
    ],
    suburban_homeowners: [
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.15,
      },
    ],
    young_renters: [
      {
        dim: "age",
        key: "young",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
      {
        dim: "education",
        key: "degree_plus",
        w: 0.1,
      },
    ],
    rural_traditionalists: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.1,
      },
    ],
    retirees: [
      {
        dim: "age",
        key: "senior",
        w: 0.6,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
    ],
    public_sector: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    moderate_centrists: [
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    populist_right: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
    ],
    green_activists: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.45,
      },
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
    small_business: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "gcse_equivalent",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    new_britons: [
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "mixed",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.12,
      },
      {
        dim: "income",
        key: "low",
        w: 0.08,
      },
    ],
  },
  WAL: {
    post_industrial_workers: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "income",
        key: "low",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
    ],
    urban_progressives: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "young",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.08,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.07,
      },
    ],
    suburban_homeowners: [
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.35,
      },
      {
        dim: "income",
        key: "high",
        w: 0.3,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.15,
      },
    ],
    young_renters: [
      {
        dim: "age",
        key: "young",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.3,
      },
      {
        dim: "income",
        key: "low",
        w: 0.2,
      },
      {
        dim: "education",
        key: "degree_plus",
        w: 0.1,
      },
    ],
    rural_traditionalists: [
      {
        dim: "urbanization",
        key: "rural",
        w: 0.45,
      },
      {
        dim: "age",
        key: "senior",
        w: 0.25,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.1,
      },
    ],
    retirees: [
      {
        dim: "age",
        key: "senior",
        w: 0.6,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.25,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.15,
      },
    ],
    public_sector: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    moderate_centrists: [
      {
        dim: "education",
        key: "a_level_equivalent",
        w: 0.35,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mid",
        w: 0.15,
      },
    ],
    populist_right: [
      {
        dim: "education",
        key: "no_qualifications",
        w: 0.35,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.25,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.2,
      },
      {
        dim: "ethnicity",
        key: "white_british",
        w: 0.2,
      },
    ],
    green_activists: [
      {
        dim: "education",
        key: "degree_plus",
        w: 0.45,
      },
      {
        dim: "age",
        key: "young",
        w: 0.3,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.15,
      },
      {
        dim: "income",
        key: "middle",
        w: 0.1,
      },
    ],
    small_business: [
      {
        dim: "income",
        key: "high",
        w: 0.4,
      },
      {
        dim: "urbanization",
        key: "suburban",
        w: 0.3,
      },
      {
        dim: "education",
        key: "gcse_equivalent",
        w: 0.2,
      },
      {
        dim: "age",
        key: "mature",
        w: 0.1,
      },
    ],
    new_britons: [
      {
        dim: "ethnicity",
        key: "asian_british",
        w: 0.35,
      },
      {
        dim: "ethnicity",
        key: "black_british",
        w: 0.3,
      },
      {
        dim: "ethnicity",
        key: "mixed",
        w: 0.15,
      },
      {
        dim: "urbanization",
        key: "urban",
        w: 0.12,
      },
      {
        dim: "income",
        key: "low",
        w: 0.08,
      },
    ],
  },
};
