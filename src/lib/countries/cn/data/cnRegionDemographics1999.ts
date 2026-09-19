import type { StateDemographics } from "@/lib/db/types";

/**
 * China macro-region demographics — 1999 era.
 *
 * Era anchor: the SOE-reform layoff wave (1997–2001) is devastating the
 * northeast rust belt — industrial workers remain the dominant Dongbei bloc
 * but are shrinking and embittered; "xiagang" laid-off workers swell the
 * disaffected urban poor. The coastal export economy is still building:
 * Guangdong/Fujian/Zhejiang host an early entrepreneur class (SEZ legacy)
 * and the first large migrant waves, but pre-WTO flows are a fraction of
 * what comes later. National urbanization sits around 35%, so rural
 * peasants are the plurality almost everywhere inland, and the urban
 * professional class is thin outside Beijing and Shanghai.
 *
 * Methodology: every value here was authored independently from historical
 * knowledge of 1999 China (NBS-era urbanization rates, SOE employment
 * shares, pre-WTO migration estimates) — NOT scaled or derived from the
 * 2019 baseline file. Province IDs and group IDs match the 2019 file;
 * populations per region sum to 100. Leans follow the 2019 convention of
 * uniform per-archetype values: industrial workers lean further left
 * (economicLean -2) reflecting layoff-era grievance; entrepreneurs are
 * less consolidated as a political class (lower turnout); migrant turnout
 * is depressed by hukou exclusion at its harshest.
 */
export const cnRegionDemographics1999: StateDemographics[] = [
  // ── Dongbei (Northeast) ────────────────────────────────────────────────────
  // Epicentre of the SOE layoff crisis. Industrial workers still the largest
  // bloc; rural share high; entrepreneurs and migrants barely present.
  {
    _id: "DB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 20, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 10, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 26, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 32, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 3, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 4, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Huabei (North) ─────────────────────────────────────────────────────────
  // Beijing/Tianjin core — heaviest cadre concentration; professional class
  // still modest; surrounding Hebei deeply rural and industrial.
  {
    _id: "HB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 24, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 14, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 24, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 22, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 5, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 5, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Huadong (East) ─────────────────────────────────────────────────────────
  // Shanghai plus a still-largely-rural Yangtze hinterland. Zhejiang private
  // economy emerging; migrants arriving but pre-WTO volumes are modest.
  {
    _id: "HD",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 17, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 18, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 22, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 22, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 8, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 8, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Huazhong (Central) ─────────────────────────────────────────────────────
  // Agricultural heartland — rural peasants dominate; provincial capitals
  // hold small professional and cadre cores.
  {
    _id: "HZ",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 17, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 9, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 38, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 20, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 6, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 4, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Huanan (South) ─────────────────────────────────────────────────────────
  // Pearl River Delta — first SEZ generation. Largest migrant and
  // entrepreneur shares in 1999 China, though the boom is still young.
  {
    _id: "HN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 14, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 16, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 22, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 22, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 12, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 9, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Xinan (Southwest) ──────────────────────────────────────────────────────
  // Deeply rural interior pre-Western-Development drive; out-migration to
  // the coast only beginning.
  {
    _id: "XN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 16, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 7, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 48, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 14, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 6, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 3, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },

  // ── Xibei (Northwest) ──────────────────────────────────────────────────────
  // Frontier region — overwhelmingly rural in 1999, strong state/cadre
  // presence, minimal private economy.
  {
    _id: "XB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 19, economicLean: 0, socialLean: 3, turnout: 96 },
      urban_professional: { population: 6, economicLean: 2, socialLean: 0, turnout: 87 },
      rural_peasant: { population: 52, economicLean: -2, socialLean: 2, turnout: 84 },
      industrial_worker: { population: 12, economicLean: -2, socialLean: 1, turnout: 85 },
      migrant_worker: { population: 4, economicLean: -2, socialLean: 1, turnout: 58 },
      entrepreneur: { population: 3, economicLean: 3, socialLean: 0, turnout: 86 },
      youth: { population: 4, economicLean: 1, socialLean: -1, turnout: 80 },
    },
    lastUpdated: new Date(),
  },
];
