/**
 * 1990 fourth-census provincial population for China's January 1991 start.
 * The seven game macroregions partition the 30 mainland provinces and
 * municipalities. Military personnel (3,199,100) were reported separately
 * by the census and are outside these regional civilian populations.
 * Source: National Bureau of Statistics, Fourth Census Communique No. 2:
 * https://www.stats.gov.cn/sj/tjgb/rkpcgb/qgrkpcgb/202302/t20230206_1901991.html
 */
export const CN_1990_CENSUS_PROVINCE_POPULATION = {
  Beijing: 10_819_407,
  Tianjin: 8_785_402,
  Hebei: 61_082_439,
  Shanxi: 28_759_014,
  InnerMongolia: 21_456_798,
  Liaoning: 39_459_697,
  Jilin: 24_658_721,
  Heilongjiang: 35_214_873,
  Shanghai: 13_341_896,
  Jiangsu: 67_056_519,
  Zhejiang: 41_445_930,
  Anhui: 56_180_813,
  // The published Fujian row includes 49,050 people on Kinmen and Matsu,
  // outside the mainland area represented by the game region.
  Fujian: 30_097_274 - 49_050,
  Jiangxi: 37_710_281,
  Shandong: 84_392_827,
  Henan: 85_509_535,
  Hubei: 53_969_210,
  Hunan: 60_659_754,
  Guangdong: 62_829_236,
  Guangxi: 42_245_765,
  Hainan: 6_557_482,
  Sichuan: 107_218_173,
  Guizhou: 32_391_066,
  Yunnan: 36_972_610,
  Tibet: 2_196_010,
  Shaanxi: 32_882_403,
  Gansu: 22_371_141,
  Qinghai: 4_456_946,
  Ningxia: 4_655_451,
  Xinjiang: 15_155_778,
} as const;

type Province = keyof typeof CN_1990_CENSUS_PROVINCE_POPULATION;

export const CN_1991_MACROREGION_PROVINCES = {
  DB: ["Liaoning", "Jilin", "Heilongjiang"],
  HB: ["Beijing", "Tianjin", "Hebei", "Shanxi", "InnerMongolia"],
  HD: ["Shanghai", "Jiangsu", "Zhejiang", "Anhui", "Fujian", "Jiangxi", "Shandong"],
  HZ: ["Henan", "Hubei", "Hunan"],
  HN: ["Guangdong", "Guangxi", "Hainan"],
  XN: ["Sichuan", "Guizhou", "Yunnan", "Tibet"],
  XB: ["Shaanxi", "Gansu", "Qinghai", "Ningxia", "Xinjiang"],
} as const satisfies Record<string, readonly Province[]>;

export const CN_1991_MACROREGION_POPULATION = Object.fromEntries(
  Object.entries(CN_1991_MACROREGION_PROVINCES).map(([id, provinces]) => [
    id,
    provinces.reduce<number>(
      (sum, province) => sum + CN_1990_CENSUS_PROVINCE_POPULATION[province],
      0
    ),
  ])
) as Record<keyof typeof CN_1991_MACROREGION_PROVINCES, number>;
