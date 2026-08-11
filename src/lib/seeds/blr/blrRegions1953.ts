import type { State } from "@/lib/db/types";

/** Byelorussian SSR 1953 — six oblasts. Pop 7.7M; gdp in millions of Soviet
 *  rubles (the same unit as src/lib/seeds/ru/ruRegions1953.ts, so the republic
 *  reads on the same scale as the RSFSR regions beside it).
 *
 *  The republic is a reconstruction site, not yet the machine-building republic
 *  it becomes. Roughly a quarter of the prewar population died in the war and
 *  the prewar level is not regained until about 1970, so 7.7M in 1953 is BELOW
 *  the 1939 figure and climbing toward the 8.05M of the 1959 census. Minsk was
 *  about 80% destroyed and is being rebuilt from the foundations up; the MAZ
 *  truck works has only just been stood up there, and the Soligorsk potash
 *  discovered around 1949 is barely into mining. Everything else is timber,
 *  flax, peat, light industry and the transit corridor west to Poland.
 *
 *  Region codes are the `BLR_` set from public/blr-regions.json (see
 *  src/lib/maps/blrGeometry.ts) — the map shard and the seed must agree or the
 *  republic renders as empty geography.
 *
 *  houseDistricts = seats in the Supreme Soviet of the Byelorussian SSR,
 *  apportioned by population, summing to the 360 in the country config. */
export const blrRegions1953: State[] = [
  {
    _id: "BLR_MIN",
    countryId: "BLR",
    regionType: "state",
    name: "Minsk",
    population: 1_900_000,
    // The capital oblast takes the largest single share of union investment:
    // MAZ trucks, MTZ tractors, and the rebuilding of the city itself. Its GDP
    // share (32%) runs well ahead of its population share (25%) because
    // reconstruction capital is concentrated here by decree, not by market.
    gdp: 16_000,
    houseDistricts: 89,
    stateSenateSeats: 0,
    region: "Minsk",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_HOM",
    countryId: "BLR",
    regionType: "state",
    name: "Gomel",
    population: 1_400_000,
    // Second industrial centre: timber, machine tools, and the Dnieper river
    // trade. Damaged but not levelled the way Minsk was.
    gdp: 8_500,
    houseDistricts: 66,
    stateSenateSeats: 0,
    region: "Gomel",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_VIT",
    countryId: "BLR",
    regionType: "state",
    name: "Vitebsk",
    population: 1_300_000,
    // Flax, timber and textiles on the old Riga-Orel rail axis. The oblast was
    // fought over twice and its towns are still half-rebuilt.
    gdp: 8_000,
    houseDistricts: 61,
    stateSenateSeats: 0,
    region: "Vitebsk",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_MOG",
    countryId: "BLR",
    regionType: "state",
    name: "Mogilev",
    population: 1_200_000,
    // Light industry and grain on the Dnieper; the wartime evacuation of plant
    // eastward has only partly returned.
    gdp: 7_500,
    houseDistricts: 56,
    stateSenateSeats: 0,
    region: "Mogilev",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_BRE",
    countryId: "BLR",
    regionType: "state",
    name: "Brest",
    population: 1_100_000,
    // Polish territory until 1939, agrarian, and the western gateway: the
    // Brest border crossing is the USSR's main rail door to Poland and beyond.
    // Transit earns it more than its farms do, but it carries little industry,
    // so GDP per head is the second lowest in the republic.
    gdp: 5_500,
    houseDistricts: 51,
    stateSenateSeats: 0,
    region: "Brest",
    votingSystem: "fptp",
  },
  {
    _id: "BLR_GRO",
    countryId: "BLR",
    regionType: "state",
    name: "Grodno",
    population: 800_000,
    // Also pre-1939 Poland, the most agrarian and the most Catholic oblast,
    // with a large Polish minority that the postwar repatriations thinned but
    // did not remove. Smallest population, lowest output.
    gdp: 4_500,
    houseDistricts: 37,
    stateSenateSeats: 0,
    region: "Grodno",
    votingSystem: "fptp",
  },
];
export default blrRegions1953;
