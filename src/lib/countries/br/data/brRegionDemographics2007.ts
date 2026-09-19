import type { StateDemographics } from "@/lib/db/types";

/**
 * Brazil macro-region demographics — 2007 era (Lula second term, commodity boom).
 *
 * Era anchor: Lula re-elected in 2006 on the strength of Bolsa Família and
 * the China-driven commodity supercycle. The Nordeste is realigning hard
 * toward the PT (Lula carried it by landslide margins in 2006), flipping the
 * region from its 1990s clientelist pattern. Tens of millions are climbing
 * out of extreme poverty, so the urban_poor bloc shrinks while a "new middle
 * class" (classe C) expands. Agribusiness is booming in Mato Grosso and the
 * Centro-Oeste soy/cattle belt. Pentecostal/evangelical share ~22% and
 * increasingly courted by both camps but not yet uniformly right-aligned.
 *
 * Methodology: every population share, lean, and turnout was authored
 * independently from period evidence (2006 presidential results by region,
 * 2010 IBGE Census religion data interpolated back, mid-2000s Datafolha
 * class-mobility series) — no value is scaled or derived from the 2019
 * baseline file. Region IDs and group IDs are kept identical to
 * brRegionDemographics.ts; population shares sum to 100 per region;
 * turnouts follow the compulsory-voting convention.
 */
export const brRegionDemographics2007: StateDemographics[] = [
  // Norte: evangelical growth accelerating; Bolsa Família reach lifting the
  // river-community poor; deforestation-frontier agribusiness expanding.
  {
    _id: "NORTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 20, economicLean: 1, socialLean: 4, turnout: 77 },
      working_class_pt: { population: 15, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 19, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 9, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 18, economicLean: -4, socialLean: -1, turnout: 66 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -2, turnout: 61 },
      business_financial: { population: 4, economicLean: 3, socialLean: 1, turnout: 81 },
      young_progressive: { population: 7, economicLean: -2, socialLean: -3, turnout: 53 },
    },
    lastUpdated: new Date(),
  },

  // Nordeste: the great realignment — Bolsa Família and minimum-wage gains
  // turn the region into the PT's electoral base; working_class_pt surges
  // past its 1990s level while extreme poverty recedes.
  {
    _id: "NORDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 16, economicLean: 1, socialLean: 4, turnout: 77 },
      working_class_pt: { population: 19, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 13, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 9, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 24, economicLean: -4, socialLean: -1, turnout: 66 },
      afro_brazilian: { population: 11, economicLean: -2, socialLean: -2, turnout: 61 },
      business_financial: { population: 3, economicLean: 3, socialLean: 1, turnout: 81 },
      young_progressive: { population: 5, economicLean: -2, socialLean: -3, turnout: 53 },
    },
    lastUpdated: new Date(),
  },

  // Centro-Oeste: peak soy boom — Mato Grosso becomes the world soy capital;
  // rural_agribusiness near its high-water mark; Brasília middle class steady.
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 20, economicLean: 1, socialLean: 4, turnout: 77 },
      working_class_pt: { population: 12, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 27, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 15, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 11, economicLean: -4, socialLean: -1, turnout: 66 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 61 },
      business_financial: { population: 7, economicLean: 3, socialLean: 1, turnout: 81 },
      young_progressive: { population: 4, economicLean: -2, socialLean: -3, turnout: 53 },
    },
    lastUpdated: new Date(),
  },

  // Sudeste: classe C expansion swells the middle class; industrial PT base
  // softening as manufacturing's weight declines; finance thriving on the boom.
  {
    _id: "SUDESTE",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 16, economicLean: 1, socialLean: 4, turnout: 77 },
      working_class_pt: { population: 18, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 8, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 20, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 15, economicLean: -4, socialLean: -1, turnout: 66 },
      afro_brazilian: { population: 8, economicLean: -2, socialLean: -2, turnout: 61 },
      business_financial: { population: 10, economicLean: 3, socialLean: 1, turnout: 81 },
      young_progressive: { population: 5, economicLean: -2, socialLean: -3, turnout: 53 },
    },
    lastUpdated: new Date(),
  },

  // Sul: prosperous family-farm and export-agriculture economy; middle class
  // large; PT still competitive in Rio Grande do Sul's urban centers.
  {
    _id: "SUL",
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups: {
      evangelical_conservative: { population: 13, economicLean: 1, socialLean: 4, turnout: 77 },
      working_class_pt: { population: 16, economicLean: -3, socialLean: -1, turnout: 76 },
      rural_agribusiness: { population: 22, economicLean: 2, socialLean: 3, turnout: 72 },
      urban_middle_class: { population: 22, economicLean: 1, socialLean: 0, turnout: 78 },
      urban_poor: { population: 9, economicLean: -4, socialLean: -1, turnout: 66 },
      afro_brazilian: { population: 4, economicLean: -2, socialLean: -2, turnout: 61 },
      business_financial: { population: 10, economicLean: 3, socialLean: 1, turnout: 81 },
      young_progressive: { population: 4, economicLean: -2, socialLean: -3, turnout: 53 },
    },
    lastUpdated: new Date(),
  },
];
