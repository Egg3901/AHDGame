import {
  RO_1991_MACROREGION_COUNTIES,
  RO_1991_MACROREGION_POPULATION,
  RO_1992_COUNTY_POPULATION,
} from "@/lib/countries/ro/data/roPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { allocateRegionalGdp } from "./rules/allocateRegionalGdp";

/**
 * Romania's National Development Plan, p. 115, reproduces INS 1995 regional
 * GDP per resident as a percentage of national GDP per resident. These are the
 * first available regional output data. The plan's eight development regions
 * are mapped county by county to the game's seven historical macroregions,
 * weighted by the January 1992 census. The result is then scaled to observed
 * 1991 national nominal GDP. This is an estimate across a transition period,
 * not a published 1991 county GDP series.
 * https://ro.scribd.com/document/386415583/3-Analize-Socio-economice-Regionale
 * https://www.recensamantromania.ro/rezultate-recensamant-1992/
 */
export const RO_1995_GDP_PER_CAPITA_INDEX = {
  BucharestIlfov: 137.6,
  NorthEast: 79.5,
  SouthEast: 98.6,
  SouthMuntenia: 94.8,
  SouthWestOltenia: 95.5,
  West: 108.6,
  NorthWest: 93.7,
  Centre: 107.0,
} as const;

const countyDevelopmentRegion = {
  Bucuresti: "BucharestIlfov",
  Ilfov: "BucharestIlfov",
  Alba: "Centre",
  Brasov: "Centre",
  Covasna: "Centre",
  Harghita: "Centre",
  Mures: "Centre",
  Sibiu: "Centre",
  Bacau: "NorthEast",
  Botosani: "NorthEast",
  Iasi: "NorthEast",
  Neamt: "NorthEast",
  Suceava: "NorthEast",
  Vaslui: "NorthEast",
  Bihor: "NorthWest",
  BistritaNasaud: "NorthWest",
  Cluj: "NorthWest",
  Maramures: "NorthWest",
  Salaj: "NorthWest",
  SatuMare: "NorthWest",
  Braila: "SouthEast",
  Buzau: "SouthEast",
  Constanta: "SouthEast",
  Galati: "SouthEast",
  Tulcea: "SouthEast",
  Vrancea: "SouthEast",
  Arges: "SouthMuntenia",
  Calarasi: "SouthMuntenia",
  Dambovita: "SouthMuntenia",
  Giurgiu: "SouthMuntenia",
  Ialomita: "SouthMuntenia",
  Prahova: "SouthMuntenia",
  Teleorman: "SouthMuntenia",
  Dolj: "SouthWestOltenia",
  Gorj: "SouthWestOltenia",
  Mehedinti: "SouthWestOltenia",
  Olt: "SouthWestOltenia",
  Valcea: "SouthWestOltenia",
  Arad: "West",
  CarasSeverin: "West",
  Hunedoara: "West",
  Timis: "West",
} as const satisfies Record<
  keyof typeof RO_1992_COUNTY_POPULATION,
  keyof typeof RO_1995_GDP_PER_CAPITA_INDEX
>;

export const RO_1991_REGION_OUTPUT_INDEX = Object.fromEntries(
  Object.entries(RO_1991_MACROREGION_COUNTIES).map(([regionId, counties]) => [
    regionId,
    counties.reduce(
      (sum, county) =>
        sum +
        RO_1992_COUNTY_POPULATION[county] *
          RO_1995_GDP_PER_CAPITA_INDEX[countyDevelopmentRegion[county]],
      0
    ) / RO_1991_MACROREGION_POPULATION[regionId as keyof typeof RO_1991_MACROREGION_POPULATION],
  ])
) as Record<keyof typeof RO_1991_MACROREGION_POPULATION, number>;

export const RO_1991_ESTIMATED_REGION_GDP_ROL = allocateRegionalGdp(
  SUCCESSOR_NOMINAL_GDP_1991.RO,
  RO_1991_MACROREGION_POPULATION,
  RO_1991_REGION_OUTPUT_INDEX
);
