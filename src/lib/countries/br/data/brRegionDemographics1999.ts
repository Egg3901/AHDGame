import type { StateDemographics } from "@/lib/db/types";

/**
 * Brazil macro-region demographics — 1999 era (Cardoso second term).
 *
 * Era anchor: post-Plano Real stabilization under Fernando Henrique Cardoso.
 * Inflation tamed but the 1999 currency crisis bites; inequality at its
 * historical peak (Gini ~0.60), so the urban_poor bloc is at its largest.
 * Pentecostal/evangelical share ~18% of the population and not yet a
 * cohesive political force (softer social lean, lower mobilization).
 * The PT is consolidated in the urban-industrial belts of the Sudeste and
 * Sul (ABC paulista, Porto Alegre's participatory-budget era) — NOT yet in
 * the Nordeste, which remains dominated by traditional clientelist machines
 * (PFL/PMDB). The business/financial bloc is strong and confident after the
 * privatization wave (Telebrás, Vale, state banks). Centro-Oeste agribusiness
 * is growing but the soy/cattle boom has not yet peaked.
 *
 * Methodology: every population share, lean, and turnout was authored
 * independently from period evidence (1998 presidential results by region,
 * 2000 IBGE Census religion/income profiles, late-1990s Datafolha series) —
 * no value is scaled or derived from the 2019 baseline file. Region IDs and
 * group IDs are kept identical to brRegionDemographics.ts; population shares
 * sum to 100 per region; turnouts follow the compulsory-voting convention.
 */
export const brRegionDemographics1999: StateDemographics[] = [
  // Norte: frontier expansion era; large informal urban poor in Belém/Manaus;
  // evangelical growth underway but below later peaks; weak PT machine.
  {
    _id: "NORTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 16, economicLean: 1, socialLean: 3, turnout: 74 },
      working_class_pt: { population: 12, economicLean: -3, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 20, economicLean: 2, socialLean: 3, turnout: 70 },
      urban_middle_class: { population: 9, economicLean: 1, socialLean: 1, turnout: 76 },
      urban_poor: { population: 22, economicLean: -3, socialLean: 0, turnout: 64 },
      afro_brazilian: { population: 9, economicLean: -2, socialLean: -1, turnout: 60 },
      business_financial: { population: 4, economicLean: 4, socialLean: 1, turnout: 80 },
      young_progressive: { population: 8, economicLean: -2, socialLean: -2, turnout: 52 },
    },
    lastUpdated: new Date(),
  },

  // Nordeste: pre-Bolsa Família — deepest poverty in the country, electorate
  // controlled by traditional oligarchic machines (PFL/PMDB), PT still weak;
  // largest urban_poor bloc anywhere in this seed.
  {
    _id: "NORDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 13, economicLean: 1, socialLean: 3, turnout: 74 },
      working_class_pt: { population: 14, economicLean: -3, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 16, economicLean: 2, socialLean: 3, turnout: 70 },
      urban_middle_class: { population: 8, economicLean: 1, socialLean: 1, turnout: 76 },
      urban_poor: { population: 28, economicLean: -3, socialLean: 0, turnout: 64 },
      afro_brazilian: { population: 12, economicLean: -2, socialLean: -1, turnout: 60 },
      business_financial: { population: 3, economicLean: 4, socialLean: 1, turnout: 80 },
      young_progressive: { population: 6, economicLean: -2, socialLean: -2, turnout: 52 },
    },
    lastUpdated: new Date(),
  },

  // Centro-Oeste: agribusiness expanding into the cerrado but pre-boom;
  // Brasília civil-service middle class already prominent.
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 16, economicLean: 1, socialLean: 3, turnout: 74 },
      working_class_pt: { population: 11, economicLean: -3, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 24, economicLean: 2, socialLean: 3, turnout: 70 },
      urban_middle_class: { population: 16, economicLean: 1, socialLean: 1, turnout: 76 },
      urban_poor: { population: 14, economicLean: -3, socialLean: 0, turnout: 64 },
      afro_brazilian: { population: 5, economicLean: -2, socialLean: -1, turnout: 60 },
      business_financial: { population: 8, economicLean: 4, socialLean: 1, turnout: 80 },
      young_progressive: { population: 6, economicLean: -2, socialLean: -2, turnout: 52 },
    },
    lastUpdated: new Date(),
  },

  // Sudeste: PT's industrial heartland (ABC paulista metalworkers) at its
  // organizational peak; São Paulo finance riding the privatization wave;
  // middle class loyal to the Real and to FHC's PSDB.
  {
    _id: "SUDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 13, economicLean: 1, socialLean: 3, turnout: 74 },
      working_class_pt: { population: 20, economicLean: -3, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 8, economicLean: 2, socialLean: 3, turnout: 70 },
      urban_middle_class: { population: 21, economicLean: 1, socialLean: 1, turnout: 76 },
      urban_poor: { population: 16, economicLean: -3, socialLean: 0, turnout: 64 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -1, turnout: 60 },
      business_financial: { population: 9, economicLean: 4, socialLean: 1, turnout: 80 },
      young_progressive: { population: 5, economicLean: -2, socialLean: -2, turnout: 52 },
    },
    lastUpdated: new Date(),
  },

  // Sul: Porto Alegre participatory-budget PT plus strong family-farm and
  // urban middle-class blocs; lowest poverty in the country.
  {
    _id: "SUL",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 10, economicLean: 1, socialLean: 3, turnout: 74 },
      working_class_pt: { population: 18, economicLean: -3, socialLean: -1, turnout: 72 },
      rural_agribusiness: { population: 24, economicLean: 2, socialLean: 3, turnout: 70 },
      urban_middle_class: { population: 22, economicLean: 1, socialLean: 1, turnout: 76 },
      urban_poor: { population: 10, economicLean: -3, socialLean: 0, turnout: 64 },
      afro_brazilian: { population: 3, economicLean: -2, socialLean: -1, turnout: 60 },
      business_financial: { population: 9, economicLean: 4, socialLean: 1, turnout: 80 },
      young_progressive: { population: 4, economicLean: -2, socialLean: -2, turnout: 52 },
    },
    lastUpdated: new Date(),
  },
];
