/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * Japan regions for the 1979-default preset (Ohira LDP era — the late-1970s
 * high-growth "Japan Inc." economy, pre-bubble). The 8 game regions are
 * structurally stable; the era-specific values are 1980-census population, ~1979
 * regional GDP (JPY millions — roughly half the bubble-era nominal level), and
 * the **511-seat** Shugiin distribution of the medium-constituency (SNTV) era in
 * force 1976–1993. `stateSenateSeats` is structural.
 */
import type { State } from "@/lib/db/types";

export const jpRegions1979: State[] = [
  {
    _id: "HOK",
    countryId: "JP",
    regionType: "region",
    name: "Hokkaido",
    population: 5_580_000,
    gdp: 9_000_000,
    houseDistricts: 23,
    stateSenateSeats: 100,
    region: "Hokkaido",
    votingSystem: "fptp",
  },
  {
    _id: "TOH",
    countryId: "JP",
    regionType: "region",
    name: "Tohoku",
    population: 9_570_000,
    gdp: 14_000_000,
    houseDistricts: 50,
    stateSenateSeats: 299,
    region: "Tohoku",
    votingSystem: "fptp",
  },
  {
    _id: "KAN",
    countryId: "JP",
    regionType: "region",
    name: "Kanto",
    population: 34_000_000,
    gdp: 85_000_000,
    houseDistricts: 144,
    stateSenateSeats: 581,
    region: "Kanto",
    votingSystem: "fptp",
  },
  {
    _id: "CHU",
    countryId: "JP",
    regionType: "region",
    name: "Chubu",
    population: 19_800_000,
    gdp: 37_000_000,
    houseDistricts: 86,
    stateSenateSeats: 483,
    region: "Chubu",
    votingSystem: "fptp",
  },
  {
    _id: "KNS",
    countryId: "JP",
    regionType: "region",
    name: "Kansai",
    population: 21_800_000,
    gdp: 39_000_000,
    houseDistricts: 92,
    stateSenateSeats: 414,
    region: "Kansai",
    votingSystem: "fptp",
  },
  {
    _id: "CGK",
    countryId: "JP",
    regionType: "region",
    name: "Chugoku",
    population: 7_850_000,
    gdp: 12_000_000,
    houseDistricts: 34,
    stateSenateSeats: 238,
    region: "Chugoku",
    votingSystem: "fptp",
  },
  {
    _id: "SHI",
    countryId: "JP",
    regionType: "region",
    name: "Shikoku",
    population: 4_160_000,
    gdp: 5_600_000,
    houseDistricts: 20,
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
    gdp: 23_000_000,
    houseDistricts: 62,
    stateSenateSeats: 401,
    region: "Kyushu",
    votingSystem: "fptp",
  },
];

export default jpRegions1979;
