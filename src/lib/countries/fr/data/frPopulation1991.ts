/**
 * 1990 census population for the 22 metropolitan regions then in force.
 * These are the people present at the January 1991 world start. The eight
 * game macroregions partition the 22 census regions exactly once.
 * Source: French Government, Decree 99-1154, Annex Table A, 1990 column:
 * https://www.legifrance.gouv.fr/loda/id/JORFTEXT000000398186/
 */
export const FR_1990_CENSUS_REGION_POPULATION = {
  Alsace: 1_624_372,
  Aquitaine: 2_795_830,
  Auvergne: 1_321_214,
  Bourgogne: 1_609_653,
  Bretagne: 2_795_638,
  Centre: 2_371_036,
  ChampagneArdenne: 1_347_848,
  Corse: 250_371,
  FrancheComte: 1_097_276,
  IleDeFrance: 10_660_554,
  LanguedocRoussillon: 2_114_985,
  Limousin: 722_850,
  Lorraine: 2_305_726,
  MidiPyrenees: 2_430_663,
  NordPasDeCalais: 3_965_058,
  BasseNormandie: 1_391_318,
  HauteNormandie: 1_737_247,
  PaysDeLaLoire: 3_059_112,
  Picardie: 1_810_687,
  PoitouCharentes: 1_595_109,
  ProvenceAlpesCoteDAzur: 4_257_907,
  RhoneAlpes: 5_350_701,
} as const;

type CensusRegion = keyof typeof FR_1990_CENSUS_REGION_POPULATION;

export const FR_1991_MACROREGION_CENSUS_REGIONS = {
  FR_IDF: ["IleDeFrance"],
  FR_NOR: ["NordPasDeCalais", "Picardie"],
  FR_EST: ["Alsace", "Lorraine", "ChampagneArdenne", "FrancheComte"],
  FR_OUE: ["Bretagne", "PaysDeLaLoire", "BasseNormandie", "HauteNormandie"],
  FR_SOU: ["Aquitaine", "MidiPyrenees", "PoitouCharentes", "Limousin"],
  FR_ARA: ["Auvergne", "RhoneAlpes"],
  FR_MED: ["ProvenceAlpesCoteDAzur", "LanguedocRoussillon", "Corse"],
  FR_CEN: ["Centre", "Bourgogne"],
} as const satisfies Record<string, readonly CensusRegion[]>;

export const FR_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(FR_1991_MACROREGION_CENSUS_REGIONS).map(([id, regions]) => [
    id,
    regions.reduce<number>((sum, region) => sum + FR_1990_CENSUS_REGION_POPULATION[region], 0),
  ])
) as Record<keyof typeof FR_1991_MACROREGION_CENSUS_REGIONS, number>;
