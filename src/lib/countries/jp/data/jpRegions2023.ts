/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2023 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 2023-default preset (Kishida LDP–Komeito government).
 * The 8 game regions are structurally stable; the era-specific values are 2023
 * population, ~2022 regional GDP (JPY millions), and the **465-seat** Shugiin
 * distribution in force since 2017. `stateSenateSeats` = prefectural-assembly
 * seats (structural).
 */
import type { State } from "@/lib/db/types";

export const jpRegions2023: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_200_000,
    gdp: 19_300_000,
    houseDistricts: 12,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 8_600_000,
    gdp: 33_500_000,
    houseDistricts: 37,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 43_500_000,
    gdp: 213_000_000,
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
    population: 21_100_000,
    gdp: 82_000_000,
    houseDistricts: 81,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 22_500_000,
    gdp: 85_000_000,
    houseDistricts: 82,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_100_000,
    gdp: 28_500_000,
    houseDistricts: 28,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 3_700_000,
    gdp: 13_800_000,
    houseDistricts: 14,
    stateSenateSeats: 163,
    region: "Shikoku",
    votingSystem: "fptp",
  },
  {
    _id: "KYU",
    countryId: "JP",
    regionType: "region",
    name: "Kyushu & Okinawa",
    population: 14_300_000,
    gdp: 50_600_000,
    houseDistricts: 61,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions2023;
