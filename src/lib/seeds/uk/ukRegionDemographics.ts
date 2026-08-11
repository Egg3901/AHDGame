import type { StateDemographics } from "@/lib/db/types";

/**
 * UK region demographics using UK voter archetypes.
 *
 * Each region has a composition of the 12 UK voter groups (populations sum to 100%).
 * Economic and social leans are calibrated to actual voting patterns in each region.
 *
 * The `categoryWeights` uses `uk_voterGroups: 100` to match the UK demographic
 * profile ID ("uk_archetypes") defined in CountryConfig.
 *
 * All values are approximate estimates based on:
 * - 2019 UK General Election results by region
 * - 2021 UK Census regional data
 * - British Election Study wave data
 *
 * Design principle: every archetype has a non-zero population in every region.
 * Regional character is expressed through the population mix, not dedicated
 * regional-identity slots that are zeroed out elsewhere.
 *
 * Group IDs match ukDemographicCategories.ts `uk_voterGroups` groups.
 */
export const ukRegionDemographics: StateDemographics[] = [
  // ── London ─────────────────────────────────────────────────────────────────
  // Young, diverse, progressive, heavy public sector. Overwhelmingly Labour/LD.
  {
    _id: "LON",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 6, economicLean: -2, socialLean: 1, turnout: 52 },
      urban_progressives: { population: 20, economicLean: -3, socialLean: -4, turnout: 74 },
      suburban_homeowners: { population: 7, economicLean: 2, socialLean: 1, turnout: 68 },
      young_renters: { population: 17, economicLean: -1, socialLean: -4, turnout: 58 },
      rural_traditionalists: { population: 2, economicLean: 3, socialLean: 3, turnout: 65 },
      retirees: { population: 5, economicLean: 1, socialLean: 2, turnout: 70 },
      public_sector: { population: 9, economicLean: -3, socialLean: -2, turnout: 68 },
      moderate_centrists: { population: 8, economicLean: 0, socialLean: -2, turnout: 67 },
      populist_right: { population: 5, economicLean: 1, socialLean: 3, turnout: 50 },
      green_activists: { population: 5, economicLean: -4, socialLean: -5, turnout: 63 },
      small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 12, economicLean: -2, socialLean: -1, turnout: 50 },
    },
    lastUpdated: new Date(),
  },
  // ── South East England ─────────────────────────────────────────────────────
  // Commuter belt and Home Counties. Tory heartland with strong centrist flank.
  {
    _id: "SEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 10, economicLean: -2, socialLean: 2, turnout: 55 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 70 },
      suburban_homeowners: { population: 18, economicLean: 2, socialLean: 2, turnout: 72 },
      young_renters: { population: 9, economicLean: -1, socialLean: -4, turnout: 55 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 73 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 74 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 67 },
      moderate_centrists: { population: 11, economicLean: 0, socialLean: -2, turnout: 68 },
      populist_right: { population: 8, economicLean: 1, socialLean: 4, turnout: 55 },
      green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 60 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 71 },
      new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── South West England ─────────────────────────────────────────────────────
  // Rural, coastal, strong centrist tradition, high retiree population.
  {
    _id: "SWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 9, economicLean: -2, socialLean: 2, turnout: 55 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 53 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 73 },
      retirees: { population: 13, economicLean: 1, socialLean: 3, turnout: 75 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 17, economicLean: 0, socialLean: -2, turnout: 68 },
      populist_right: { population: 7, economicLean: 1, socialLean: 4, turnout: 56 },
      green_activists: { population: 4, economicLean: -4, socialLean: -5, turnout: 62 },
      small_business: { population: 6, economicLean: 3, socialLean: 1, turnout: 70 },
      new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 47 },
    },
    lastUpdated: new Date(),
  },
  // ── East of England ────────────────────────────────────────────────────────
  // Mix of commuter belt, fenland, and market towns. Tory/Reform-leaning.
  {
    _id: "EAE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 11, economicLean: -2, socialLean: 2, turnout: 55 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 16, economicLean: 2, socialLean: 2, turnout: 71 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 53 },
      rural_traditionalists: { population: 14, economicLean: 3, socialLean: 3, turnout: 72 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 74 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 10, economicLean: 0, socialLean: -2, turnout: 67 },
      populist_right: { population: 9, economicLean: 1, socialLean: 4, turnout: 56 },
      green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 60 },
      small_business: { population: 7, economicLean: 3, socialLean: 1, turnout: 70 },
      new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 46 },
    },
    lastUpdated: new Date(),
  },
  // ── East Midlands ──────────────────────────────────────────────────────────
  // Post-industrial towns (Derby, Nottingham) and diverse Leicester. Brexit-era
  // Tory flip; high Reform presence.
  {
    _id: "EMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 57 },
      urban_progressives: { population: 5, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 13, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 11, economicLean: 3, socialLean: 3, turnout: 72 },
      retirees: { population: 10, economicLean: 1, socialLean: 3, turnout: 73 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 7, economicLean: 0, socialLean: -2, turnout: 65 },
      populist_right: { population: 10, economicLean: 1, socialLean: 4, turnout: 57 },
      green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 60 },
      small_business: { population: 5, economicLean: 3, socialLean: 1, turnout: 68 },
      new_britons: { population: 7, economicLean: -2, socialLean: -1, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── West Midlands ──────────────────────────────────────────────────────────
  // Birmingham's diverse population, Coventry/Wolverhampton post-industrial mix.
  {
    _id: "WMI",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 17, economicLean: -2, socialLean: 2, turnout: 57 },
      urban_progressives: { population: 8, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 12, economicLean: 2, socialLean: 2, turnout: 70 },
      young_renters: { population: 10, economicLean: -1, socialLean: -3, turnout: 52 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 9, economicLean: 1, socialLean: 3, turnout: 72 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
      populist_right: { population: 10, economicLean: 1, socialLean: 4, turnout: 57 },
      green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 60 },
      small_business: { population: 4, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 10, economicLean: -2, socialLean: -1, turnout: 49 },
    },
    lastUpdated: new Date(),
  },
  // ── Yorkshire & the Humber ─────────────────────────────────────────────────
  // Red Wall heartland. Post-industrial towns, high Reform vote. Bradford adds
  // significant South Asian community. Sheffield/Leeds add urban progressives.
  {
    _id: "YHU",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 58 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 67 },
      suburban_homeowners: { population: 10, economicLean: 2, socialLean: 2, turnout: 69 },
      young_renters: { population: 9, economicLean: -1, socialLean: -3, turnout: 52 },
      rural_traditionalists: { population: 10, economicLean: 3, socialLean: 3, turnout: 71 },
      retirees: { population: 11, economicLean: 1, socialLean: 3, turnout: 73 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
      populist_right: { population: 13, economicLean: 1, socialLean: 4, turnout: 57 },
      green_activists: { population: 2, economicLean: -4, socialLean: -5, turnout: 61 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 6, economicLean: -2, socialLean: -1, turnout: 48 },
    },
    lastUpdated: new Date(),
  },
  // ── North West England ─────────────────────────────────────────────────────
  // Manchester–Liverpool corridor. Strong Labour tradition, diverse cities,
  // Reform-leaning outer towns. Large post-industrial working class.
  {
    _id: "NWE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 20, economicLean: -2, socialLean: 2, turnout: 58 },
      urban_progressives: { population: 9, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 69 },
      young_renters: { population: 10, economicLean: -1, socialLean: -3, turnout: 52 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 11, economicLean: 1, socialLean: 3, turnout: 72 },
      public_sector: { population: 4, economicLean: -3, socialLean: -2, turnout: 66 },
      moderate_centrists: { population: 6, economicLean: 0, socialLean: -2, turnout: 65 },
      populist_right: { population: 12, economicLean: 1, socialLean: 4, turnout: 56 },
      green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 61 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 66 },
      new_britons: { population: 7, economicLean: -2, socialLean: -1, turnout: 49 },
    },
    lastUpdated: new Date(),
  },
  // ── North East England ─────────────────────────────────────────────────────
  // Most Labour-voting region in England. Very high post-industrial share.
  // High Reform vote. Low ethnic diversity. Newcastle/Sunderland/Durham.
  {
    _id: "NEE",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 25, economicLean: -3, socialLean: 2, turnout: 57 },
      urban_progressives: { population: 7, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 8, economicLean: 2, socialLean: 2, turnout: 68 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 7, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 72 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 5, economicLean: 0, socialLean: -2, turnout: 63 },
      populist_right: { population: 16, economicLean: 1, socialLean: 4, turnout: 58 },
      green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 62 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 46 },
    },
    lastUpdated: new Date(),
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  // Left-of-centre overall. Glasgow/central belt post-industrial, Edinburgh
  // urban/centrist, Highlands rural. Scotland's political character is modelled
  // through a left-leaning population mix rather than a dedicated nationalist slot.
  {
    _id: "SCO",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 17, economicLean: -2, socialLean: 1, turnout: 62 },
      urban_progressives: { population: 13, economicLean: -3, socialLean: -3, turnout: 68 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 68 },
      young_renters: { population: 11, economicLean: -1, socialLean: -3, turnout: 55 },
      rural_traditionalists: { population: 9, economicLean: 3, socialLean: 3, turnout: 68 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 73 },
      public_sector: { population: 7, economicLean: -3, socialLean: -2, turnout: 67 },
      moderate_centrists: { population: 9, economicLean: 0, socialLean: -2, turnout: 65 },
      populist_right: { population: 4, economicLean: 1, socialLean: 3, turnout: 50 },
      green_activists: { population: 4, economicLean: -4, socialLean: -5, turnout: 62 },
      small_business: { population: 3, economicLean: 3, socialLean: 1, turnout: 67 },
      new_britons: { population: 2, economicLean: -2, socialLean: -1, turnout: 47 },
    },
    lastUpdated: new Date(),
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  // South Wales valleys post-industrial, mid/west Wales rural. Wales is the
  // UK's most public-sector-dependent nation (~30% of employment). Strong Labour
  // tradition in the valleys; Plaid Cymru appeal modelled through left-leaning mix.
  {
    _id: "WAL",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 18, economicLean: -3, socialLean: 1, turnout: 60 },
      urban_progressives: { population: 8, economicLean: -3, socialLean: -3, turnout: 66 },
      suburban_homeowners: { population: 9, economicLean: 2, socialLean: 2, turnout: 68 },
      young_renters: { population: 8, economicLean: -1, socialLean: -3, turnout: 50 },
      rural_traditionalists: { population: 13, economicLean: 3, socialLean: 3, turnout: 70 },
      retirees: { population: 12, economicLean: 1, socialLean: 3, turnout: 72 },
      public_sector: { population: 14, economicLean: -3, socialLean: -2, turnout: 67 },
      moderate_centrists: { population: 5, economicLean: 0, socialLean: -2, turnout: 62 },
      populist_right: { population: 7, economicLean: 1, socialLean: 4, turnout: 55 },
      green_activists: { population: 3, economicLean: -4, socialLean: -5, turnout: 60 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 65 },
      new_britons: { population: 1, economicLean: -2, socialLean: -1, turnout: 45 },
    },
    lastUpdated: new Date(),
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  // NI's unique political character (unionist/nationalist divide) is modelled
  // through the population mix rather than sectarian labels:
  // - populist_right captures socially-conservative unionist sentiment
  // - post_industrial_workers captures cross-community working class
  // - moderate_centrists captures the Alliance Party's cross-community surge
  {
    _id: "NIR",
    countryId: "UK",
    categoryWeights: { uk_voterGroups: 100 },
    groups: {
      post_industrial_workers: { population: 18, economicLean: -2, socialLean: 2, turnout: 58 },
      urban_progressives: { population: 10, economicLean: -3, socialLean: -3, turnout: 62 },
      suburban_homeowners: { population: 6, economicLean: 2, socialLean: 2, turnout: 62 },
      young_renters: { population: 8, economicLean: -1, socialLean: -2, turnout: 50 },
      rural_traditionalists: { population: 8, economicLean: 3, socialLean: 3, turnout: 65 },
      retirees: { population: 7, economicLean: 1, socialLean: 3, turnout: 68 },
      public_sector: { population: 5, economicLean: -3, socialLean: -2, turnout: 65 },
      moderate_centrists: { population: 14, economicLean: 0, socialLean: -2, turnout: 64 },
      populist_right: { population: 20, economicLean: 1, socialLean: 4, turnout: 63 },
      green_activists: { population: 1, economicLean: -4, socialLean: -5, turnout: 58 },
      small_business: { population: 2, economicLean: 3, socialLean: 1, turnout: 62 },
      new_britons: { population: 1, economicLean: -2, socialLean: -1, turnout: 44 },
    },
    lastUpdated: new Date(),
  },
];

export default ukRegionDemographics;
