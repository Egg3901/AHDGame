import type { StateDemographics } from "@/lib/db/types";

/**
 * Japan region demographics — 1991 era (JP voter archetypes).
 *
 * Era anchor: the bubble-economy peak under Kaifu/Miyazawa, one year after
 * the LDP's comfortable February 1990 general-election win. Salaryman
 * corporate culture is at its zenith — lifetime employment, company
 * loyalty, and a swollen white-collar middle class in the Tokyo and Nagoya
 * belts. The rural LDP machine (koenkai, Nokyo, public works) is intact.
 * The union/left bloc is in structural decline: Sohyo dissolved into Rengo
 * in 1989, privatization of JNR/NTT gutted public-sector militancy, and the
 * JSP's 1989 "Madonna boom" was already fading. Komeito is at its
 * organizational peak in Osaka and Tokyo. Aging has only just begun
 * (population 65+ ~12-13%), dual-income mothers remain uncommon
 * (pre-Womenomics, pre-childcare expansion), and no reform-populist
 * movement exists — reform_populist is seeded at 0 everywhere (Ishin-style
 * populism emerges in 2010s Osaka).
 *
 * Methodology: every value is independently authored from historical
 * knowledge of Japan circa 1990-91 (1990 House of Representatives results
 * by region, 1990 census age structure, Rengo-era union geography, Soka
 * Gakkai regional strength). Nothing is scaled or multiplied from the 2019
 * file; only region IDs, group IDs, and the populations-sum-to-100
 * convention are shared with it.
 *
 * Turnout calibration: the 1990 general election recorded ~73.3% national
 * turnout. Group turnouts are set so the population-weighted national
 * figure lands near that, with rural above urban and youth turnout
 * (~55-58%) already sagging relative to 1979 but well above 2019 levels.
 */
export const jpRegionDemographics1991: StateDemographics[] = [
  // ── Hokkaido ──────────────────────────────────────────────────────────────
  // Coal closures and JNR privatization shrank the union left, but Hokkaido
  // stayed Japan's most competitive region (JSP swept it in 1990).
  {
    _id: "HOK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 16, economicLean: 1, socialLean: 1, turnout: 70 },
      urban_progressive: { population: 15, economicLean: -2, socialLean: -2, turnout: 72 },
      rural_traditionalist: { population: 20, economicLean: 1, socialLean: 3, turnout: 78 },
      young_urban: { population: 11, economicLean: -1, socialLean: -2, turnout: 56 },
      retiree: { population: 10, economicLean: 0, socialLean: 2, turnout: 78 },
      public_sector: { population: 12, economicLean: -2, socialLean: -1, turnout: 73 },
      small_business: { population: 10, economicLean: 3, socialLean: 1, turnout: 72 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Tohoku ────────────────────────────────────────────────────────────────
  // Rice country at the height of public-works clientelism; aging and youth
  // outmigration already visible but the LDP machine undented.
  {
    _id: "TOH",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 2, turnout: 71 },
      urban_progressive: { population: 9, economicLean: -2, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 31, economicLean: 1, socialLean: 3, turnout: 79 },
      young_urban: { population: 8, economicLean: -1, socialLean: -2, turnout: 55 },
      retiree: { population: 13, economicLean: 0, socialLean: 2, turnout: 79 },
      public_sector: { population: 10, economicLean: -2, socialLean: -1, turnout: 73 },
      small_business: { population: 11, economicLean: 3, socialLean: 1, turnout: 73 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kanto ─────────────────────────────────────────────────────────────────
  // Bubble-peak Tokyo: the salaryman archetype at its apex, land prices at
  // record highs, big youth cohort (second baby boomers entering adulthood).
  {
    _id: "KAN",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 22, economicLean: 1, socialLean: 1, turnout: 70 },
      urban_progressive: { population: 17, economicLean: -2, socialLean: -3, turnout: 71 },
      rural_traditionalist: { population: 6, economicLean: 1, socialLean: 3, turnout: 76 },
      young_urban: { population: 17, economicLean: -1, socialLean: -2, turnout: 56 },
      retiree: { population: 8, economicLean: 0, socialLean: 2, turnout: 77 },
      public_sector: { population: 10, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 71 },
      komeito_faithful: { population: 8, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 61 },
    },
    lastUpdated: new Date(),
  },
  // ── Chubu ─────────────────────────────────────────────────────────────────
  // Toyota-belt prosperity: company-town salaryman conservatism plus
  // cooperative Rengo auto unions; rural Hokuriku still solid LDP.
  {
    _id: "CHU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 23, economicLean: 1, socialLean: 1, turnout: 71 },
      urban_progressive: { population: 11, economicLean: -2, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 17, economicLean: 1, socialLean: 3, turnout: 78 },
      young_urban: { population: 11, economicLean: -1, socialLean: -2, turnout: 56 },
      retiree: { population: 11, economicLean: 0, socialLean: 2, turnout: 78 },
      public_sector: { population: 9, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 11, economicLean: 3, socialLean: 1, turnout: 72 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kansai ────────────────────────────────────────────────────────────────
  // Osaka at the bubble peak: Komeito's strongest region, lingering JCP
  // urban vote, dense merchant class. Ishin-style populism still 20 years off.
  {
    _id: "KNS",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 19, economicLean: 1, socialLean: 1, turnout: 69 },
      urban_progressive: { population: 14, economicLean: -2, socialLean: -3, turnout: 71 },
      rural_traditionalist: { population: 10, economicLean: 1, socialLean: 3, turnout: 77 },
      young_urban: { population: 14, economicLean: -1, socialLean: -2, turnout: 56 },
      retiree: { population: 10, economicLean: 0, socialLean: 2, turnout: 77 },
      public_sector: { population: 9, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 12, economicLean: 3, socialLean: 1, turnout: 72 },
      komeito_faithful: { population: 9, economicLean: 0, socialLean: 0, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 3, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Chugoku ───────────────────────────────────────────────────────────────
  // Faction-boss country (Takeshita's Shimane, Miyazawa's Hiroshima);
  // aging beginning to bite in the San'in coast prefectures.
  {
    _id: "CGK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 13, economicLean: 1, socialLean: 2, turnout: 71 },
      urban_progressive: { population: 9, economicLean: -2, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 28, economicLean: 1, socialLean: 3, turnout: 79 },
      young_urban: { population: 8, economicLean: -1, socialLean: -2, turnout: 55 },
      retiree: { population: 14, economicLean: 0, socialLean: 2, turnout: 79 },
      public_sector: { population: 10, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 12, economicLean: 3, socialLean: 1, turnout: 73 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Shikoku ───────────────────────────────────────────────────────────────
  // Most rural and earliest-aging region; cooperative networks still
  // delivered overwhelming LDP majorities in 1990.
  {
    _id: "SHI",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 10, economicLean: 1, socialLean: 2, turnout: 71 },
      urban_progressive: { population: 7, economicLean: -2, socialLean: -2, turnout: 70 },
      rural_traditionalist: { population: 32, economicLean: 1, socialLean: 3, turnout: 80 },
      young_urban: { population: 7, economicLean: -1, socialLean: -2, turnout: 54 },
      retiree: { population: 16, economicLean: 0, socialLean: 2, turnout: 80 },
      public_sector: { population: 10, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 12, economicLean: 3, socialLean: 1, turnout: 73 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kyushu & Okinawa ─────────────────────────────────────────────────────
  // Conservative mainland Kyushu with Fukuoka as the urban pole; Okinawa's
  // base-politics protest vote keeps a progressive floor.
  {
    _id: "KYU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 2, turnout: 70 },
      urban_progressive: { population: 11, economicLean: -2, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 26, economicLean: 1, socialLean: 3, turnout: 78 },
      young_urban: { population: 9, economicLean: -1, socialLean: -2, turnout: 55 },
      retiree: { population: 13, economicLean: 0, socialLean: 2, turnout: 78 },
      public_sector: { population: 10, economicLean: -2, socialLean: -1, turnout: 72 },
      small_business: { population: 11, economicLean: 3, socialLean: 1, turnout: 72 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 0, turnout: 80 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 1, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
];
