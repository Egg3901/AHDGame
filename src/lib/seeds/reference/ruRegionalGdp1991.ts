import { RU_1991_ECONOMIC_REGION_POPULATION } from "@/lib/countries/ru/data/ruPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { allocateRegionalGdp } from "./rules/allocateRegionalGdp";

/**
 * Earliest published regional gross product is 1995. These economic-region
 * totals reproduce Goskomstat's Regiony Rossii 1996 table (in 1995 million
 * rubles), also available by federal subject from Rosstat. The game's Volga
 * region combines Volga and Volga-Vyatka. The 1995 totals supply *relative*
 * output weights only; 1991 nominal GDP supplies the national level. This is
 * an estimate, and transition-era changes make the 1995 pattern uncertain.
 * https://www.rosstat.gov.ru/bgd/regl/B05_14p/IssWWW.exe/Stg/d010/10-01.htm
 * https://www.cspp.strath.ac.uk/ES1-GDP-1.html
 */
export const RU_1995_ECONOMIC_REGION_GRP_MILLION_RUB = {
  CEN: 294_060,
  NWR: 68_545,
  NOR: 75_408,
  CBE: 59_084,
  VOL: 147_724 + 63_384,
  NCA: 88_663,
  URA: 204_672,
  WSB: 217_667,
  ESB: 102_356,
  FEA: 81_277,
} as const;

export const RU_1991_ESTIMATED_REGION_GDP_RUB = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.RU,
  RU_1991_ECONOMIC_REGION_POPULATION,
  Object.fromEntries(
    Object.entries(RU_1995_ECONOMIC_REGION_GRP_MILLION_RUB).map(([id, gdp]) => [
      id,
      gdp /
        RU_1991_ECONOMIC_REGION_POPULATION[id as keyof typeof RU_1991_ECONOMIC_REGION_POPULATION],
    ])
  )
);
