import { YU_1991_REGION_POPULATION } from "@/lib/countries/yu/data/yuPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";

/**
 * The Yugoslav Federal Statistical Office's 1989 gross social product per
 * capita by republic/province, USD. These are pre-breakup relative output
 * observations, not the 1991 GDP figures themselves. IMF Staff Country Report
 * 94/8, Table 42 reproduces the Federal Statistical Office's series:
 * https://www.elibrary.imf.org/view/journals/002/1994/008/article-A001-en.xml
 *
 * Multiplying by the March 1991 census counts yields regional output weights;
 * scaling those weights to the latest available national SFRY nominal GDP
 * (1990 YUD) gives the January 1991 opening estimate. This retains the large
 * Slovenian/Serbian/Kosovar productivity differences documented in Table 42.
 */
export const YU_1989_GSP_USD_PER_PERSON = {
  YU_SLO: 7_139,
  YU_CRO: 4_158,
  YU_BIH: 2_129,
  YU_SRB: 3_038,
  YU_VOJ: 4_040,
  YU_KOS: 826,
  YU_MNE: 2_342,
  YU_MKD: 2_053,
} as const;

export const YU_1991_ESTIMATED_REGION_GDP_YUD = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.YU,
  YU_1991_REGION_POPULATION,
  YU_1989_GSP_USD_PER_PERSON
);
