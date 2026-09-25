import { RU_1991_ECONOMIC_REGION_POPULATION } from "@/lib/countries/ru/data/ruPopulation1991";
import { PL_1991_MACROREGION_POPULATION } from "@/lib/countries/pl/data/plPopulation1991";
import { CS_1991_REGION_POPULATION } from "@/lib/countries/cs/data/csPopulation1991";
import { HU_1991_REGION_POPULATION } from "@/lib/countries/hu/data/huPopulation1991";
import { RO_1991_MACROREGION_POPULATION } from "@/lib/countries/ro/data/roPopulation1991";
import { BG_1991_MACROREGION_POPULATION } from "@/lib/countries/bg/data/bgPopulation1991";
import { YU_1991_REGION_POPULATION } from "@/lib/countries/yu/data/yuPopulation1991";

/**
 * Census-backed regional population counts for the 1991 successor roster.
 * Kept separate from the seeder until each country's regional GDP, elections,
 * fiscal configuration and demographic model is authored for the same era.
 */
export const SUCCESSOR_REGION_POPULATION_1991 = {
  RU: RU_1991_ECONOMIC_REGION_POPULATION,
  PL: PL_1991_MACROREGION_POPULATION,
  CS: CS_1991_REGION_POPULATION,
  HU: HU_1991_REGION_POPULATION,
  RO: RO_1991_MACROREGION_POPULATION,
  BG: BG_1991_MACROREGION_POPULATION,
  YU: YU_1991_REGION_POPULATION,
} as const;
