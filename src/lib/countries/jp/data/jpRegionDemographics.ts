import type { StateDemographics } from "@/lib/db/types";

/**
 * Japan region demographics using JP voter archetypes.
 *
 * Each region has a composition of the 10 JP voter groups (populations sum to 100%).
 * Economic and social leans calibrated to actual voting patterns in each region.
 *
 * `categoryWeights` uses `jp_voterGroups: 100` to match the JP demographic
 * profile ID ("jp_archetypes") defined in CountryConfig.
 *
 * Values are approximate estimates based on:
 * - 2021 House of Representatives election results by bloc
 * - Japanese Census 2020 regional data
 * - NHK election surveys
 *
 * Design principle: every archetype has a non-zero population in every region.
 * Regional character is expressed through the population mix.
 *
 * Group IDs match jpDemographicCategories.ts `jp_voterGroups` groups.
 */
export const jpRegionDemographics: StateDemographics[] = [
  // ── Hokkaido ──────────────────────────────────────────────────────────────
  // Mixed urban/rural. Sapporo is progressive; rural areas conservative.
  // Historically more competitive than mainland rural regions.
  {
    _id: "HOK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 1, turnout: 63 },
      urban_progressive: { population: 13, economicLean: -2, socialLean: -3, turnout: 66 },
      rural_traditionalist: { population: 18, economicLean: 1, socialLean: 3, turnout: 70 },
      young_urban: { population: 10, economicLean: -1, socialLean: -2, turnout: 46 },
      retiree: { population: 16, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 9, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 67 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 52 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 56 },
    },
    lastUpdated: new Date(),
  },
  // ── Tohoku ────────────────────────────────────────────────────────────────
  // Rural, aging, strong LDP. Post-3/11 disaster recovery is a lasting issue.
  {
    _id: "TOH",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 2, turnout: 64 },
      urban_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 65 },
      rural_traditionalist: { population: 24, economicLean: 1, socialLean: 3, turnout: 72 },
      young_urban: { population: 7, economicLean: -1, socialLean: -2, turnout: 44 },
      retiree: { population: 20, economicLean: 0, socialLean: 2, turnout: 75 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 68 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
  // ── Kanto ─────────────────────────────────────────────────────────────────
  // Japan's largest metro area (Tokyo). Young, diverse, progressive.
  // CDP/opposition strongest here. Very high urban progressive population.
  {
    _id: "KAN",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 16, economicLean: 1, socialLean: 1, turnout: 66 },
      urban_progressive: { population: 18, economicLean: -2, socialLean: -4, turnout: 70 },
      rural_traditionalist: { population: 5, economicLean: 1, socialLean: 3, turnout: 68 },
      young_urban: { population: 16, economicLean: -1, socialLean: -3, turnout: 50 },
      retiree: { population: 11, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 69 },
      komeito_faithful: { population: 6, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 5, economicLean: 2, socialLean: 0, turnout: 55 },
      working_mothers: { population: 8, economicLean: -1, socialLean: -2, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Chubu ─────────────────────────────────────────────────────────────────
  // Manufacturing heartland (Toyota/Nagoya). Salaryman-heavy, moderate.
  {
    _id: "CHU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 20, economicLean: 1, socialLean: 1, turnout: 66 },
      urban_progressive: { population: 11, economicLean: -2, socialLean: -3, turnout: 67 },
      rural_traditionalist: { population: 15, economicLean: 1, socialLean: 3, turnout: 71 },
      young_urban: { population: 10, economicLean: -1, socialLean: -2, turnout: 47 },
      retiree: { population: 14, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 7, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 10, economicLean: 3, socialLean: 1, turnout: 68 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 54 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 57 },
    },
    lastUpdated: new Date(),
  },
  // ── Kansai ────────────────────────────────────────────────────────────────
  // Osaka-centered. Ishin's stronghold — reform populists dominate opposition.
  // Urban, commercial, anti-establishment streak.
  {
    _id: "KNS",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 1, turnout: 64 },
      urban_progressive: { population: 12, economicLean: -2, socialLean: -3, turnout: 67 },
      rural_traditionalist: { population: 8, economicLean: 1, socialLean: 3, turnout: 69 },
      young_urban: { population: 13, economicLean: -1, socialLean: -2, turnout: 49 },
      retiree: { population: 13, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 7, economicLean: -2, socialLean: -1, turnout: 65 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 68 },
      komeito_faithful: { population: 6, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 12, economicLean: 2, socialLean: 0, turnout: 58 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 58 },
    },
    lastUpdated: new Date(),
  },
  // ── Chugoku ───────────────────────────────────────────────────────────────
  // Rural, aging. Strong LDP territory. Hiroshima is the only major city.
  {
    _id: "CGK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 13, economicLean: 1, socialLean: 2, turnout: 65 },
      urban_progressive: { population: 9, economicLean: -2, socialLean: -3, turnout: 66 },
      rural_traditionalist: { population: 22, economicLean: 1, socialLean: 3, turnout: 72 },
      young_urban: { population: 8, economicLean: -1, socialLean: -2, turnout: 45 },
      retiree: { population: 19, economicLean: 0, socialLean: 2, turnout: 75 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 67 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 52 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 56 },
    },
    lastUpdated: new Date(),
  },
  // ── Shikoku ───────────────────────────────────────────────────────────────
  // Most rural, most aging. Strongest LDP bastion. Very low youth population.
  {
    _id: "SHI",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 11, economicLean: 1, socialLean: 2, turnout: 64 },
      urban_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 26, economicLean: 1, socialLean: 3, turnout: 72 },
      young_urban: { population: 6, economicLean: -1, socialLean: -2, turnout: 43 },
      retiree: { population: 22, economicLean: 0, socialLean: 2, turnout: 76 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 67 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 4, economicLean: -1, socialLean: -2, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── Kyushu & Okinawa ─────────────────────────────────────────────────────
  // Conservative mainland Kyushu + distinct Okinawa (US base issues).
  // Fukuoka is the urban centre; otherwise rural and traditional.
  {
    _id: "KYU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 2, turnout: 64 },
      urban_progressive: { population: 10, economicLean: -2, socialLean: -3, turnout: 66 },
      rural_traditionalist: { population: 20, economicLean: 1, socialLean: 3, turnout: 71 },
      young_urban: { population: 9, economicLean: -1, socialLean: -2, turnout: 46 },
      retiree: { population: 17, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 66 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 68 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 0, turnout: 72 },
      reform_populist: { population: 3, economicLean: 2, socialLean: 0, turnout: 52 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 56 },
    },
    lastUpdated: new Date(),
  },
];
