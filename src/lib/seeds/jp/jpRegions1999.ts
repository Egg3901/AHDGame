/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 1999-default preset (Obuchi LDP era, post-bubble "lost
 * decade"). The 8 game regions are structurally stable; the era-specific values
 * are late-1990s population, ~1999 regional GDP (JPY millions), and the
 * **500-seat** Shugiin distribution from the 1994 electoral reform in force
 * 1996–2000 (300 SMD + 200 PR). `stateSenateSeats` is structural.
 */
import type { State } from "@/lib/db/types";

export const jpRegions1999: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_680_000,
    gdp: 19_000_000,
    houseDistricts: 21,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 9_820_000,
    gdp: 32_000_000,
    houseDistricts: 45,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 40_500_000,
    gdp: 198_000_000,
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
    population: 21_500_000,
    gdp: 80_000_000,
    houseDistricts: 84,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 22_800_000,
    gdp: 84_000_000,
    houseDistricts: 90,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_780_000,
    gdp: 27_500_000,
    houseDistricts: 32,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 4_150_000,
    gdp: 13_200_000,
    houseDistricts: 18,
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
    gdp: 49_000_000,
    houseDistricts: 60,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions1999;
