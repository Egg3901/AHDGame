import type { StateDemographics } from "@/lib/db/types";

/**
 * Ireland planning region demographic composition using the 8 IE voter archetypes.
 *
 * Each region defines the population share of each archetype (summing to 100%)
 * plus baseline lean and turnout values. Regional character is expressed
 * through the population mix, not archetype-specific lean variation.
 *
 * `categoryWeights: { ie_voterGroups: 100 }` references the profile defined
 * in ieDemographicCategories.ts.
 *
 * Mix calibration is based on:
 * - 2020 and 2024 Dáil Éireann election results by constituency
 * - Reliable polling (Ireland Thinks, Red C Research)
 * - 2022 CSO regional demographic profiles
 *
 * Design principle: Dublin has more urban_professional, young_urban, and
 * new_irish; rural regions have more rural_traditional, retirees, and
 * small_business; the Border region has a markedly higher border_communities
 * share.
 */
export const ieRegionDemographics: StateDemographics[] = [
  // ── Leinster ───────────────────────────────────────────────────────────────

  // Dublin: Ireland's capital and economic hub — tech FDI, finance, young
  // mobile workforce. Highest urban_professional and new_irish. SF surge in
  // working-class suburbs; FG/FF still strong in south Dublin.
  {
    _id: "DUB",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 22, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 5, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 14, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 16, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 10, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 12, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 15, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 6, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // Kildare region: Commuter belt counties (Kildare, Meath, Wicklow). Rapid
  // population growth, suburban overspill from Dublin. Mix of urban
  // professionals and traditional rural communities.
  {
    _id: "KIL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 18, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 14, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 12, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 10, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 16, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 14, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 10, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 6, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // Midlands: Laois, Longford, Offaly, Westmeath. Largely rural, lower
  // income, heavier reliance on traditional agriculture and local services.
  {
    _id: "MID",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 10, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 22, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 15, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 6, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 20, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 16, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 7, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 4, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // Wexford region: Carlow, Kilkenny, Tipperary, Waterford, Wexford. Strong
  // agricultural and food-processing base; Waterford city provides some
  // urban-professional presence.
  {
    _id: "WEX",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 12, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 20, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 15, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 7, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 18, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 16, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 8, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 4, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // ── Munster ────────────────────────────────────────────────────────────────

  // Limerick region: Clare, Limerick, North Tipperary. Limerick city is the urban
  // anchor; Clare has significant wind-energy industry and rural character.
  {
    _id: "LIM",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 14, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 18, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 14, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 7, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 18, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 15, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 8, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 6, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // Cork region: Cork city and county, Kerry. Ireland's second city drives
  // professional employment; Kerry is rural and tourist-oriented.
  {
    _id: "COR",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 16, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 16, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 13, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 8, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 17, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 14, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 10, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 6, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // ── Connacht ───────────────────────────────────────────────────────────────

  // Galway region: Galway city and county, Mayo, Roscommon. Galway is a university
  // and tech hub; west Mayo and Roscommon are remote and agricultural.
  {
    _id: "GAL",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 10, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 24, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 12, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 5, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 20, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 16, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 8, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 5, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },

  // ── Ulster (Republic portion) ──────────────────────────────────────────────

  // Donegal region: Cavan, Donegal, Leitrim, Louth, Monaghan, Sligo. Defined by the
  // partition border and cross-community ties. Highest border_communities
  // share of any region; strong Sinn Féin presence; lower incomes; Brexit
  // impact on trade and identity.
  {
    _id: "DON",
    countryId: "IE" as const,
    categoryWeights: { ie_voterGroups: 100 },
    groups: {
      urban_professional: { population: 8, economicLean: 2, socialLean: -2, turnout: 68 },
      rural_traditional: { population: 20, economicLean: 1, socialLean: 2, turnout: 72 },
      working_class: { population: 14, economicLean: -3, socialLean: 0, turnout: 58 },
      new_irish: { population: 5, economicLean: -1, socialLean: -2, turnout: 45 },
      small_business: { population: 16, economicLean: 2, socialLean: 1, turnout: 74 },
      retirees: { population: 14, economicLean: 0, socialLean: 1, turnout: 80 },
      young_urban: { population: 7, economicLean: -2, socialLean: -3, turnout: 46 },
      border_communities: { population: 16, economicLean: -1, socialLean: -1, turnout: 65 },
    },
    lastUpdated: new Date(),
  },
];
