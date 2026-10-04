import { HU_1991_REGION_POPULATION } from "@/lib/countries/hu/data/huPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";

/**
 * KSH's earliest available regional GDP-per-resident index (Hungary=100),
 * 1994. The series is reproduced with KSH attribution in Table A of the
 * Hungary Cohesion Policy country report, page 49:
 * https://www.files.ethz.ch/isn/142019/HU_Evalnet_Country%20report_FINAL%20VERSION.pdf
 *
 * Applied to the 1 January 1990 KSH census populations and scaled to WDI's
 * 1991 nominal GDP. This is a retrospective opening-year estimate: transition
 * changed the regional output pattern between 1991 and the 1994 observation.
 */
export const HU_1994_GDP_PER_CAPITA_INDEX = {
  Budapest: 180,
  Pest: 76,
  CentralTransdanubia: 86,
  WesternTransdanubia: 101,
  SouthernTransdanubia: 84,
  NorthernHungary: 69,
  NorthernGreatPlain: 74,
  SouthernGreatPlain: 83,
} as const;

const centralTransdanubiaPopulation = 245_698 + 749_027 + 123_264;
const westernTransdanubiaPopulation = 209_944 + 662_976 + 133_861;
const northernGreatPlainPopulation = 352_482 + 1_008_856 + 186_182;
const southernGreatPlainPopulation = 281_367 + 914_620 + 199_490;

export const HU_1991_REGION_OUTPUT_INDEX = {
  HU_BUD: HU_1994_GDP_PER_CAPITA_INDEX.Budapest,
  HU_PES: HU_1994_GDP_PER_CAPITA_INDEX.Pest,
  HU_TRW:
    (centralTransdanubiaPopulation * HU_1994_GDP_PER_CAPITA_INDEX.CentralTransdanubia +
      westernTransdanubiaPopulation * HU_1994_GDP_PER_CAPITA_INDEX.WesternTransdanubia) /
    (centralTransdanubiaPopulation + westernTransdanubiaPopulation),
  HU_TRS: HU_1994_GDP_PER_CAPITA_INDEX.SouthernTransdanubia,
  HU_NOR: HU_1994_GDP_PER_CAPITA_INDEX.NorthernHungary,
  HU_ALF:
    (northernGreatPlainPopulation * HU_1994_GDP_PER_CAPITA_INDEX.NorthernGreatPlain +
      southernGreatPlainPopulation * HU_1994_GDP_PER_CAPITA_INDEX.SouthernGreatPlain) /
    (northernGreatPlainPopulation + southernGreatPlainPopulation),
} as const;

export const HU_1991_ESTIMATED_REGION_GDP_HUF = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.HU,
  HU_1991_REGION_POPULATION,
  HU_1991_REGION_OUTPUT_INDEX
);
