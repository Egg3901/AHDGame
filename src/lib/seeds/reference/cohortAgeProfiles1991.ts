/**
 * Eurostat demo_pjan,1 January 1991, total-sex adult age counts.
 * Bands:18-29,30-44,45-64,65+. The last band includes ages65-99 and Y_OPEN100+.
 * National shapes are estimated regional proxies, not regional observations.
 * Source population totals never replace the independently scoped opening anchors.
 * No ethnicity, education, income or urbanization profile is inferred here.
 */
export const COHORT_AGE_PROFILES_1991 = {
  FR: {
    regionIds: ["FR_IDF", "FR_NOR", "FR_EST", "FR_OUE", "FR_SOU", "FR_ARA", "FR_MED", "FR_CEN"],
    adultCounts: {
      young: 10683857,
      mid: 13207348,
      mature: 11941786,
      senior: 8142988,
    },
    adultPopulation: 43975979,
    sourcePopulation: 58313439,
    referenceDate: "1991-01-01",
    retrievedAt: "2026-10-01",
    revision: "2026-09-25T23:00:00+0200",
    source:
      "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo=FR&time=1991&sex=T&unit=NR",
    basis:
      "National adult age shape used as an explicit proxy for existing aggregate regions; population levels remain independently seeded",
    scopeNote:
      "National age shape is a proxy for eight aggregate regions. FR source total differs from metropolitan opening population; ES reference date differs from midyear anchor. Keep2676 national populations unchanged.",
  },
  ES: {
    regionIds: ["ES_MAD", "ES_CAT", "ES_AND", "ES_VAL", "ES_PVB", "ES_GAL", "ES_NOR", "ES_CEN"],
    adultCounts: {
      young: 7669831,
      mid: 7762473,
      mature: 8510732,
      senior: 5348081,
    },
    adultPopulation: 29291117,
    sourcePopulation: 38881416,
    referenceDate: "1991-01-01",
    retrievedAt: "2026-10-01",
    revision: "2026-09-25T23:00:00+0200",
    source:
      "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_pjan?geo=ES&time=1991&sex=T&unit=NR",
    basis:
      "National adult age shape used as an explicit proxy for existing aggregate regions; population levels remain independently seeded",
    scopeNote:
      "National age shape is a proxy for eight aggregate regions. FR source total differs from metropolitan opening population; ES reference date differs from midyear anchor. Keep2676 national populations unchanged.",
  },
} as const;
