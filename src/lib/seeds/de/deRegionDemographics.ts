import type { StateDemographics } from "@/lib/db/types";

/**
 * German Bundesländer demographic composition using the 12 DE voter archetypes.
 *
 * Each Land defines the population share of each archetype (summing to 100%)
 * plus baseline lean and turnout values. Regional character is expressed
 * through the population mix, not archetype-specific lean variation — fine-
 * tuning per-Land lean/turnout is a future enhancement.
 *
 * `categoryWeights: { de_voterGroups: 100 }` references the profile defined
 * in deDemographicCategories.ts.
 *
 * Mix calibration is based on:
 * - 2021 Bundestag Zweitstimmen by Land
 * - Reliable polling (ARD Deutschlandtrend, Forschungsgruppe Wahlen)
 * - 2022 Destatis regional demographic profiles
 *
 * Design principle: every archetype has a non-zero population in every Land
 * (or close to it) — regional character comes from mix weight, not exclusion.
 * A few archetypes are legitimately ~zero in some Länder (e.g. Landwirte in
 * city-states like Berlin or Bremen).
 */
export const deRegionDemographics: StateDemographics[] = [
  // ── Süden ──────────────────────────────────────────────────────────────────

  // Baden-Württemberg: Mittelstand heartland, strong CDU but Stuttgart liberal,
  // major Greens stronghold (Winfried Kretschmann MP-ship).
  {
    _id: "BW",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 14, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 9, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 14, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 14, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 13, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 9, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 6, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 1, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 7, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Bayern: CSU heartland, highest Catholic concentration, strong Mittelstand,
  // Munich is the urban-progressive outlier.
  {
    _id: "BY",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 22, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 8, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 11, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 9, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 14, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 9, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 2, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 6, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // ── Westen ─────────────────────────────────────────────────────────────────

  // Nordrhein-Westfalen: Ruhr gewerkschafter base, diverse cities
  // (Cologne, Düsseldorf, Essen), heavy migrant-background communities.
  {
    _id: "NW",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 12, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 16, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 9, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 10, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 9, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 12, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 13, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 4, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 5, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 6, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Hessen: Frankfurt financial centre + rural north. High wirtschaftsliberale.
  {
    _id: "HE",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 13, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 9, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 11, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 12, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 11, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 11, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 10, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 6, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 6, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 7, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Rheinland-Pfalz: Rural/suburban, Catholic, Mittelstand.
  {
    _id: "RP",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 16, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 9, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 8, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 8, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 12, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 11, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 14, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Saarland: Small industrial state, SPD-leaning, high gewerkschafter.
  {
    _id: "SL",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 12, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 17, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 7, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 6, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 14, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 8, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 5, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 3, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 18, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // ── Norden ─────────────────────────────────────────────────────────────────

  // Niedersachsen: Mixed agricultural + industrial (VW/Wolfsburg),
  // Hannover is the urban centre.
  {
    _id: "NI",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 8, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 14, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 9, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 9, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 13, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 7, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 12, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 5, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 11, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Schleswig-Holstein: Coastal, rural, CDU-FDP tradition, strong Grüne.
  {
    _id: "SH",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 6, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 8, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 8, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 10, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 12, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 15, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 5, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 11, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 17, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Hamburg: Progressive port city-state, affluent Hanseatic tradition.
  {
    _id: "HH",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 3, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 10, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 18, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 11, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 13, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 10, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 10, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 1, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 14, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 2, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 7, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Bremen: Smallest state, SPD stronghold, high gewerkschafter + migranten.
  {
    _id: "BRE",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 3, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 17, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 15, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 6, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 1, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 11, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 10, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 14, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 1, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 12, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 3, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 7, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // ── Osten ──────────────────────────────────────────────────────────────────

  // Berlin: Only city-state on the old West/East divide — high urbane
  // progressive, junge großstadt, migranten, and legacy ost-post-industriell.
  {
    _id: "BE",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 3, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 7, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 19, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 7, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 8, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 10, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 7, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 12, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 0, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 17, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 5, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 5, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Brandenburg: Surrounds Berlin, rural east, strong AfD + Linke presence.
  {
    _id: "BB",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 3, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 8, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 5, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 5, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 21, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 6, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 6, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 3, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 12, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 5, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 22, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 4, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Mecklenburg-Vorpommern: Rural east, highest protest-vote concentration
  // alongside Saxony-Anhalt.
  {
    _id: "MV",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 2, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 6, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 4, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 4, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 24, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 4, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 5, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 2, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 15, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 27, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 3, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Sachsen: Strongest AfD Land by vote share; Leipzig/Dresden urban-progressive
  // counterweight.
  {
    _id: "SN",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 3, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 8, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 5, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 20, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 5, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 5, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 3, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 8, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 5, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 26, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 5, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Sachsen-Anhalt: Aging rural east, deep AfD-Linke polarisation.
  {
    _id: "ST",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 2, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 7, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 5, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 4, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 24, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 4, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 5, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 2, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 13, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 27, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 3, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },

  // Thüringen: Mixed east, Linke's strongest Land (Ramelow era) + AfD.
  {
    _id: "TH",
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups: {
      katholische_konservative: { population: 4, economicLean: 2, socialLean: 2, turnout: 82 },
      gewerkschafter: { population: 8, economicLean: -3, socialLean: 0, turnout: 78 },
      urbane_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 80 },
      wirtschaftsliberale: { population: 5, economicLean: 3, socialLean: -1, turnout: 83 },
      ost_post_industriell: { population: 23, economicLean: -2, socialLean: 2, turnout: 70 },
      gruene_mittelschicht: { population: 5, economicLean: -1, socialLean: -4, turnout: 85 },
      rentner_west: { population: 5, economicLean: 1, socialLean: 2, turnout: 86 },
      migranten_communities: { population: 3, economicLean: -1, socialLean: -2, turnout: 62 },
      landwirte_dorf: { population: 11, economicLean: 1, socialLean: 3, turnout: 80 },
      junge_grossstadt: { population: 4, economicLean: -3, socialLean: -4, turnout: 63 },
      protest_waehler_ost: { population: 24, economicLean: 0, socialLean: 4, turnout: 72 },
      mittelstand_selbstaendige: { population: 2, economicLean: 3, socialLean: 1, turnout: 82 },
    },
    lastUpdated: new Date(),
  },
];
