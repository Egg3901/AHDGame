import type { StateDemographics } from "@/lib/db/types";

/**
 * Brazil macro-region demographics — 2023 era (Lula III after Bolsonaro).
 *
 * Era anchor: Lula narrowly defeats Bolsonaro in 2022 (50.9–49.1), the
 * tightest race since redemocratization, and takes office days before the
 * January 8 Brasília riots. Evangelicals are ~30% of the population and now
 * a cohesive right-aligned bloc (harder social lean, high mobilization).
 * Agro states (Centro-Oeste, interior Sul) are deeply bolsonarista; the
 * Nordeste is the PT's unshakeable stronghold (Lula ~69% there in 2022).
 * The urban middle class is sharply polarized rather than centrist, and a
 * visible young progressive bloc has emerged in the state capitals.
 *
 * Methodology: every population share, lean, and turnout was authored
 * independently from period evidence (2022 TSE second-round results by
 * region, 2022 IBGE Census religion releases, Datafolha/Quaest 2022-23
 * polling) — no value is scaled or derived from the 2019 baseline file.
 * Region IDs and group IDs are kept identical to brRegionDemographics.ts;
 * population shares sum to 100 per region; turnouts follow the
 * compulsory-voting convention.
 */
export const brRegionDemographics2023: StateDemographics[] = [
  // Norte: among the most evangelical regions in the country; Rondônia/Roraima
  // deeply bolsonarista while river communities and Pará lean PT.
  {
    _id: "NORTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 27, economicLean: 2, socialLean: 5, turnout: 82 },
      working_class_pt: { population: 15, economicLean: -3, socialLean: -1, turnout: 77 },
      rural_agribusiness: { population: 18, economicLean: 3, socialLean: 4, turnout: 74 },
      urban_middle_class: { population: 10, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 13, economicLean: -4, socialLean: -1, turnout: 69 },
      afro_brazilian: { population: 7, economicLean: -2, socialLean: -2, turnout: 63 },
      business_financial: { population: 4, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 6, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // Nordeste: the PT fortress — two decades of transfer-program loyalty plus
  // regional identity politics; evangelical growth is the main countervailing
  // force even here.
  {
    _id: "NORDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 23, economicLean: 2, socialLean: 5, turnout: 82 },
      working_class_pt: { population: 21, economicLean: -3, socialLean: -1, turnout: 77 },
      rural_agribusiness: { population: 11, economicLean: 3, socialLean: 4, turnout: 74 },
      urban_middle_class: { population: 10, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 18, economicLean: -4, socialLean: -1, turnout: 69 },
      afro_brazilian: { population: 9, economicLean: -2, socialLean: -2, turnout: 63 },
      business_financial: { population: 3, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 5, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // Centro-Oeste: Bolsonaro's strongest region in 2022 — agro-evangelical
  // alignment at its maximum; the two right blocs together exceed half the
  // electorate.
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 28, economicLean: 2, socialLean: 5, turnout: 82 },
      working_class_pt: { population: 11, economicLean: -3, socialLean: -1, turnout: 77 },
      rural_agribusiness: { population: 28, economicLean: 3, socialLean: 4, turnout: 74 },
      urban_middle_class: { population: 13, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 7, economicLean: -4, socialLean: -1, turnout: 69 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 63 },
      business_financial: { population: 6, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 3, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // Sudeste: ground zero of polarization — bolsonarista interior São Paulo
  // and Rio's evangelical periphery against PT-leaning urban poor and a
  // growing young progressive bloc in the capitals.
  {
    _id: "SUDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 21, economicLean: 2, socialLean: 5, turnout: 82 },
      working_class_pt: { population: 15, economicLean: -3, socialLean: -1, turnout: 77 },
      rural_agribusiness: { population: 7, economicLean: 3, socialLean: 4, turnout: 74 },
      urban_middle_class: { population: 19, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 13, economicLean: -4, socialLean: -1, turnout: 69 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -2, turnout: 63 },
      business_financial: { population: 10, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 7, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },

  // Sul: solidly bolsonarista outside the Porto Alegre/Curitiba/Florianópolis
  // urban cores; evangelical share has caught up with the national trend.
  {
    _id: "SUL",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 19, economicLean: 2, socialLean: 5, turnout: 82 },
      working_class_pt: { population: 13, economicLean: -3, socialLean: -1, turnout: 77 },
      rural_agribusiness: { population: 20, economicLean: 3, socialLean: 4, turnout: 74 },
      urban_middle_class: { population: 21, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 8, economicLean: -4, socialLean: -1, turnout: 69 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 63 },
      business_financial: { population: 9, economicLean: 3, socialLean: 1, turnout: 82 },
      young_progressive: { population: 6, economicLean: -3, socialLean: -4, turnout: 58 },
    },
    lastUpdated: new Date(),
  },
];
