/**
 * Population of the eight Yugoslav republic/province game regions at the
 * March 1991 censuses. Kosovo is the official estimate rather than the
 * enumerated count because the census was widely boycotted there.
 *
 * Sources by row:
 * - Slovenia: https://www.stat.si/doc/pub/rr776-2002/1/t01-01-00.htm
 * - Croatia: https://web.dzs.hr/eng/censuses/census2011/results/htm/usp_03_EN.htm
 * - Bosnia and Herzegovina: https://bhas.gov.ba/data/Publikacije/Bilteni/2018/DEM_00_2016_TB_1_BS.pdf
 * - Serbia proper and Vojvodina: https://www.stat.gov.rs/oblasti/popis/prethodni-popisi/popisni-podaci-eksel-tabele/
 * - Kosovo: https://www.stat.gov.rs/sr-latn/vesti/20240222-uporedni-pregled-br-stanovnika-i-domacinstava/
 * - Montenegro and Macedonia: Federal Statistical Office 1991 census as
 *   reproduced in https://stnv.idn.org.rs/article/download/69/62/129
 */
export const YU_1991_REGION_POPULATION = {
  YU_SLO: 1_965_986,
  YU_CRO: 4_784_265,
  YU_BIH: 4_377_033,
  YU_SRB: 5_808_906,
  YU_VOJ: 2_013_889,
  YU_KOS: 1_956_196,
  YU_MNE: 615_035,
  YU_MKD: 2_033_964,
} as const;

export const YU_1991_POPULATION = Object.values(YU_1991_REGION_POPULATION).reduce(
  (sum, population) => sum + population,
  0
);
