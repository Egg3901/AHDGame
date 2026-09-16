import type { StateDemographics } from "@/lib/db/types";

/**
 * Japan region demographics — 2023 era (Kishida administration).
 *
 * Era anchor (circa 2023):
 * - Super-aged society: the retiree bloc is at its historical maximum,
 *   especially in rural/regional Japan (Shikoku, Tohoku, Chugoku), where
 *   depopulation and youth outmigration compound the effect.
 * - Ishin no Kai (reform_populist) dominates Kansai after the 2021 general
 *   and 2023 unified local elections, and is growing nationally as the
 *   second-opposition pole.
 * - Komeito's Soka Gakkai base is aging and shrinking; its organizational
 *   turnout machine remains strong but its share of the electorate falls.
 * - The organized-labor-adjacent public_sector bloc is small and stagnant
 *   (Rengo's declining density, CDP/DPP split of the union vote).
 * - working_mothers significantly larger post-Womenomics: female labor
 *   force participation rose sharply through the late 2010s/early 2020s.
 * - The lifetime-employment salaryman_conservative bloc continues eroding
 *   with the shift to non-regular employment.
 * - Youth cohort shrunken (record-low births) and politically disengaged.
 * - Tokyo concentration extreme: Kanto absorbs young and working-age
 *   internal migrants from every other region.
 *
 * Turnout calibration: 2021 House of Representatives general election
 * (~55.9% overall), with 20s turnout ~36-40% and 60s/70s turnout ~70%+.
 * Komeito faithful retain machine turnout (~70-72); Ishin sympathizers in
 * Kansai turn out at elevated rates relative to national reform voters.
 *
 * Methodology: every value below was authored independently for the 2023
 * era from knowledge of Japanese politics (election results by bloc,
 * 2020 census trajectories, labor-force statistics, party-base studies) —
 * NOT derived by scaling or adjusting the 2019-era seed. Region IDs and
 * group IDs are kept identical to `jpRegionDemographics.ts`; populations
 * per region sum to 100.
 */
export const jpRegionDemographics2023: StateDemographics[] = [
  // ── Hokkaido ──────────────────────────────────────────────────────────────
  // Sapporo progressive, rural interior aging fast. Still one of the more
  // competitive regions; Ishin gaining a modest foothold.
  {
    _id: "HOK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 1, turnout: 60 },
      urban_progressive: { population: 13, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 17, economicLean: 1, socialLean: 3, turnout: 68 },
      young_urban: { population: 9, economicLean: 0, socialLean: -2, turnout: 39 },
      retiree: { population: 19, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 9, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 8, economicLean: 3, socialLean: 1, turnout: 64 },
      komeito_faithful: { population: 3, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 4, economicLean: 3, socialLean: 0, turnout: 54 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
  // ── Tohoku ────────────────────────────────────────────────────────────────
  // Fastest-depopulating region. Retirees now the largest bloc; youth have
  // overwhelmingly migrated to Kanto. LDP-rural machine still dominant.
  {
    _id: "TOH",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 10, economicLean: 1, socialLean: 2, turnout: 61 },
      urban_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 63 },
      rural_traditionalist: { population: 23, economicLean: 1, socialLean: 3, turnout: 70 },
      young_urban: { population: 6, economicLean: 0, socialLean: -2, turnout: 37 },
      retiree: { population: 23, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 65 },
      komeito_faithful: { population: 3, economicLean: 0, socialLean: 1, turnout: 70 },
      reform_populist: { population: 4, economicLean: 3, socialLean: 0, turnout: 50 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
  // ── Kanto ─────────────────────────────────────────────────────────────────
  // Extreme Tokyo concentration: the only region still gaining working-age
  // population. Largest young_urban and working_mothers blocs in the
  // country; Ishin expanding beyond Kansai mostly here.
  {
    _id: "KAN",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 14, economicLean: 1, socialLean: 1, turnout: 62 },
      urban_progressive: { population: 18, economicLean: -2, socialLean: -4, turnout: 67 },
      rural_traditionalist: { population: 4, economicLean: 1, socialLean: 3, turnout: 66 },
      young_urban: { population: 15, economicLean: 0, socialLean: -3, turnout: 42 },
      retiree: { population: 13, economicLean: 0, socialLean: 2, turnout: 71 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 66 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 7, economicLean: 3, socialLean: 0, turnout: 56 },
      working_mothers: { population: 9, economicLean: -1, socialLean: -3, turnout: 58 },
    },
    lastUpdated: new Date(),
  },
  // ── Chubu ─────────────────────────────────────────────────────────────────
  // Toyota-belt manufacturing core. Salaryman bloc still the largest here
  // even as it erodes nationally; DPP/union remnants fold into public_sector
  // and salaryman categories.
  {
    _id: "CHU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 18, economicLean: 1, socialLean: 1, turnout: 63 },
      urban_progressive: { population: 11, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 14, economicLean: 1, socialLean: 3, turnout: 69 },
      young_urban: { population: 9, economicLean: 0, socialLean: -2, turnout: 40 },
      retiree: { population: 16, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 7, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 10, economicLean: 3, socialLean: 1, turnout: 65 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 5, economicLean: 3, socialLean: 0, turnout: 54 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 56 },
    },
    lastUpdated: new Date(),
  },
  // ── Kansai ────────────────────────────────────────────────────────────────
  // Ishin's fortress. After sweeping the 2023 Osaka double election and
  // unified locals, reform populists are the defining bloc of the region's
  // politics and turn out at near-machine rates.
  {
    _id: "KNS",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 1, turnout: 60 },
      urban_progressive: { population: 11, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 7, economicLean: 1, socialLean: 3, turnout: 67 },
      young_urban: { population: 12, economicLean: 0, socialLean: -2, turnout: 41 },
      retiree: { population: 15, economicLean: 0, socialLean: 2, turnout: 72 },
      public_sector: { population: 7, economicLean: -2, socialLean: -1, turnout: 62 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 65 },
      komeito_faithful: { population: 5, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 15, economicLean: 3, socialLean: 0, turnout: 61 },
      working_mothers: { population: 7, economicLean: -1, socialLean: -2, turnout: 57 },
    },
    lastUpdated: new Date(),
  },
  // ── Chugoku ───────────────────────────────────────────────────────────────
  // Kishida's home region (Hiroshima). Deeply aged outside Hiroshima city;
  // LDP rural machine plus a swelling retiree bloc.
  {
    _id: "CGK",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 11, economicLean: 1, socialLean: 2, turnout: 61 },
      urban_progressive: { population: 9, economicLean: -2, socialLean: -3, turnout: 63 },
      rural_traditionalist: { population: 21, economicLean: 1, socialLean: 3, turnout: 70 },
      young_urban: { population: 7, economicLean: 0, socialLean: -2, turnout: 38 },
      retiree: { population: 22, economicLean: 0, socialLean: 2, turnout: 74 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 64 },
      komeito_faithful: { population: 3, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 4, economicLean: 3, socialLean: 0, turnout: 51 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
  // ── Shikoku ───────────────────────────────────────────────────────────────
  // Oldest, most rural region in Japan. Retirees and rural traditionalists
  // together are half the electorate; youth presence near a national low.
  {
    _id: "SHI",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 9, economicLean: 1, socialLean: 2, turnout: 60 },
      urban_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 62 },
      rural_traditionalist: { population: 25, economicLean: 1, socialLean: 3, turnout: 70 },
      young_urban: { population: 5, economicLean: 0, socialLean: -2, turnout: 36 },
      retiree: { population: 25, economicLean: 0, socialLean: 2, turnout: 75 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 64 },
      komeito_faithful: { population: 3, economicLean: 0, socialLean: 1, turnout: 70 },
      reform_populist: { population: 4, economicLean: 3, socialLean: 0, turnout: 50 },
      working_mothers: { population: 5, economicLean: -1, socialLean: -2, turnout: 53 },
    },
    lastUpdated: new Date(),
  },
  // ── Kyushu & Okinawa ─────────────────────────────────────────────────────
  // Conservative mainland Kyushu, aging rapidly outside Fukuoka; Okinawa's
  // base politics keep a distinct progressive floor. Fukuoka is the region's
  // sole growth pole, holding the young/working-mother share above the
  // rural-Japan norm.
  {
    _id: "KYU",
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups: {
      salaryman_conservative: { population: 12, economicLean: 1, socialLean: 2, turnout: 61 },
      urban_progressive: { population: 10, economicLean: -2, socialLean: -3, turnout: 64 },
      rural_traditionalist: { population: 19, economicLean: 1, socialLean: 3, turnout: 69 },
      young_urban: { population: 8, economicLean: 0, socialLean: -2, turnout: 39 },
      retiree: { population: 20, economicLean: 0, socialLean: 2, turnout: 73 },
      public_sector: { population: 8, economicLean: -2, socialLean: -1, turnout: 63 },
      small_business: { population: 9, economicLean: 3, socialLean: 1, turnout: 65 },
      komeito_faithful: { population: 4, economicLean: 0, socialLean: 1, turnout: 71 },
      reform_populist: { population: 4, economicLean: 3, socialLean: 0, turnout: 52 },
      working_mothers: { population: 6, economicLean: -1, socialLean: -2, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
];
