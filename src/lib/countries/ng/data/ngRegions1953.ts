/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * Nigeria geo-political zones for the 1953-default preset (British colonial
 * Nigeria — Northern, Eastern, and Western Regions under the Macpherson
 * Constitution 1951; independence comes 1960). The 6-zone model is structurally
 * stable; era-specific values are 1952-53 census population (~30.4M official),
 * ~1953 regional GDP in **USD millions** (USD-anchored like US/DE — refs #3498;
 * colonial £1.2B WAP ≈ $3.4B at Bretton Woods $2.80/£), and the 136-seat Federal
 * House of Representatives allocation under the Lyttelton Constitution (1954).
 *
 * NOTE: Nigeria is Tier-1 full-autonomous economy-preview in 1953 (product
 * decision 2026-07-25). These region records supply the autonomous seed pack.
 */
import type { State } from "@/lib/db/types";

export const ngRegions1953: State[] = [
  {
    _id: "NORTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "North West",
    population: 7_500_000,
    gdp: 979,
    houseDistricts: 34,
    stateSenateSeats: 21,
    region: "North West",
    votingSystem: "fptp",
  },
  {
    _id: "NORTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "North East",
    population: 3_500_000,
    gdp: 381,
    houseDistricts: 16,
    stateSenateSeats: 18,
    region: "North East",
    votingSystem: "fptp",
  },
  {
    _id: "NORTH_CENTRAL",
    countryId: "NG",
    regionType: "state",
    name: "North Central",
    population: 5_800_000,
    gdp: 571,
    houseDistricts: 26,
    stateSenateSeats: 21,
    region: "North Central",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "South West",
    population: 6_100_000,
    gdp: 734,
    houseDistricts: 27,
    stateSenateSeats: 18,
    region: "South West",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_SOUTH",
    countryId: "NG",
    regionType: "state",
    name: "South South",
    population: 2_300_000,
    gdp: 245,
    houseDistricts: 10,
    stateSenateSeats: 18,
    region: "South South",
    votingSystem: "fptp",
  },
  {
    _id: "SOUTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "South East",
    population: 4_900_000,
    gdp: 490,
    houseDistricts: 23,
    stateSenateSeats: 18,
    region: "South East",
    votingSystem: "fptp",
  },
];

export default ngRegions1953;
