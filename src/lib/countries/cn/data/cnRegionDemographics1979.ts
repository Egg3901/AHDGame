import type { StateDemographics } from "@/lib/db/types";

/**
 * China macro-region demographics — 1979 era (start of reform and opening).
 *
 * Era anchor: Deng Xiaoping's reforms have just begun. National urbanization
 * is ~19%. The commune system is only starting to dissolve, so rural peasants
 * dominate every region (roughly half to three-quarters of population even in
 * the most industrialized belts). The SOE industrial workforce is concentrated
 * in the Northeast (Daqing, Anshan), Beijing-Tianjin, Shanghai, and the Wuhan
 * corridor. Private entrepreneurs are essentially non-existent (getihu barely
 * legalized), migrant workers near zero (hukou rigidly enforced, communes just
 * ending), and the urban professional class is tiny after the Cultural
 * Revolution gutted higher education. Party cadres are present everywhere via
 * the danwei/commune apparatus.
 *
 * Methodology: every value is authored independently from historical knowledge
 * of 1979 provincial conditions — NOT scaled or multiplied from the 2019 file.
 * Conventions match cnRegionDemographics.ts: populations per region sum to
 * 100; every archetype keeps a non-zero floor; regional character is expressed
 * through population mix; leans follow the 2019 regime-alignment semantics.
 * Era-specific turnout adjustments: entrepreneurs (politically marginal,
 * ideologically suspect in 1979) and migrant workers (no urban standing)
 * carry reduced mobilization values.
 */
export const cnRegionDemographics1979: StateDemographics[] = [
  // ── Dongbei (Northeast) ────────────────────────────────────────────────────
  // China's premier heavy-industry base in 1979 — Daqing oil, Anshan steel.
  // Highest industrial worker share in the country, but still ~half rural.
  {
    _id: "DB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 16, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 5, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 48, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 22, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 7, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huabei (North) ─────────────────────────────────────────────────────────
  // Beijing-Tianjin administrative and industrial core surrounded by deeply
  // rural Hebei/Shanxi/Inner Mongolia. Heaviest cadre concentration (capital).
  {
    _id: "HB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 18, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 7, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 52, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 14, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 7, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huadong (East) ─────────────────────────────────────────────────────────
  // Shanghai is China's largest industrial city, but the surrounding Yangtze
  // delta provinces are overwhelmingly agricultural in 1979.
  {
    _id: "HD",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 14, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 6, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 58, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 13, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 7, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huazhong (Central) ─────────────────────────────────────────────────────
  // Agricultural heartland; Wuhan's steel complex is the lone heavy-industry
  // pole in an otherwise peasant-dominated interior.
  {
    _id: "HZ",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 13, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 4, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 64, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 11, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 6, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Huanan (South) ─────────────────────────────────────────────────────────
  // Pre-SEZ Guangdong — Shenzhen is still a fishing town in 1979. Light
  // industry only; the region is agricultural and poor relative to the north.
  {
    _id: "HN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 12, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 4, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 66, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 9, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 7, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Xinan (Southwest) ──────────────────────────────────────────────────────
  // Overwhelmingly rural and poor; Third Front factories (Sichuan, Guizhou)
  // provide a small industrial nucleus amid a peasant supermajority.
  {
    _id: "XN",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 12, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 3, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 72, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 6, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },

  // ── Xibei (Northwest) ──────────────────────────────────────────────────────
  // Frontier region — rural supermajority, elevated cadre presence via state
  // farms, bingtuan, and security apparatus; minimal industry outside Lanzhou.
  {
    _id: "XB",
    countryId: "CN",
    categoryWeights: { cn_voterGroups: 100 },
    groups: {
      party_cadre: { population: 14, economicLean: 0, socialLean: 3, turnout: 95 },
      urban_professional: { population: 3, economicLean: 2, socialLean: 0, turnout: 88 },
      rural_peasant: { population: 70, economicLean: -2, socialLean: 2, turnout: 82 },
      industrial_worker: { population: 6, economicLean: -1, socialLean: 1, turnout: 86 },
      migrant_worker: { population: 1, economicLean: -2, socialLean: 1, turnout: 55 },
      entrepreneur: { population: 1, economicLean: 3, socialLean: 1, turnout: 70 },
      youth: { population: 5, economicLean: 1, socialLean: -1, turnout: 78 },
    },
    lastUpdated: new Date(),
  },
];
