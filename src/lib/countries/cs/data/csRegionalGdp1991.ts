import { CS_1991_REGION_POPULATION } from "@/lib/countries/cs/data/csPopulation1991";
import { CS_1991_CZECH_GDP_CSK, CS_1991_SLOVAK_GDP_CSK } from "@/lib/seeds/reference/successorGdp1991";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";

/**
 * Czech Statistical Office 1995 GDP per resident (Czech average=100) by NUTS2
 * region, the earliest published regional accounts. Source table:
 * https://csu.gov.cz/docs/107508/9ce05106-9a90-fe83-03a6-5faaeb74b176/13710910.pdf?version=1.0
 * The game's 1991 BOH/MOR macroregions do not align exactly with later NUTS2
 * boundaries. Their indices are the mean of the predominantly Bohemian and
 * Moravian NUTS2 indices respectively. The Czech republic GDP is allocated
 * across Prague/Bohemia/Moravia using those output indices and the 1991
 * census; Slovakia retains its separately observed 1991 republic GDP.
 */
export const CS_1995_CZECH_OUTPUT_INDEX = {
  Prague: 170.6,
  CentralBohemia: 86.3,
  Southwest: 95.1,
  Northwest: 94.4,
  Northeast: 91.3,
  Southeast: 92.6,
  CentralMoravia: 86.4,
  MoraviaSilesia: 87.6,
} as const;

export const CS_1991_CZECH_REGION_OUTPUT_INDEX = {
  CS_PRG: CS_1995_CZECH_OUTPUT_INDEX.Prague,
  CS_BOH:
    (CS_1995_CZECH_OUTPUT_INDEX.CentralBohemia +
      CS_1995_CZECH_OUTPUT_INDEX.Southwest +
      CS_1995_CZECH_OUTPUT_INDEX.Northwest +
      CS_1995_CZECH_OUTPUT_INDEX.Northeast) /
    4,
  CS_MOR:
    (CS_1995_CZECH_OUTPUT_INDEX.Southeast +
      CS_1995_CZECH_OUTPUT_INDEX.CentralMoravia +
      CS_1995_CZECH_OUTPUT_INDEX.MoraviaSilesia) /
    3,
} as const;

export const CS_1991_ESTIMATED_REGION_GDP_CSK: Record<string, number> = {
  ...allocateRegionalGdp(
    CS_1991_CZECH_GDP_CSK,
    {
      CS_PRG: CS_1991_REGION_POPULATION.CS_PRG,
      CS_BOH: CS_1991_REGION_POPULATION.CS_BOH,
      CS_MOR: CS_1991_REGION_POPULATION.CS_MOR,
    },
    CS_1991_CZECH_REGION_OUTPUT_INDEX
  ),
  CS_SVK: CS_1991_SLOVAK_GDP_CSK,
};
