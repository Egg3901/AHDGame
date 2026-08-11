import type { StateDemographics } from "@/lib/db/types";

/**
 * Nigeria geo-political zone demographic composition using the 8 NG voter
 * archetypes.
 *
 * Each region defines the population share of each archetype (summing to 100%)
 * plus baseline lean and turnout values. Regional character is expressed
 * through the population mix, not archetype-specific lean variation.
 *
 * `categoryWeights: { ng_voterGroups: 100 }` references the profile defined
 * in ngDemographicCategories.ts.
 *
 * Mix calibration is based on:
 * - 2019 / 2023 INEC presidential election results by geo-political zone
 * - NPC 2006 Census + NBS demographic projections
 * - Afrobarometer and NOI Polls regional polling
 *
 * Design principle: every archetype has a non-zero population in every zone —
 * regional character comes from mix weight, not exclusion. This is the STATIC
 * fallback used when the Layer-1 positions flag is off.
 */
export const ngRegionDemographics: StateDemographics[] = [
  // ── North-West ──────────────────────────────────────────────────────────────

  // North-West: Hausa-Fulani caliphate heartland; overwhelmingly Muslim and
  // rural; highest poverty and lowest education; APC northern stronghold.
  {
    _id: "NORTH_WEST",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 38, economicLean: 2, socialLean: 3, turnout: 45 },
      yoruba_moderate: { population: 4, economicLean: 0, socialLean: 0, turnout: 55 },
      igbo_business: { population: 2, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 2, economicLean: -2, socialLean: -1, turnout: 50 },
      christian_conservative: { population: 10, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 6, economicLean: -2, socialLean: -2, turnout: 40 },
      rural_agrarian: { population: 28, economicLean: 1, socialLean: 1, turnout: 35 },
      lagos_cosmopolitan: { population: 10, economicLean: 0, socialLean: -1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },

  // ── North-East ──────────────────────────────────────────────────────────────

  // North-East: Mixed Muslim/Christian; ethnically minority-heavy (Kanuri,
  // Fulani, Babur); conflict-affected; lowest income and urbanization; Borno,
  // Yobe, Adamawa; competitive but APC-leaning.
  {
    _id: "NORTH_EAST",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 28, economicLean: 2, socialLean: 3, turnout: 44 },
      yoruba_moderate: { population: 3, economicLean: 0, socialLean: 0, turnout: 55 },
      igbo_business: { population: 2, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 4, economicLean: -2, socialLean: -1, turnout: 48 },
      christian_conservative: { population: 18, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 6, economicLean: -2, socialLean: -2, turnout: 38 },
      rural_agrarian: { population: 32, economicLean: 1, socialLean: 1, turnout: 33 },
      lagos_cosmopolitan: { population: 7, economicLean: 0, socialLean: -1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },

  // ── North-Central (Middle Belt) ─────────────────────────────────────────────

  // North-Central: Middle Belt; religiously mixed; ethnically minority-heavy
  // (Tiv, Idoma, Igala, Nupe); Plateaus/Benue Christian farmers vs Fulani
  // pastoralist conflict; swing zone; FCT Abuja federal workforce.
  {
    _id: "NORTH_CENTRAL",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 18, economicLean: 2, socialLean: 3, turnout: 45 },
      yoruba_moderate: { population: 5, economicLean: 0, socialLean: 0, turnout: 55 },
      igbo_business: { population: 3, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 6, economicLean: -2, socialLean: -1, turnout: 50 },
      christian_conservative: { population: 28, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 10, economicLean: -2, socialLean: -2, turnout: 42 },
      rural_agrarian: { population: 22, economicLean: 1, socialLean: 1, turnout: 35 },
      lagos_cosmopolitan: { population: 8, economicLean: 0, socialLean: -1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },

  // ── South-West ──────────────────────────────────────────────────────────────

  // South-West: Yoruba heartland; most urbanised and educated; Lagos commercial
  // capital; ACN/APC lineage but PDP-competitive; ethnoregional calculus
  // drives swings (Obasanjo PDP, Tinubu APC).
  {
    _id: "SOUTH_WEST",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 8, economicLean: 2, socialLean: 3, turnout: 45 },
      yoruba_moderate: { population: 38, economicLean: 0, socialLean: 0, turnout: 56 },
      igbo_business: { population: 4, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 3, economicLean: -2, socialLean: -1, turnout: 50 },
      christian_conservative: { population: 14, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 12, economicLean: -2, socialLean: -2, turnout: 42 },
      rural_agrarian: { population: 7, economicLean: 1, socialLean: 1, turnout: 36 },
      lagos_cosmopolitan: { population: 14, economicLean: 0, socialLean: -1, turnout: 56 },
    },
    lastUpdated: new Date(),
  },

  // ── South-South (Niger Delta) ───────────────────────────────────────────────

  // South-South: Niger Delta minority nationalities; overwhelmingly Christian;
  // resource-control politics; PDP legacy through Jonathan; militant-amnesty
  // networks; environmental grievance against oil majors.
  {
    _id: "SOUTH_SOUTH",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 2, economicLean: 2, socialLean: 3, turnout: 45 },
      yoruba_moderate: { population: 4, economicLean: 0, socialLean: 0, turnout: 55 },
      igbo_business: { population: 6, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 38, economicLean: -2, socialLean: -1, turnout: 52 },
      christian_conservative: { population: 22, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 14, economicLean: -2, socialLean: -2, turnout: 42 },
      rural_agrarian: { population: 8, economicLean: 1, socialLean: 1, turnout: 35 },
      lagos_cosmopolitan: { population: 6, economicLean: 0, socialLean: -1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },

  // ── South-East ──────────────────────────────────────────────────────────────

  // South-East: Igbo heartland; overwhelmingly Christian; commercially oriented;
  // APGA/Ohanaeze; strong sense of federal marginalisation; historically PDP
  // but volatile; highest tertiary attainment outside South-West.
  {
    _id: "SOUTH_EAST",
    countryId: "NG",
    categoryWeights: { ng_voterGroups: 100 },
    groups: {
      northern_muslim_conservative: { population: 2, economicLean: 2, socialLean: 3, turnout: 45 },
      yoruba_moderate: { population: 3, economicLean: 0, socialLean: 0, turnout: 55 },
      igbo_business: { population: 48, economicLean: 1, socialLean: -1, turnout: 60 },
      niger_delta_youth: { population: 8, economicLean: -2, socialLean: -1, turnout: 50 },
      christian_conservative: { population: 18, economicLean: 1, socialLean: 2, turnout: 50 },
      urban_young_progressive: { population: 12, economicLean: -2, socialLean: -2, turnout: 42 },
      rural_agrarian: { population: 6, economicLean: 1, socialLean: 1, turnout: 35 },
      lagos_cosmopolitan: { population: 3, economicLean: 0, socialLean: -1, turnout: 55 },
    },
    lastUpdated: new Date(),
  },
];
