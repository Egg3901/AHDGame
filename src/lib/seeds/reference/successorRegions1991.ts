import type { CountryId } from "@/lib/constants/countries";
import type { State } from "@/lib/db/types";
import { ruRegions } from "@/lib/countries/ru/data/ruRegions";
import { plRegions } from "@/lib/countries/pl/data/plRegions";
import { csRegions } from "@/lib/countries/cs/data/csRegions";
import { huRegions } from "@/lib/countries/hu/data/huRegions";
import { roRegions } from "@/lib/countries/ro/data/roRegions";
import { bgRegions } from "@/lib/countries/bg/data/bgRegions";
import { yuRegions } from "@/lib/countries/yu/data/yuRegions";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";

/**
 * The census-backed 1991 successor geography. The older region tables are used
 * only for stable geographic names and grouping. Their Soviet-era GDP and
 * legislative allocations are deliberately excluded: those must be authored
 * against the January 1991 institutions before a State can be seeded.
 */
export interface SuccessorRegionGeography1991 {
  _id: string;
  countryId: CountryId;
  name: string;
  region: string;
  regionType?: State["regionType"];
  population: number;
}

const REGION_NAMES = {
  RU: ruRegions,
  PL: plRegions,
  CS: csRegions,
  HU: huRegions,
  RO: roRegions,
  BG: bgRegions,
  YU: yuRegions,
} as const;

export const SUCCESSOR_REGIONS_1991: Record<
  keyof typeof SUCCESSOR_REGION_POPULATION_1991,
  SuccessorRegionGeography1991[]
> = Object.fromEntries(
  Object.entries(SUCCESSOR_REGION_POPULATION_1991).map(([countryId, populationByRegion]) => {
    const named = REGION_NAMES[countryId as keyof typeof REGION_NAMES] as readonly State[];
    const regions = Object.entries(populationByRegion).map(([regionId, population]) => {
      const source = named.find((region) => region._id === regionId);
      if (!source) throw new Error(`No geographic name for ${countryId}/${regionId}`);
      return {
        _id: regionId,
        countryId: countryId as CountryId,
        name: source.name,
        region: source.region,
        regionType: source.regionType,
        population,
      };
    });
    return [countryId, regions];
  })
) as Record<keyof typeof SUCCESSOR_REGION_POPULATION_1991, SuccessorRegionGeography1991[]>;
