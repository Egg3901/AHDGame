import type { StateDemographics } from "@/lib/db/types";

/**
 * Ireland planning region demographics — 1991 era (recession tail,
 * pre-Tiger Ireland).
 *
 * Authored independently from the historical record of early-1990s Ireland —
 * NOT derived by multiplying the 2019 dataset (this file replaces the old
 * stateDemographics1991 multiplier approach for IE).
 *
 * Era anchors:
 * - Tail of the 1980s fiscal crisis: unemployment ~15%, emigration just past
 *   its late-80s peak — the young cohort is hollowed out relative to 1979.
 * - Urban professionals growing slowly (IFSC founded 1987, early FDI in
 *   pharma/electronics) but still a small class.
 * - new_irish remains negligible (~1-2%) — net migration still outward.
 * - Secularization beginning: Mary Robinson elected 1990, X case looming
 *   (1992); social conservatism softening from the 1979 peak but rural
 *   Ireland remains devout.
 * - Troubles at full intensity in the border counties — peak
 *   border_communities salience, hardest-hit local economies.
 * - Turnout: 1989 general election ~68.5%; declining from the late-70s highs,
 *   weakest among the unemployed young.
 *
 * Same region/group IDs and shape as ieRegionDemographics.ts; only
 * populations, leans, and turnouts differ.
 */
export const ieRegionDemographics1991: StateDemographics[] = [
  // ── Leinster ───────────────────────────────────────────────────────────────

  // Dublin 1991: high inner-city unemployment and heroin crisis; nascent
  // IFSC professional class; large but emigration-thinned young cohort.
  {
    _id: "DUB",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 13, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 7, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 26, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 2, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 12, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 13, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 20, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 7, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // Kildare/Meath/Wicklow 1991: commuter-belt growth has started (Intel
  // arrives in Leixlip 1989) but the counties are still substantially rural.
  {
    _id: "KIL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 9, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 24, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 17, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 2, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 16, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 15, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 11, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 6, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // Midlands 1991: agriculture and semi-state employment contracting;
  // among the regions hardest hit by 80s emigration.
  {
    _id: "MID",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 5, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 33, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 17, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 1, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 19, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 15, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 6, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 4, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // South-East 1991: agri-food base intact but Waterford Crystal in crisis;
  // persistent above-average unemployment.
  {
    _id: "WEX",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 6, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 31, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 17, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 2, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 18, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 15, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 7, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 4, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // ── Munster ────────────────────────────────────────────────────────────────

  // Mid-West 1991: Shannon zone and early electronics FDI cushion the
  // recession somewhat; Limerick city working class under strain.
  {
    _id: "LIM",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 7, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 28, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 18, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 2, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 17, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 14, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 8, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 6, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // Cork/Kerry 1991: Ford/Dunlop closures absorbed; pharma cluster in
  // Ringaskiddy emerging; Kerry still rural and emigration-marked.
  {
    _id: "COR",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 9, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 25, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 19, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 2, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 17, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 14, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 8, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 6, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // ── Connacht ───────────────────────────────────────────────────────────────

  // West 1991: still the most agrarian region; Galway city/UCG growing but
  // small; Knock airport (1986) symbolic of peripheral self-help.
  {
    _id: "GAL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 5, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 35, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 13, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 1, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 19, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 15, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 7, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 5, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },

  // ── Ulster (Republic portion) ──────────────────────────────────────────────

  // Border 1991: Troubles at peak local intensity — closed roads, army
  // checkpoints, cross-border trade strangled; highest border share of any era.
  {
    _id: "DON",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 3, economicLean: 2, socialLean: -1, turnout: 72 },
      rural_traditional: { population: 31, economicLean: 1, socialLean: 3, turnout: 76 },
      working_class: { population: 15, economicLean: -3, socialLean: 1, turnout: 64 },
      new_irish: { population: 1, economicLean: -1, socialLean: -1, turnout: 40 },
      small_business: { population: 15, economicLean: 2, socialLean: 2, turnout: 76 },
      retirees: { population: 14, economicLean: 0, socialLean: 3, turnout: 82 },
      young_urban: { population: 5, economicLean: -1, socialLean: -1, turnout: 52 },
      border_communities: { population: 16, economicLean: -2, socialLean: 0, turnout: 68 },
    },
    lastUpdated: new Date(),
  },
];
