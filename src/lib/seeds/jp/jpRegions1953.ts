/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 1953-default preset (26th Shugiin election, April 1953 —
 * Yoshida Liberal Party era; Korean War armistice; early reconstruction).
 * The 8 game regions are structurally stable; era-specific values are 1950-census
 * population (first postwar census), ~1953 regional GDP in **USD millions**
 * (USD-anchored like US/DE — refs #3498; ¥9.3T national / 360 JPY/USD Bretton
 * Woods ≈ $25.8B), and the **466-seat** Shugiin distribution of the 1953 election.
 * Okinawa was under US occupation until 1972 but is included for structural
 * model integrity.
 */
import type { State } from "@/lib/db/types";

export const jpRegions1953: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 4_773_000,
    gdp: 1_321, // USD millions; share of $25.8B national
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
    population: 12_984_000,
    gdp: 2_017,
    houseDistricts: 66,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 19_607_000,
    gdp: 8_343,
    houseDistricts: 109,
    stateSenateSeats: 581,
    region: "Kanto",
    votingSystem: "fptp",
  },
  {
    _id: "CHU",
    countryId: "JP",
    regionType: "region",
    name: "Chubu",
    population: 15_833_000,
    gdp: 3_337,
    houseDistricts: 78,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 16_742_000,
    gdp: 5_841,
    houseDistricts: 84,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 5_758_000,
    gdp: 1_460,
    houseDistricts: 31,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 3_323_000,
    gdp: 765,
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
    population: 14_234_000,
    gdp: 2_712,
    houseDistricts: 59,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions1953;
