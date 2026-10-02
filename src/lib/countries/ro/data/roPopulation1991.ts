/**
 * The first post-revolution county census was taken on 7 January 1992.
 * These are the census counts, used as the closest observed regional baseline
 * for the January 1991 scenario. Bucharest is separate from Ilfov county.
 * Source: Romanian census, Table 1.01 (1992),
 * https://www.recensamantromania.ro/rezultate-recensamant-1992/
 * County transcription: https://www.citypopulation.de/en/romania/admin/
 */
export const RO_1992_COUNTY_POPULATION = {
  Bucuresti: 2_067_545,
  Ilfov: 286_965,
  Alba: 413_919,
  Brasov: 643_261,
  Covasna: 233_256,
  Harghita: 348_335,
  Mures: 610_053,
  Sibiu: 452_873,
  Bacau: 737_512,
  Botosani: 461_305,
  Iasi: 811_342,
  Neamt: 578_420,
  Suceava: 701_830,
  Vaslui: 461_374,
  Bihor: 638_863,
  BistritaNasaud: 326_820,
  Cluj: 736_301,
  Maramures: 540_099,
  Salaj: 266_797,
  SatuMare: 400_789,
  Braila: 392_031,
  Buzau: 516_961,
  Constanta: 748_769,
  Galati: 641_011,
  Tulcea: 270_997,
  Vrancea: 393_408,
  Arges: 681_206,
  Calarasi: 338_804,
  Dambovita: 562_041,
  Giurgiu: 313_352,
  Ialomita: 306_145,
  Prahova: 874_349,
  Teleorman: 483_840,
  Dolj: 762_142,
  Gorj: 401_021,
  Mehedinti: 332_673,
  Olt: 523_291,
  Valcea: 438_388,
  Arad: 487_617,
  CarasSeverin: 376_347,
  Hunedoara: 547_950,
  Timis: 700_033,
} as const;

type County = keyof typeof RO_1992_COUNTY_POPULATION;

/** Every county appears exactly once in the game's seven macroregions. */
export const RO_1991_MACROREGION_COUNTIES = {
  RO_BUC: ["Bucuresti", "Ilfov"],
  RO_MUN: [
    "Arges",
    "Calarasi",
    "Dambovita",
    "Giurgiu",
    "Ialomita",
    "Prahova",
    "Teleorman",
    "Braila",
    "Buzau",
  ],
  RO_OLT: ["Dolj", "Gorj", "Mehedinti", "Olt", "Valcea"],
  RO_TRA: [
    "Alba",
    "Brasov",
    "Covasna",
    "Harghita",
    "Mures",
    "Sibiu",
    "BistritaNasaud",
    "Cluj",
    "Hunedoara",
  ],
  RO_VST: ["Arad", "CarasSeverin", "Timis", "Bihor", "Maramures", "Salaj", "SatuMare"],
  RO_MOL: ["Bacau", "Botosani", "Iasi", "Neamt", "Suceava", "Vaslui", "Galati", "Vrancea"],
  RO_DOB: ["Constanta", "Tulcea"],
} as const satisfies Record<string, readonly County[]>;

export const RO_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(RO_1991_MACROREGION_COUNTIES).map(([regionId, counties]) => [
    regionId,
    counties.reduce<number>((sum, county) => sum + RO_1992_COUNTY_POPULATION[county], 0),
  ])
) as Record<keyof typeof RO_1991_MACROREGION_COUNTIES, number>;
