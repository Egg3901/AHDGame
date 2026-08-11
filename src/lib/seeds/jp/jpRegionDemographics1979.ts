import type { StateDemographics } from "@/lib/db/types";

/**
 * Japan region demographics — 1979 era (JP voter archetypes).
 *
 * Era anchor: the Ohira-era LDP at the close of the 1970s. The October 1979
 * general election returned the LDP just short of a majority but its rural
 * machine — koenkai networks, agricultural cooperatives, public-works
 * clientelism — remained dominant outside the big cities. The
 * Socialist/Sohyo union bloc was still large in industrial and mining
 * regions (Hokkaido coalfields, northern Kyushu, Tokyo public sector);
 * Soka Gakkai/Komeito was firmly established in Osaka and Tokyo; the JCP
 * polled near its postwar peak in urban Kansai. Japan was young (median age
 * ~32), retirees were a small cohort, dual-income households with children
 * were rare, and no reform-populist movement existed (Ishin-style populism
 * dates from 2010s Osaka) — reform_populist is seeded at 0 everywhere.
 *
 * Methodology: every value is independently authored from historical
 * knowledge of late-1970s Japanese politics and demography (1979/1980
 * general election results by region, 1980 census age structure, Sohyo/
 * Domei union geography, Soka Gakkai regional strength). Nothing here is
 * scaled or multiplied from the 2019 file; only the region IDs, group IDs,
 * and the populations-sum-to-100 convention are shared with it.
 *
 * Turnout calibration: the 1979 general election recorded ~68% national
 * turnout and the 1980 double election ~74.5%. Group turnouts are set so a
 * population-weighted national figure lands in the low 70s, with rural
 * turnout well above urban and youth turnout the lowest (but far above its
 * 2019 level — 1970s youth still voted at ~60%).
 */
export const jpRegionDemographics1979: StateDemographics[] = [
  // ── Hokkaido ──────────────────────────────────────────────────────────────
  // Coal-mining and railway unions made Hokkaido a JSP stronghold; large
  // farming interior still answered to the LDP/Nokyo machine.
  {
    _id: "HOK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 2, socialLean: 2, turnout: 71 },
      urban_progressive: { population: 16, economicLean: -3, socialLean: -2, turnout: 72 },
      rural_traditionalist: { population: 22, economicLean: 1, socialLean: 3, turnout: 79 },
      young_urban: { population: 12, economicLean: -2, socialLean: -2, turnout: 59 },
      retiree: { population: 7, economicLean: 1, socialLean: 2, turnout: 77 },
      public_sector: { population: 14, economicLean: -3, socialLean: -1, turnout: 75 },
      small_business: { population: 11, economicLean: 3, socialLean: 2, turnout: 74 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Tohoku ────────────────────────────────────────────────────────────────
  // Archetypal LDP rice country: agricultural cooperatives, construction
  // clientelism, and faction bosses (Tanaka machine spillover) ran politics.
  {
    _id: "TOH",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 9, economicLean: 2, socialLean: 2, turnout: 72 },
      urban_progressive: { population: 10, economicLean: -3, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 34, economicLean: 1, socialLean: 3, turnout: 80 },
      young_urban: { population: 9, economicLean: -2, socialLean: -2, turnout: 58 },
      retiree: { population: 9, economicLean: 1, socialLean: 2, turnout: 78 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 75 },
      small_business: { population: 12, economicLean: 3, socialLean: 2, turnout: 75 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kanto ─────────────────────────────────────────────────────────────────
  // Tokyo metro: huge inflow of young workers, strong public-sector unions,
  // progressive governor era (Minobe until 1979), big Soka Gakkai presence.
  {
    _id: "KAN",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 18, economicLean: 2, socialLean: 1, turnout: 70 },
      urban_progressive: { population: 16, economicLean: -3, socialLean: -3, turnout: 71 },
      rural_traditionalist: { population: 8, economicLean: 1, socialLean: 3, turnout: 77 },
      young_urban: { population: 18, economicLean: -2, socialLean: -2, turnout: 60 },
      retiree: { population: 6, economicLean: 1, socialLean: 2, turnout: 76 },
      public_sector: { population: 12, economicLean: -3, socialLean: -1, turnout: 74 },
      small_business: { population: 12, economicLean: 3, socialLean: 1, turnout: 73 },
      komeito_faithful: { population: 8, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 61 },
    },
    lastUpdated: new Date(),
  },
  // ── Chubu ─────────────────────────────────────────────────────────────────
  // Nagoya manufacturing belt: Domei-affiliated auto unions leaned DSP
  // (moderate), surrounding prefectures deeply rural and LDP.
  {
    _id: "CHU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 18, economicLean: 2, socialLean: 2, turnout: 72 },
      urban_progressive: { population: 12, economicLean: -2, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 22, economicLean: 1, socialLean: 3, turnout: 79 },
      young_urban: { population: 12, economicLean: -1, socialLean: -2, turnout: 59 },
      retiree: { population: 7, economicLean: 1, socialLean: 2, turnout: 77 },
      public_sector: { population: 11, economicLean: -2, socialLean: -1, turnout: 74 },
      small_business: { population: 12, economicLean: 3, socialLean: 2, turnout: 74 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 1, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kansai ────────────────────────────────────────────────────────────────
  // Osaka: Komeito's national heartland, JCP near its peak, dense merchant
  // small-business class. No reform-populist bloc exists yet.
  {
    _id: "KNS",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 16, economicLean: 2, socialLean: 1, turnout: 70 },
      urban_progressive: { population: 16, economicLean: -3, socialLean: -3, turnout: 71 },
      rural_traditionalist: { population: 12, economicLean: 1, socialLean: 3, turnout: 78 },
      young_urban: { population: 14, economicLean: -2, socialLean: -2, turnout: 59 },
      retiree: { population: 7, economicLean: 1, socialLean: 2, turnout: 76 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 74 },
      small_business: { population: 13, economicLean: 3, socialLean: 1, turnout: 74 },
      komeito_faithful: { population: 9, economicLean: 0, socialLean: 1, turnout: 82 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Chugoku ───────────────────────────────────────────────────────────────
  // Conservative heartland (Takeshita/Miyazawa country); Hiroshima's
  // industry and peace movement supplied the only progressive counterweight.
  {
    _id: "CGK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 10, economicLean: 2, socialLean: 2, turnout: 72 },
      urban_progressive: { population: 10, economicLean: -3, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 32, economicLean: 1, socialLean: 3, turnout: 80 },
      young_urban: { population: 9, economicLean: -2, socialLean: -2, turnout: 58 },
      retiree: { population: 9, economicLean: 1, socialLean: 2, turnout: 78 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 74 },
      small_business: { population: 13, economicLean: 3, socialLean: 2, turnout: 75 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Shikoku ───────────────────────────────────────────────────────────────
  // Most rural region; farm and fishing cooperatives delivered near-lockstep
  // LDP majorities. Youth outmigration to Osaka/Tokyo already heavy.
  {
    _id: "SHI",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 8, economicLean: 2, socialLean: 2, turnout: 72 },
      urban_progressive: { population: 8, economicLean: -3, socialLean: -2, turnout: 70 },
      rural_traditionalist: { population: 36, economicLean: 1, socialLean: 3, turnout: 81 },
      young_urban: { population: 8, economicLean: -2, socialLean: -2, turnout: 57 },
      retiree: { population: 10, economicLean: 1, socialLean: 2, turnout: 79 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 74 },
      small_business: { population: 13, economicLean: 3, socialLean: 2, turnout: 75 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 2, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
  // ── Kyushu & Okinawa ─────────────────────────────────────────────────────
  // Rural-conservative mainland plus a residual coal-union left (Chikuho/
  // Miike legacy) and a distinct Okinawan protest vote (reverted 1972).
  {
    _id: "KYU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 11, economicLean: 2, socialLean: 2, turnout: 71 },
      urban_progressive: { population: 12, economicLean: -3, socialLean: -2, turnout: 71 },
      rural_traditionalist: { population: 30, economicLean: 1, socialLean: 3, turnout: 79 },
      young_urban: { population: 10, economicLean: -2, socialLean: -2, turnout: 58 },
      retiree: { population: 8, economicLean: 1, socialLean: 2, turnout: 78 },
      public_sector: { population: 11, economicLean: -3, socialLean: -1, turnout: 74 },
      small_business: { population: 12, economicLean: 3, socialLean: 2, turnout: 74 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 1, turnout: 81 },
      reform_populist: { population: 0, economicLean: 2, socialLean: 0, turnout: 50 },
      working_mothers: { population: 1, economicLean: -1, socialLean: -1, turnout: 60 },
    },
    lastUpdated: new Date(),
  },
];
