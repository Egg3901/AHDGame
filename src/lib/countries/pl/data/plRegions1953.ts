import type { State } from "@/lib/db/types";

/** Poland 1953 — Bierut Stalinist era. Pop ~25.5M; GDP in millions of złoty.
 *  Nowa Huta steelworks near Kraków just completed; Silesian coal dominant export;
 *  private peasant farms largely survived collectivization unlike USSR.
 *
 *  Same eight macro-regions as 1979. The western "Recovered Territories"
 *  (Lower Silesia, Pomerania) are still resettling after the postwar
 *  population transfers. Population ~25.5M (GUS / UN estimates mid-1950s).
 *  houseDistricts sums to the same 460-seat Sejm as the base config. */
export const plRegions1953: State[] = [
  {
    _id: "PL_MAZ",
    countryId: "PL",
    regionType: "state",
    name: "Mazovia",
    population: 3_600_000,
    gdp: 17_000,
    houseDistricts: 65,
    stateSenateSeats: 0,
    region: "Mazovia",
    votingSystem: "fptp",
  },
  {
    _id: "PL_LOD",
    countryId: "PL",
    regionType: "state",
    name: "Łódź & Holy Cross",
    population: 3_000_000,
    gdp: 14_000,
    houseDistricts: 54,
    stateSenateSeats: 0,
    region: "Łódź",
    votingSystem: "fptp",
  },
  {
    _id: "PL_MAL",
    countryId: "PL",
    regionType: "state",
    name: "Lesser Poland",
    population: 3_600_000,
    gdp: 15_000,
    houseDistricts: 65,
    stateSenateSeats: 0,
    region: "Lesser Poland",
    votingSystem: "fptp",
  },
  {
    _id: "PL_SLK",
    countryId: "PL",
    regionType: "state",
    name: "Silesia",
    population: 3_900_000,
    gdp: 26_000,
    houseDistricts: 70,
    stateSenateSeats: 0,
    region: "Silesia",
    votingSystem: "fptp",
  },
  {
    _id: "PL_DSL",
    countryId: "PL",
    regionType: "state",
    name: "Lower Silesia",
    population: 2_500_000,
    gdp: 14_000,
    houseDistricts: 45,
    stateSenateSeats: 0,
    region: "Lower Silesia",
    votingSystem: "fptp",
  },
  {
    _id: "PL_WLK",
    countryId: "PL",
    regionType: "state",
    name: "Greater Poland",
    population: 3_700_000,
    gdp: 15_000,
    houseDistricts: 67,
    stateSenateSeats: 0,
    region: "Greater Poland",
    votingSystem: "fptp",
  },
  {
    _id: "PL_POM",
    countryId: "PL",
    regionType: "state",
    name: "Pomerania & Masuria",
    population: 2_800_000,
    gdp: 12_000,
    houseDistricts: 51,
    stateSenateSeats: 0,
    region: "Pomerania",
    votingSystem: "fptp",
  },
  {
    _id: "PL_EAS",
    countryId: "PL",
    regionType: "state",
    name: "Eastern Poland",
    population: 2_400_000,
    gdp: 7_000,
    houseDistricts: 43,
    stateSenateSeats: 0,
    region: "Eastern Poland",
    votingSystem: "fptp",
  },
];
export default plRegions1953;
