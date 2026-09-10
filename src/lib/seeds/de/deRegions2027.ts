/**
 * SEED INDEPENDENCE: DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2027 directly.
 * Type-only imports are allowed.
 *
 * German Bundesländer for the 2027-default preset (21st Bundestag, the Merz
 * CDU/CSU-SPD "GroKo" coalition elected February 2025). All 16 states are
 * structurally stable; the era-specific values are projected 2027
 * population and projected 2026 nominal state GDP (EUR millions).
 * `houseDistricts` (Bundestag Wahlkreise) and `stateSenateSeats` (Landtag)
 * are structural and held constant across eras (they feed germanyAMS.ts;
 * the Wahlkreise sum to 299).
 *
 * 2027 projection assumptions (documented, not derived in code):
 * - Population: Destatis end-2024 state figures carried to 2027 (western
 *   and southern Länder still growing slightly, eastern Länder except
 *   Berlin and Brandenburg still shrinking slightly). Source: Destatis
 *   "Bevoelkerung nach Bundeslaendern"
 *   (https://www.destatis.de/EN/Themes/Society-Environment/Population/_node.html).
 * - GDP: 2022 nominal state GDP carried to 2026 nominal at about 12%
 *   cumulative (Destatis VGR der Laender 2023-24 growth path). Source:
 *   Destatis "Volkswirtschaftliche Gesamtrechnungen der Laender"
 *   (https://www.destatis.de/EN/Themes/Economy/National-Accounts-Domestic-Product/_node.html).
 * - Seats: the 2023 federal electoral reform (Bundestag capped at 630,
 *   299 Wahlkreise) stays in force after the 2025 election, so the
 *   structural columns match the 2023 bundle. Source: Die Bundeswahlleiterin
 *   2025 Bundestag election results
 *   (https://www.bundeswahlleiter.de/en/bundestagswahlen/2025/ergebnisse/bund.html).
 */
import type { State } from "@/lib/db/types";

export const deRegions2027: State[] = [
  // ── Süden ────────────────────────────────────────────────────────────────
  {
    _id: "BW",
    countryId: "DE",
    regionType: "state",
    name: "Baden-Württemberg",
    population: 11_350_000,
    gdp: 646_000,
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
    population: 13_260_000,
    gdp: 802_000,
    houseDistricts: 47,
    stateSenateSeats: 203,
    region: "Süden",
    votingSystem: "fptp",
  },
  // ── Westen ───────────────────────────────────────────────────────────────
  {
    _id: "NW",
    countryId: "DE",
    regionType: "state",
    name: "Nordrhein-Westfalen",
    population: 18_200_000,
    gdp: 867_000,
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
    population: 6_430_000,
    gdp: 360_000,
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
    population: 4_180_000,
    gdp: 190_000,
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
    population: 990_000,
    gdp: 41_000,
    houseDistricts: 4,
    stateSenateSeats: 51,
    region: "Westen",
    votingSystem: "fptp",
  },
  // ── Norden ───────────────────────────────────────────────────────────────
  {
    _id: "NI",
    countryId: "DE",
    regionType: "state",
    name: "Niedersachsen",
    population: 8_180_000,
    gdp: 386_000,
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
    population: 2_960_000,
    gdp: 121_000,
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
    population: 1_960_000,
    gdp: 159_000,
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
    gdp: 39_000,
    houseDistricts: 2,
    stateSenateSeats: 87,
    region: "Norden",
    votingSystem: "fptp",
  },
  // ── Osten ────────────────────────────────────────────────────────────────
  {
    _id: "BE",
    countryId: "DE",
    regionType: "state",
    name: "Berlin",
    population: 3_910_000,
    gdp: 202_000,
    houseDistricts: 12,
    stateSenateSeats: 159,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "BB",
    countryId: "DE",
    regionType: "state",
    name: "Brandenburg",
    population: 2_590_000,
    gdp: 95_000,
    houseDistricts: 10,
    stateSenateSeats: 88,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "MV",
    countryId: "DE",
    regionType: "state",
    name: "Mecklenburg-Vorpommern",
    population: 1_610_000,
    gdp: 58_000,
    houseDistricts: 6,
    stateSenateSeats: 79,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "SN",
    countryId: "DE",
    regionType: "state",
    name: "Sachsen",
    population: 4_040_000,
    gdp: 162_000,
    houseDistricts: 16,
    stateSenateSeats: 120,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "ST",
    countryId: "DE",
    regionType: "state",
    name: "Sachsen-Anhalt",
    population: 2_160_000,
    gdp: 83_000,
    houseDistricts: 8,
    stateSenateSeats: 97,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "TH",
    countryId: "DE",
    regionType: "state",
    name: "Thüringen",
    population: 2_100_000,
    gdp: 76_000,
    houseDistricts: 8,
    stateSenateSeats: 88,
    region: "Osten",
    votingSystem: "fptp",
  },
];

export default deRegions2027;
