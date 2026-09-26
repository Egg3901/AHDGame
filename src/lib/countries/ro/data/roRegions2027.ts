import type { State } from "@/lib/db/types";

/** Romania regions (2027) — semi-presidential democracy. The latest national
 *  anchors available for this future preset are the INSSE 1 Jan 2025 usually
 *  resident population (19,043,151) and 2024 annual GDP (RON 1,766,067.6
 *  million, unadjusted series).
 *  https://insse.ro/cms/sites/default/files/com_presa/com_pdf/poprez_ian2025e-def.pdf
 *  https://insse.ro/cms/sites/default/files/com_presa/com_pdf/pib_tr4e2024_1.pdf
 *  These seven regional figures are proportional estimates from the earlier
 *  authored distribution, reconciled exactly to those national anchors; they
 *  are not published INSSE regional observations. GDP is millions of lei.
 *
 *  Same seven historic-province ids as 1953/1979 (Bucharest / Muntenia /
 *  Oltenia / Transylvania / Banat & Crișana / Moldavia / Dobruja), so the
 *  Layer-1 census keys keep resolving.
 *  houseDistricts = Chamber of Deputies seats apportioned by population,
 *  largest remainder (sum = 331, the post-1992 lower-house total);
 *  stateSenateSeats = Senate seats apportioned by population, largest
 *  remainder (sum = 134). The closed-list PR allocation is election logic,
 *  not regional data.
 */
export const roRegions2027: State[] = [
  {
    _id: "RO_BUC",
    countryId: "RO",
    regionType: "state",
    name: "Bucharest",
    population: 1_817_755,
    gdp: 286_986,
    houseDistricts: 32,
    stateSenateSeats: 13,
    region: "Bucharest",
    votingSystem: "fptp",
  },
  {
    _id: "RO_MUN",
    countryId: "RO",
    regionType: "state",
    name: "Muntenia",
    population: 4_068_310,
    gdp: 331_138,
    houseDistricts: 71,
    stateSenateSeats: 29,
    region: "Wallachia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_OLT",
    countryId: "RO",
    regionType: "state",
    name: "Oltenia",
    population: 2_077_435,
    gdp: 165_569,
    houseDistricts: 36,
    stateSenateSeats: 14,
    region: "Wallachia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_TRA",
    countryId: "RO",
    regionType: "state",
    name: "Transylvania",
    population: 3_981_750,
    gdp: 419_441,
    houseDistricts: 69,
    stateSenateSeats: 28,
    region: "Transylvania",
    votingSystem: "fptp",
  },
  {
    _id: "RO_VST",
    countryId: "RO",
    regionType: "state",
    name: "Banat & Crișana",
    population: 2_596_793,
    gdp: 264_910,
    houseDistricts: 45,
    stateSenateSeats: 18,
    region: "Transylvania",
    votingSystem: "fptp",
  },
  {
    _id: "RO_MOL",
    countryId: "RO",
    regionType: "state",
    name: "Moldavia",
    population: 3_808_630,
    gdp: 231_796,
    houseDistricts: 66,
    stateSenateSeats: 27,
    region: "Moldavia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_DOB",
    countryId: "RO",
    regionType: "state",
    name: "Dobruja",
    population: 692_478,
    gdp: 66_228,
    houseDistricts: 12,
    stateSenateSeats: 5,
    region: "Dobruja",
    votingSystem: "fptp",
  },
];
export default roRegions2027;
