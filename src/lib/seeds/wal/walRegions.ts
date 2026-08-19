import type { State } from "@/lib/db/types";

/**
 * Wales's 6 sub-regions as latent State documents, modeled on `ieRegions.ts`.
 *
 * Not inserted at UK seed time - `expandToSubRegions` inserts them when Wales
 * secedes. Population + GDP sum to the UK WAL nation-region seed
 * (3,170,000 / 74,000); `houseDistricts` sum to the 60-seat Senedd;
 * `stateSenateSeats` are 0 (unicameral). `votingSystem` is "fptp" (the AMS
 * constituency tier).
 */
export const walRegions: State[] = [
  {
    _id: "CDF",
    countryId: "WAL",
    regionType: "region",
    name: "Cardiff & South East",
    population: 1_050_000,
    gdp: 28_000,
    houseDistricts: 20,
    stateSenateSeats: 0,
    region: "South Wales",
    votingSystem: "fptp",
  },
  {
    _id: "SWA",
    countryId: "WAL",
    regionType: "region",
    name: "Swansea & South West",
    population: 700_000,
    gdp: 15_000,
    houseDistricts: 13,
    stateSenateSeats: 0,
    region: "South Wales",
    votingSystem: "fptp",
  },
  {
    _id: "VAL",
    countryId: "WAL",
    regionType: "region",
    name: "The Valleys",
    population: 600_000,
    gdp: 11_000,
    houseDistricts: 11,
    stateSenateSeats: 0,
    region: "South Wales",
    votingSystem: "fptp",
  },
  {
    _id: "MWA",
    countryId: "WAL",
    regionType: "region",
    name: "Mid Wales",
    population: 210_000,
    gdp: 5_000,
    houseDistricts: 4,
    stateSenateSeats: 0,
    region: "Mid Wales",
    votingSystem: "fptp",
  },
  {
    _id: "NWW",
    countryId: "WAL",
    regionType: "region",
    name: "North West Wales",
    population: 330_000,
    gdp: 8_000,
    houseDistricts: 6,
    stateSenateSeats: 0,
    region: "North Wales",
    votingSystem: "fptp",
  },
  {
    _id: "NEW",
    countryId: "WAL",
    regionType: "region",
    name: "North East Wales",
    population: 280_000,
    gdp: 7_000,
    houseDistricts: 6,
    stateSenateSeats: 0,
    region: "North Wales",
    votingSystem: "fptp",
  },
];
