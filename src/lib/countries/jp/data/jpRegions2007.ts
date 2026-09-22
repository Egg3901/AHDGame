/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2007 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 2007-default preset (the Abe→Fukuda LDP era, post-Koizumi).
 * The 8 game regions are structurally stable; the era-specific values are 2007
 * population, ~2007 regional GDP (JPY millions), and the **480-seat** Shugiin
 * distribution in force 2000–2014 (300 SMD + 180 PR). `stateSenateSeats` is
 * structural.
 */
import type { State } from "@/lib/db/types";

export const jpRegions2007: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_580_000,
    gdp: 19_000_000,
    houseDistricts: 20,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 9_550_000,
    gdp: 33_000_000,
    houseDistricts: 42,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 42_500_000,
    gdp: 207_000_000,
    houseDistricts: 150,
    stateSenateSeats: 581,
    region: "Kanto",
    votingSystem: "fptp",
  },
  {
    _id: "CHU",
    countryId: "JP",
    regionType: "region",
    name: "Chubu",
    population: 21_400_000,
    gdp: 82_000_000,
    houseDistricts: 82,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 22_700_000,
    gdp: 85_000_000,
    houseDistricts: 86,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_500_000,
    gdp: 28_000_000,
    houseDistricts: 30,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 4_000_000,
    gdp: 13_500_000,
    houseDistricts: 16,
    stateSenateSeats: 163,
    region: "Shikoku",
    votingSystem: "fptp",
  },
  {
    _id: "KYU",
    countryId: "JP",
    regionType: "region",
    name: "Kyushu & Okinawa",
    population: 14_500_000,
    gdp: 50_000_000,
    houseDistricts: 54,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions2007;
