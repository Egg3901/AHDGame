import type { State } from "@/lib/db/types";

/**
 * Ukraine (Ukrainian SSR) 1979 - the Shcherbytsky years. Pop 49.8M (the January
 * 1979 census figure, and the same total the union-level seed carries for its
 * `UKR` region); gdp in millions of Soviet rubles on the same basis as
 * uaRegions1953.ts.
 *
 * Same six macro-regions as 1953, so region codes, census keys and metric
 * overrides line up across both Cold-War presets and one map shard serves both.
 *
 * Scale: ₽875,000M against ₽291,667M in 1953, roughly threefold real growth
 * over twenty-six years (~4.3%/yr, consistent with Soviet NMP series for the
 * republic and with the sharp slowdown after 1970 that leaves the late-1970s
 * figure well short of a straight-line extrapolation of the 1950s recovery).
 * Per head that is ₽17,570 against ₽7,114 - the republic roughly doubled its
 * output per person while adding 8.8M people.
 *
 * What has changed since 1953:
 * - Ukraine is now majority urban (about 61% at the 1979 census against roughly
 *   a third in 1953). The Dnieper belt and Donbas are the urban core.
 * - Donbas has peaked. The coal is deeper, thinner and dearer every year, and
 *   the region's share of republican output falls even though its absolute
 *   output rises. The Dnieper belt overtakes it decisively.
 * - Western Ukraine has been industrialised in patches (Lviv buses, Volhynian
 *   coal, Transcarpathian light industry) but is still the poorest region per
 *   head and still the most rural and most religiously distinct.
 * - The south now includes Crimea outright (transferred 1954) and has gained
 *   the Southern Bug/North Crimean canal irrigation belt, plus Odesa's role as
 *   the union's main warm-water commercial port.
 *
 * houseDistricts = Supreme Soviet of the Ukrainian SSR seats (435), apportioned
 * by population with largest remainder.
 */
export const uaRegions: State[] = [
  {
    _id: "UKR_KYI",
    countryId: "UKR",
    regionType: "state",
    name: "Kyiv and the Right Bank",
    population: 10_500_000,
    gdp: 185_000,
    houseDistricts: 92,
    stateSenateSeats: 0,
    region: "Kyiv",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_WES",
    countryId: "UKR",
    regionType: "state",
    name: "Western Ukraine",
    population: 9_500_000,
    gdp: 125_000,
    houseDistricts: 83,
    stateSenateSeats: 0,
    region: "West",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_POD",
    countryId: "UKR",
    regionType: "state",
    name: "Podolia",
    population: 3_600_000,
    gdp: 50_000,
    houseDistricts: 31,
    stateSenateSeats: 0,
    region: "Podolia",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_DON",
    countryId: "UKR",
    regionType: "state",
    // Still the highest output per head (₽20,588) but no longer the growth
    // story: costs per tonne of coal are rising faster than anywhere in the
    // union and the workforce is ageing in place.
    name: "Donbas",
    population: 8_500_000,
    gdp: 175_000,
    houseDistricts: 74,
    stateSenateSeats: 0,
    region: "Donbas",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_DNI",
    countryId: "UKR",
    regionType: "state",
    name: "Dnieper Industrial Belt",
    population: 11_500_000,
    gdp: 230_000,
    houseDistricts: 101,
    stateSenateSeats: 0,
    region: "Dnieper",
    votingSystem: "fptp",
  },
  {
    _id: "UKR_SOU",
    countryId: "UKR",
    regionType: "state",
    name: "Black Sea Coast",
    population: 6_200_000,
    gdp: 110_000,
    houseDistricts: 54,
    stateSenateSeats: 0,
    region: "South",
    votingSystem: "fptp",
  },
];
export default uaRegions;
