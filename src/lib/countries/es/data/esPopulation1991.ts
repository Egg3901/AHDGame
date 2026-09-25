/**
 * Spain's 1991 census counts by autonomous community, plus Ceuta and Melilla.
 * The eight game macroregions partition the census geography exactly once.
 * Source: Instituto Nacional de Estadística, Anuario Estadístico de España
 * 2013, table 2.1.1, "Censo 1991" column:
 * https://www.ine.es/prodyser/pubweb/anuario13/anu13_02demog.pdf
 */
export const ES_1991_CENSUS_POPULATION = {
  Andalucia: 6_940_522,
  Aragon: 1_188_817,
  Asturias: 1_093_937,
  Balears: 709_138,
  Canarias: 1_493_784,
  Cantabria: 527_326,
  CastillaLeon: 2_545_926,
  CastillaLaMancha: 1_658_446,
  Cataluna: 6_059_494,
  Valencia: 3_857_234,
  Extremadura: 1_061_852,
  Galicia: 2_731_669,
  Madrid: 4_947_555,
  Murcia: 1_045_601,
  Navarra: 519_277,
  PaisVasco: 2_104_041,
  Rioja: 263_434,
  Ceuta: 67_615,
  Melilla: 56_600,
} as const;

type CensusRegion = keyof typeof ES_1991_CENSUS_POPULATION;

export const ES_1991_MACROREGION_CENSUS_REGIONS = {
  ES_MAD: ["Madrid"],
  ES_CAT: ["Cataluna"],
  ES_AND: ["Andalucia"],
  ES_VAL: ["Valencia", "Murcia"],
  ES_PVB: ["PaisVasco", "Navarra"],
  ES_GAL: ["Galicia"],
  ES_NOR: ["Asturias", "Cantabria", "Rioja", "Aragon"],
  ES_CEN: [
    "CastillaLeon",
    "CastillaLaMancha",
    "Extremadura",
    "Balears",
    "Canarias",
    "Ceuta",
    "Melilla",
  ],
} as const satisfies Record<string, readonly CensusRegion[]>;

export const ES_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(ES_1991_MACROREGION_CENSUS_REGIONS).map(([id, regions]) => [
    id,
    regions.reduce<number>((sum, region) => sum + ES_1991_CENSUS_POPULATION[region], 0),
  ])
) as Record<keyof typeof ES_1991_MACROREGION_CENSUS_REGIONS, number>;
