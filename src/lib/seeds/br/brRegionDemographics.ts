import type { StateDemographics } from "@/lib/db/types";

/**
 * Brazil macro-region demographic composition using the 8 BR voter archetypes.
 *
 * Each region defines the population share of each archetype (summing to 100%)
 * plus baseline lean and turnout values. Regional character is expressed
 * through the population mix, not archetype-specific lean variation.
 *
 * `categoryWeights: { br_voterGroups: 100 }` references the profile defined
 * in brDemographicCategories.ts.
 *
 * Mix calibration is based on:
 * - 2022 TSE presidential election results by IBGE macro-region
 * - IBGE 2022 Census demographic profiles
 * - DataFolha and Ipespe regional polling
 *
 * Design principle: every archetype has a non-zero population in every region —
 * regional character comes from mix weight, not exclusion.
 */
export const brRegionDemographics: StateDemographics[] = [
  // ── Norte ──────────────────────────────────────────────────────────────────

  // Norte: Amazon frontier; youngest region; high evangelical share and
  // rural agribusiness frontier; indigenous and river-communities PT lean.
  {
    _id: "NORTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 24, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class_pt: { population: 16, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 18, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 10, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 14, economicLean: -4, socialLean: -1, turnout: 68 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -2, turnout: 62 },
      business_financial: { population: 4, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 54 },
    },
    lastUpdated: new Date(),
  },

  // ── Nordeste ───────────────────────────────────────────────────────────────

  // Nordeste: PT heartland through Bolsa Família; highest poverty and
  // unemployment; strong Afro-Brazilian heritage; evangelical growth.
  {
    _id: "NORDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 20, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class_pt: { population: 20, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 12, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 10, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 20, economicLean: -4, socialLean: -1, turnout: 68 },
      afro_brazilian: { population: 10, economicLean: -2, socialLean: -2, turnout: 62 },
      business_financial: { population: 3, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 5, economicLean: -2, socialLean: -3, turnout: 54 },
    },
    lastUpdated: new Date(),
  },

  // ── Centro-Oeste ───────────────────────────────────────────────────────────

  // Centro-Oeste: Agribusiness boom; Bancada Ruralista stronghold; Brasília
  // federal workforce; fastest GDP growth; Bolsonaro's strongest region in 2022.
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 25, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class_pt: { population: 12, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 28, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 14, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 8, economicLean: -4, socialLean: -1, turnout: 68 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 62 },
      business_financial: { population: 6, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 3, economicLean: -2, socialLean: -3, turnout: 54 },
    },
    lastUpdated: new Date(),
  },

  // ── Sudeste ────────────────────────────────────────────────────────────────

  // Sudeste: Brazil's economic engine; São Paulo financial capital; diverse
  // electorate balancing PT urban poor with anti-PT middle class; highest
  // business_financial concentration.
  {
    _id: "SUDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 18, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class_pt: { population: 16, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 8, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 20, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 14, economicLean: -4, socialLean: -1, turnout: 68 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -2, turnout: 62 },
      business_financial: { population: 10, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 54 },
    },
    lastUpdated: new Date(),
  },

  // ── Sul ────────────────────────────────────────────────────────────────────

  // Sul: European-heritage states; strongest social cohesion; lowest poverty;
  // highest urban_middle_class and rural_agribusiness mix; Bolsonaro stronghold
  // outside the northeast PT base.
  {
    _id: "SUL",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 16, economicLean: 1, socialLean: 4, turnout: 80 },
      working_class_pt: { population: 14, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 20, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 22, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 8, economicLean: -4, socialLean: -1, turnout: 68 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 62 },
      business_financial: { population: 10, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 6, economicLean: -2, socialLean: -3, turnout: 54 },
    },
    lastUpdated: new Date(),
  },
];
