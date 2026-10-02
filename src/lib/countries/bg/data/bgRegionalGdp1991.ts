import {
  BG_1991_MACROREGION_DISTRICTS,
  BG_1991_MACROREGION_POPULATION,
  BG_1992_DISTRICT_POPULATION,
} from "@/lib/countries/bg/data/bgPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";

/**
 * Bulgaria NSI Statistical Yearbook 1992, p. 363, records 1992 industrial
 * output for the nine 1987-99 oblasti in million lev. Regional GDP was not
 * available for 1991. Industrial output per resident is used as a documented
 * relative-output proxy, mapped from each oblast's constituent districts and
 * weighted by their 1992 census populations. National 1991 GDP determines
 * the level. This can misstate service and agriculture-heavy regions.
 * https://nsi.bg/sites/default/files/files/publications/God1992.pdf
 * https://guides.loc.gov/bulgarian-statistics/administrative-territorial-divisions
 */
export const BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV = {
  SofiaCity: 25_838,
  Burgas: 28_293,
  Varna: 18_804,
  Lovech: 26_391,
  Montana: 12_323,
  Plovdiv: 26_413,
  Ruse: 13_879,
  Sofia: 20_985,
  Haskovo: 21_035,
} as const;

const districtOblast = {
  Blagoevgrad: "Sofia",
  Burgas: "Burgas",
  Dobrich: "Varna",
  Gabrovo: "Lovech",
  GradSofiya: "SofiaCity",
  Khaskovo: "Haskovo",
  Kurdzhali: "Haskovo",
  Kyustendil: "Sofia",
  Lovech: "Lovech",
  Montana: "Montana",
  Pazardzhik: "Plovdiv",
  Pernik: "Sofia",
  Pleven: "Lovech",
  Plovdiv: "Plovdiv",
  Razgrad: "Ruse",
  Ruse: "Ruse",
  Shumen: "Varna",
  Silistra: "Ruse",
  Sliven: "Burgas",
  Smolyan: "Plovdiv",
  Sofiya: "Sofia",
  StaraZagora: "Haskovo",
  Turgovishte: "Ruse",
  Varna: "Varna",
  VelikoTurnovo: "Lovech",
  Vidin: "Montana",
  Vratsa: "Montana",
  Yambol: "Burgas",
} as const satisfies Record<
  keyof typeof BG_1992_DISTRICT_POPULATION,
  keyof typeof BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV
>;

const oblastPopulation = Object.fromEntries(
  Object.keys(BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV).map((oblast) => [
    oblast,
    Object.entries(BG_1992_DISTRICT_POPULATION)
      .filter(([district]) => districtOblast[district as keyof typeof districtOblast] === oblast)
      .reduce((sum, [, population]) => sum + population, 0),
  ])
) as Record<keyof typeof BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV, number>;

export const BG_1991_REGION_OUTPUT_INDEX = Object.fromEntries(
  Object.entries(BG_1991_MACROREGION_DISTRICTS).map(([regionId, districts]) => [
    regionId,
    districts.reduce((sum, district) => {
      const oblast = districtOblast[district];
      return (
        sum +
        (BG_1992_DISTRICT_POPULATION[district] *
          BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV[oblast]) /
          oblastPopulation[oblast]
      );
    }, 0) / BG_1991_MACROREGION_POPULATION[regionId as keyof typeof BG_1991_MACROREGION_POPULATION],
  ])
) as Record<keyof typeof BG_1991_MACROREGION_POPULATION, number>;

export const BG_1991_ESTIMATED_REGION_GDP_BGL = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.BG,
  BG_1991_MACROREGION_POPULATION,
  BG_1991_REGION_OUTPUT_INDEX
);
