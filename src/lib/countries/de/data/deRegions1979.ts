/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * German Bundesländer for the 1979-default preset (8th Bundestag — the
 * Schmidt SPD–FDP era, pre-reunification West Germany). The calibration target
 * for this cell is "West Germany 1980 (Schmidt SPD); West Länder only".
 *
 * MODELLING NOTE (pre-reunification): 1979 is a WEST GERMAN world. The FRG is the
 * eleven western units only (BW BY NW HE RP SL NI SH HH BRE + West Berlin) with
 * real ~1979 West German population + nominal GDP. The five eastern Länder
 * (BB/MV/SN/ST/TH) are NOT carried here — East Germany is modeled as the separate
 * `DD` (GDR) country, so two-state Germany is represented by FRG (DE) + GDR (DD)
 * rather than by east-Länder folded into the FRG. Berlin holds the ~1.95M West
 * Berlin figure (the West German playable unit), not the whole divided city.
 */
import type { State } from "@/lib/db/types";

export const deRegions1979: State[] = [
  // ── Süden (West) ───────────────────────────────────────────────────────────
  {
    _id: "BW",
    countryId: "DE",
    regionType: "state",
    name: "Baden-Württemberg",
    population: 9_150_000,
    gdp: 127_000,
    houseDistricts: 38,
    stateSenateSeats: 154,
    region: "Süden",
    votingSystem: "fptp",
  },
  {
    _id: "BY",
    countryId: "DE",
    regionType: "state",
    name: "Bayern",
    population: 10_850_000,
    gdp: 158_000,
    houseDistricts: 47,
    stateSenateSeats: 203,
    region: "Süden",
    votingSystem: "fptp",
  },
  // ── Westen (West) ──────────────────────────────────────────────────────────
  {
    _id: "NW",
    countryId: "DE",
    regionType: "state",
    name: "Nordrhein-Westfalen",
    population: 17_050_000,
    gdp: 170_000,
    houseDistricts: 64,
    stateSenateSeats: 195,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "HE",
    countryId: "DE",
    regionType: "state",
    name: "Hessen",
    population: 5_600_000,
    gdp: 71_000,
    houseDistricts: 22,
    stateSenateSeats: 137,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "RP",
    countryId: "DE",
    regionType: "state",
    name: "Rheinland-Pfalz",
    population: 3_640_000,
    gdp: 37_000,
    houseDistricts: 15,
    stateSenateSeats: 101,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "SL",
    countryId: "DE",
    regionType: "state",
    name: "Saarland",
    population: 1_070_000,
    gdp: 8_000,
    houseDistricts: 4,
    stateSenateSeats: 51,
    region: "Westen",
    votingSystem: "fptp",
  },
  // ── Norden (West) ──────────────────────────────────────────────────────────
  {
    _id: "NI",
    countryId: "DE",
    regionType: "state",
    name: "Niedersachsen",
    population: 7_250_000,
    gdp: 76_000,
    houseDistricts: 30,
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
    gdp: 24_000,
    houseDistricts: 11,
    stateSenateSeats: 73,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "HH",
    countryId: "DE",
    regionType: "state",
    name: "Hamburg",
    population: 1_680_000,
    gdp: 31_000,
    houseDistricts: 6,
    stateSenateSeats: 123,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "BRE",
    countryId: "DE",
    regionType: "state",
    name: "Bremen",
    population: 690_000,
    gdp: 8_000,
    houseDistricts: 2,
    stateSenateSeats: 87,
    region: "Norden",
    votingSystem: "fptp",
  },
  // ── West Berlin: the FRG's playable Berlin unit (the GDR is modeled as the
  //    separate DD country; the eastern Länder are no longer carried here). ─────
  {
    _id: "BE",
    countryId: "DE",
    regionType: "state",
    name: "Berlin",
    population: 1_950_000,
    gdp: 40_000,
    houseDistricts: 12,
    stateSenateSeats: 159,
    region: "Westberlin",
    votingSystem: "fptp",
  },
];

export default deRegions1979;
