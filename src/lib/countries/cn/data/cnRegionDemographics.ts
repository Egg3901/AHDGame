import type { StateDemographics } from "@/lib/db/types";

/**
 * China macro-region demographic composition using the 7 CN voter archetypes.
 *
 * Each region defines the population share of each archetype (summing to 100%)
 * plus baseline lean and turnout values. Regional character is expressed
 * through the population mix, not archetype-specific lean variation.
 *
 * `categoryWeights: { cn_voterGroups: 100 }` references the profile defined
 * in cnDemographicCategories.ts.
 *
 * Mix calibration is based on:
 * - Regional GDP, urbanization, and industrial composition data
 * - NBS (National Bureau of Statistics) 2022 population profiles
 * - Hukou registration and migrant worker flow estimates
 *
 * Design principle: every archetype has a non-zero population in every
 * region — regional character comes from mix weight, not exclusion.
 */
export const cnRegionDemographics: StateDemographics[] = [
  // ── Dongbei (Northeast) ────────────────────────────────────────────────────
  // Aging rust belt with heavy industrial worker concentration and legacy
  // state enterprise party cadre presence. Low youth retention.
  {
    _id: "DB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 18, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 16, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 18, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 28, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 6, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 8, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huabei (North) ─────────────────────────────────────────────────────────
  // Includes Beijing and Tianjin — high party cadre concentration (capital),
  // large urban professional class, strong administrative presence.
  {
    _id: "HB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 20, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 22, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 14, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 18, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 8, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 10, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 8, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huadong (East) ─────────────────────────────────────────────────────────
  // Shanghai-Yangtze corridor — China's wealthiest region. Dominant urban
  // professional class, high entrepreneur share, large migrant worker inflow.
  {
    _id: "HD",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 14, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 30, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 8, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 16, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 12, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 14, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huazhong (Central) ─────────────────────────────────────────────────────
  // Interior agricultural heartland with growing urban centres (Wuhan, Zhengzhou).
  // High rural peasant and industrial worker shares.
  {
    _id: "HZ",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 16, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 14, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 24, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 22, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 10, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 8, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huanan (South) ─────────────────────────────────────────────────────────
  // Guangdong-Pearl River powerhouse — export manufacturing hub, high migrant
  // worker inflow, strong private entrepreneur class (Shenzhen SEZ legacy).
  {
    _id: "HN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 13, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 28, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 10, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 18, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 14, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 12, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Xinan (Southwest) ──────────────────────────────────────────────────────
  // Hydropower-rich interior with diverse ethnic minority populations. High
  // rural peasant share, lower urbanization, significant migrant outflow.
  {
    _id: "XN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 15, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 12, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 32, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 16, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 12, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 7, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Xibei (Northwest) ──────────────────────────────────────────────────────
  // Frontier region with significant ethnic minority presence, low urbanization,
  // large rural peasant share, high state security and party cadre presence.
  {
    _id: "XB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 17, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 10, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 38, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 14, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 8, economicLean: -2, socialLean: 1, turnout: 65 },
      entrepreneur: { population: 6, economicLean: 3, socialLean: 1, turnout: 90 },
      youth: { population: 7, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },
];
