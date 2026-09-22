import type { State } from "@/lib/db/types";

/** Yugoslavia 1953 — Tito's independent path. Pop ~16.9M; GDP in millions of dinar.
 *  Uniquely, Tito abandoned Soviet-style collectivization in 1953, returning land to
 *  peasants. Non-aligned movement forming. Worker self-management (samoupravljanje)
 *  expanding. US aid via Mutual Defense Assistance Act.
 *
 *  Eight federal units (six republics + Serbia's two autonomous units, already
 *  constituted in 1945/46 — Vojvodina as autonomous province, Kosovo-Metohija as
 *  autonomous region). Population ~16.9M (1953 Yugoslav census ≈ 16.9M).
 *  houseDistricts sums to the same Federal Chamber size as 1979 (308). */
export const yuRegions1953: State[] = [
  {
    _id: "YU_SLO",
    countryId: "YU",
    regionType: "state",
    name: "Slovenia",
    population: 1_500_000,
    gdp: 270_000,
    houseDistricts: 26,
    stateSenateSeats: 0,
    region: "Slovenia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_CRO",
    countryId: "YU",
    regionType: "state",
    name: "Croatia",
    population: 3_900_000,
    gdp: 450_000,
    houseDistricts: 63,
    stateSenateSeats: 0,
    region: "Croatia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_BIH",
    countryId: "YU",
    regionType: "state",
    name: "Bosnia & Herzegovina",
    population: 2_850_000,
    gdp: 252_000,
    houseDistricts: 57,
    stateSenateSeats: 0,
    region: "Bosnia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_SRB",
    countryId: "YU",
    regionType: "state",
    name: "Serbia",
    population: 4_450_000,
    gdp: 468_000,
    houseDistricts: 79,
    stateSenateSeats: 0,
    region: "Serbia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_VOJ",
    countryId: "YU",
    regionType: "state",
    name: "Vojvodina",
    population: 1_700_000,
    gdp: 198_000,
    houseDistricts: 28,
    stateSenateSeats: 0,
    region: "Vojvodina",
    votingSystem: "fptp",
  },
  {
    _id: "YU_KOS",
    countryId: "YU",
    regionType: "state",
    name: "Kosovo",
    population: 800_000,
    gdp: 36_000,
    houseDistricts: 21,
    stateSenateSeats: 0,
    region: "Kosovo",
    votingSystem: "fptp",
  },
  {
    _id: "YU_MNE",
    countryId: "YU",
    regionType: "state",
    name: "Montenegro",
    population: 400_000,
    gdp: 36_000,
    houseDistricts: 8,
    stateSenateSeats: 0,
    region: "Montenegro",
    votingSystem: "fptp",
  },
  {
    _id: "YU_MKD",
    countryId: "YU",
    regionType: "state",
    name: "Macedonia",
    population: 1_300_000,
    gdp: 90_000,
    houseDistricts: 26,
    stateSenateSeats: 0,
    region: "Macedonia",
    votingSystem: "fptp",
  },
];
export default yuRegions1953;
