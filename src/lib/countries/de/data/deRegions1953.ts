/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * German Bundesländer for the 1953-default preset (2nd Bundestag — the
 * Adenauer CDU landslide; Wirtschaftswunder early phase). FRG ONLY — no eastern
 * Länder. The Saarland was a French protectorate until 1957 and sent no deputies
 * to the Bundestag in 1953 (placeholder kept for structural model integrity).
 * West Berlin sent 22 observer deputies (non-voting).
 *
 * Population: 1950 census. GDP: per-Land RELATIVE shares in ~1953 nominal DEM
 * millions. The absolute national total is the FY1953 budget's ~138B DEM
 * (budgets.ts) — the historically correct figure (~$33B at 4.2 DEM/USD) — to
 * which `reconcileStateGdp` scales Σ Land gdp at seed time, so these authored
 * magnitudes need not sum to the national GDP on their own.
 * House seats: 2nd Bundestag (1953) total 487 seats, distributed proportionally
 * by Land population (excl. Saarland; Berlin = observer status, ~22 seats).
 */
import type { State } from "@/lib/db/types";

export const deRegions1953: State[] = [
  // ── Süden ──────────────────────────────────────────────────────────────────
  {
    _id: "BW",
    countryId: "DE",
    regionType: "state",
    name: "Baden-Württemberg",
    population: 6_700_000,
    gdp: 9_200,
    houseDistricts: 58,
    stateSenateSeats: 154,
    region: "Süden",
    votingSystem: "fptp",
  },
  {
    _id: "BY",
    countryId: "DE",
    regionType: "state",
    name: "Bayern",
    population: 9_200_000,
    gdp: 10_800,
    houseDistricts: 90,
    stateSenateSeats: 203,
    region: "Süden",
    votingSystem: "fptp",
  },
  // ── Westen ─────────────────────────────────────────────────────────────────
  {
    _id: "NW",
    countryId: "DE",
    regionType: "state",
    name: "Nordrhein-Westfalen",
    population: 13_200_000,
    gdp: 18_500,
    houseDistricts: 131,
    stateSenateSeats: 195,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "HE",
    countryId: "DE",
    regionType: "state",
    name: "Hessen",
    population: 4_300_000,
    gdp: 5_200,
    houseDistricts: 41,
    stateSenateSeats: 137,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "RP",
    countryId: "DE",
    regionType: "state",
    name: "Rheinland-Pfalz",
    population: 3_000_000,
    gdp: 3_200,
    houseDistricts: 31,
    stateSenateSeats: 101,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    // Saarland was under French administration 1947–1957; placeholder only.
    _id: "SL",
    countryId: "DE",
    regionType: "state",
    name: "Saarland",
    population: 960_000,
    gdp: 1_200,
    houseDistricts: 8,
    stateSenateSeats: 51,
    region: "Westen",
    votingSystem: "fptp",
  },
  // ── Norden ─────────────────────────────────────────────────────────────────
  {
    _id: "NI",
    countryId: "DE",
    regionType: "state",
    name: "Niedersachsen",
    population: 6_600_000,
    gdp: 5_800,
    houseDistricts: 62,
    stateSenateSeats: 146,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "SH",
    countryId: "DE",
    regionType: "state",
    name: "Schleswig-Holstein",
    population: 2_600_000,
    gdp: 1_800,
    houseDistricts: 25,
    stateSenateSeats: 73,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "HH",
    countryId: "DE",
    regionType: "state",
    name: "Hamburg",
    population: 1_600_000,
    gdp: 3_000,
    houseDistricts: 12,
    stateSenateSeats: 123,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "BRE",
    countryId: "DE",
    regionType: "state",
    name: "Bremen",
    population: 560_000,
    gdp: 900,
    houseDistricts: 4,
    stateSenateSeats: 87,
    region: "Norden",
    votingSystem: "fptp",
  },
  // ── West Berlin (observer deputies, not full Bundestag members in 1953) ────
  {
    _id: "BE",
    countryId: "DE",
    regionType: "state",
    name: "Berlin",
    population: 2_100_000,
    gdp: 2_500,
    houseDistricts: 25,
    stateSenateSeats: 159,
    region: "Westberlin",
    votingSystem: "fptp",
  },
];

export default deRegions1953;
