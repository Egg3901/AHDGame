/**
 * Population by the 49 voivodeships in force at the January 1991 start.
 * Source: GUS, Rocznik statystyczny województw 1991, table 1 (15),
 * "Ludność", population at 31 December 1990, in thousands. The yearbook
 * marks these figures as estimates. PDF page 76 (printed page 74):
 * https://istmat.org/files/uploads/51494/rocznik_statystyczny_wojewodztw_1991.pdf
 *
 * The game's eight PL regions are macroregions, not the 49 contemporary
 * voivodeships. Each source row appears in exactly one macroregion below.
 * Values are people (the source's one-decimal thousands multiplied by 1,000).
 */
export const PL_1991_VOIVODESHIP_POPULATION = {
  Warszawskie: 2_421_600,
  Bialskopodlaskie: 305_300,
  Bialostockie: 692_800,
  Bielskie: 900_200,
  Bydgoskie: 1_110_800,
  Chelmskie: 247_200,
  Ciechanowskie: 428_400,
  Czestochowskie: 776_700,
  Elblaskie: 478_900,
  Gdanskie: 1_431_600,
  Gorzowskie: 500_700,
  Jeleniogorskie: 517_900,
  Kaliskie: 710_800,
  Katowickie: 3_988_800,
  Kieleckie: 1_126_700,
  Koninskie: 469_200,
  Koszalinskie: 508_200,
  Krakowskie: 1_231_600,
  Krosnienskie: 495_000,
  Legnickie: 515_800,
  Leszczynskie: 386_800,
  Lubelskie: 1_016_400,
  Lomzynskie: 346_700,
  Lodzkie: 1_139_500,
  Nowosadeckie: 697_900,
  Olsztynskie: 753_000,
  Opolskie: 1_018_600,
  Ostroleckie: 397_300,
  Pilskie: 480_700,
  Piotrkowskie: 642_600,
  Plockie: 516_400,
  Poznanskie: 1_334_100,
  Przemyskie: 406_800,
  Radomskie: 751_100,
  Rzeszowskie: 723_700,
  Siedleckie: 651_400,
  Sieradzkie: 408_200,
  Skierniewickie: 419_300,
  Slupskie: 413_800,
  Suwalskie: 470_600,
  Szczecinskie: 972_100,
  Tarnobrzeskie: 599_100,
  Tarnowskie: 670_300,
  Torunskie: 659_100,
  Walbrzyskie: 740_900,
  Wloclawskie: 429_400,
  Wroclawskie: 1_128_800,
  Zamojskie: 490_400,
  Zielonogorskie: 660_000,
} as const;

type Voivodeship = keyof typeof PL_1991_VOIVODESHIP_POPULATION;

/** Geographic aggregation into the eight existing game macroregions. */
export const PL_1991_MACROREGION_VOIVODESHIPS = {
  PL_MAZ: ["Warszawskie", "Ciechanowskie", "Ostroleckie", "Plockie", "Radomskie", "Siedleckie"],
  PL_LOD: ["Lodzkie", "Piotrkowskie", "Sieradzkie", "Skierniewickie", "Kieleckie"],
  PL_MAL: ["Krakowskie", "Nowosadeckie", "Tarnowskie", "Rzeszowskie", "Krosnienskie", "Przemyskie"],
  PL_SLK: ["Katowickie", "Bielskie", "Czestochowskie", "Opolskie"],
  PL_DSL: ["Wroclawskie", "Walbrzyskie", "Jeleniogorskie", "Legnickie", "Zielonogorskie"],
  PL_WLK: ["Poznanskie", "Kaliskie", "Koninskie", "Leszczynskie", "Pilskie", "Gorzowskie"],
  PL_POM: [
    "Gdanskie",
    "Slupskie",
    "Szczecinskie",
    "Koszalinskie",
    "Elblaskie",
    "Bydgoskie",
    "Torunskie",
    "Wloclawskie",
    "Olsztynskie",
  ],
  PL_EAS: [
    "Lubelskie",
    "Chelmskie",
    "Zamojskie",
    "Bialskopodlaskie",
    "Bialostockie",
    "Lomzynskie",
    "Suwalskie",
    "Tarnobrzeskie",
  ],
} as const satisfies Record<string, readonly Voivodeship[]>;

export const PL_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(PL_1991_MACROREGION_VOIVODESHIPS).map(([regionId, voivodeships]) => [
    regionId,
    voivodeships.reduce<number>((sum, name) => sum + PL_1991_VOIVODESHIP_POPULATION[name], 0),
  ])
) as Record<keyof typeof PL_1991_MACROREGION_VOIVODESHIPS, number>;
