import type { State } from "@/lib/db/types";

/**
 * Scotland's 7 sub-regions as latent State documents, modeled on `ieRegions.ts`.
 *
 * Not inserted at UK seed time - `expandToSubRegions` inserts them when
 * Scotland secedes, apportioning the live SCO nation-region's aggregates.
 * Population + GDP sum to the UK SCO nation-region seed (5,440,000 / 163,000);
 * `houseDistricts` sum to the 129-seat Holyrood; `stateSenateSeats` are 0
 * (unicameral). `votingSystem` is "fptp" (the AMS constituency tier; the list
 * tier is handled by the country election system).
 */
export const scoRegions: State[] = [
  {
    _id: "GLA",
    countryId: "SCO",
    regionType: "region",
    name: "Greater Glasgow",
    population: 1_160_000,
    gdp: 35_000,
    houseDistricts: 28,
    stateSenateSeats: 0,
    region: "Central Belt",
    votingSystem: "fptp",
  },
  {
    _id: "LOT",
    countryId: "SCO",
    regionType: "region",
    name: "Edinburgh & the Lothians",
    population: 900_000,
    gdp: 40_000,
    houseDistricts: 21,
    stateSenateSeats: 0,
    region: "Central Belt",
    votingSystem: "fptp",
  },
  {
    _id: "HIG",
    countryId: "SCO",
    regionType: "region",
    name: "Highlands & Islands",
    population: 470_000,
    gdp: 11_000,
    houseDistricts: 11,
    stateSenateSeats: 0,
    region: "Highlands",
    votingSystem: "fptp",
  },
  {
    _id: "GRA",
    countryId: "SCO",
    regionType: "region",
    name: "North East Scotland",
    population: 590_000,
    gdp: 26_000,
    houseDistricts: 14,
    stateSenateSeats: 0,
    region: "North East",
    votingSystem: "fptp",
  },
  {
    _id: "TAY",
    countryId: "SCO",
    regionType: "region",
    name: "Tayside & Fife",
    population: 810_000,
    gdp: 20_000,
    houseDistricts: 19,
    stateSenateSeats: 0,
    region: "East",
    votingSystem: "fptp",
  },
  {
    _id: "STH",
    countryId: "SCO",
    regionType: "region",
    name: "South Scotland",
    population: 700_000,
    gdp: 14_000,
    houseDistricts: 16,
    stateSenateSeats: 0,
    region: "South",
    votingSystem: "fptp",
  },
  {
    _id: "CSC",
    countryId: "SCO",
    regionType: "region",
    name: "Central Scotland",
    population: 810_000,
    gdp: 17_000,
    houseDistricts: 20,
    stateSenateSeats: 0,
    region: "Central Belt",
    votingSystem: "fptp",
  },
];
