import type { StateDemographics } from "@/lib/db/types";

/**
 * Ireland planning region demographics — 1979 era (pre-Celtic-Tiger,
 * Haughey-era Ireland).
 *
 * Authored independently from the historical record of late-1970s Ireland —
 * NOT derived by scaling the 2019 dataset.
 *
 * Era anchors:
 * - Heavily agrarian economy: agriculture still ~20% of employment; rural
 *   Catholic-conservative communities dominate everywhere outside Dublin.
 * - Urban professional class is tiny — pre-FDI, pre-IFSC; emigration of
 *   educated youth to Britain/US is the norm.
 * - new_irish is essentially zero (Ireland is a country of emigration; the
 *   1% kept is statistical floor for returned emigrants / small minorities).
 * - Very young population (post-1960s baby boom) but young voters were
 *   largely within the FF/FG duopoly, not socially radical.
 * - FF machine politics; clientelism; strong Church influence (divorce and
 *   contraception still restricted) — social leans skew strongly conservative.
 * - Border counties living through the Troubles' worst decade — elevated
 *   border_communities salience, republican economic-left lean.
 * - Turnout: 1977/1981 general elections ~76%; civic participation high
 *   across all cohorts, lowest among the young and marginal.
 *
 * Same region/group IDs and shape as ieRegionDemographics.ts; only
 * populations, leans, and turnouts differ.
 */
export const ieRegionDemographics1979: StateDemographics[] = [
  // ── Leinster ───────────────────────────────────────────────────────────────

  // Dublin 1979: large working-class inner city and corporation estates,
  // big young cohort, small professional/civil-service middle class.
  {
    _id: "DUB",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 10, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 8, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 28, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 12, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 12, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 22, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 7, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // Kildare/Meath/Wicklow 1979: still predominantly farming counties; the
  // Dublin commuter belt has barely begun to form.
  {
    _id: "KIL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 6, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 28, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 18, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 16, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 14, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 11, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 6, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // Midlands 1979: small-farm heartland, Bord na Móna and ESB the main
  // industrial employers; deepest rural-traditional share in Leinster.
  {
    _id: "MID",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 3, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 38, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 16, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 18, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 14, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 6, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 4, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // South-East 1979: tillage and dairy farming; Waterford glass and port
  // give a modest industrial working class.
  {
    _id: "WEX",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 4, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 36, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 17, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 17, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 14, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 7, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 4, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // ── Munster ────────────────────────────────────────────────────────────────

  // Mid-West 1979: Shannon industrial zone is the one outpost of FDI;
  // Limerick city working class plus a deeply rural hinterland.
  {
    _id: "LIM",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 5, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 32, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 19, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 16, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 13, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 8, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 6, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // Cork/Kerry 1979: Cork's Ford and Dunlop plants still open (closing in the
  // early 80s); Kerry overwhelmingly small-farm and emigration-marked.
  {
    _id: "COR",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 7, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 28, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 20, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 16, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 13, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 9, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 6, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // ── Connacht ───────────────────────────────────────────────────────────────

  // West 1979: the most agrarian region in the state — smallholdings,
  // Gaeltacht communities, chronic emigration; Galway city still small.
  {
    _id: "GAL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 3, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 40, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 13, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 18, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 14, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 6, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 5, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },

  // ── Ulster (Republic portion) ──────────────────────────────────────────────

  // Border 1979: the Troubles' worst decade — checkpoints, smuggling economy,
  // refugee inflow from the North; high border_communities salience.
  {
    _id: "DON",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 2, economicLean: 2, socialLean: -1, turnout: 78 },
      rural_traditional: { population: 36, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class: { population: 15, economicLean: -3, socialLean: 2, turnout: 70 },
      new_irish: { population: 1, economicLean: 0, socialLean: 0, turnout: 40 },
      small_business: { population: 14, economicLean: 2, socialLean: 3, turnout: 80 },
      retirees: { population: 13, economicLean: 0, socialLean: 4, turnout: 84 },
      young_urban: { population: 5, economicLean: -1, socialLean: 0, turnout: 62 },
      border_communities: { population: 14, economicLean: -2, socialLean: 1, turnout: 72 },
    },
    lastUpdated: new Date(),
  },
];
