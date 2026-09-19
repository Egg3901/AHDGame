import type { State } from "@/lib/db/types";

/**
 * East Germany (GDR) regions as State-compatible documents — 1953.
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Authored for ~1953 directly. NOT imported/transformed from ddRegions.ts.
 *
 * Context: The GDR (Deutsche Demokratische Republik) was founded October 1949.
 * By 1953 it had a population of ~18.4M (not yet depleted by Republikflucht peak).
 * June 17, 1953 uprising (East Berlin workers' revolt) was suppressed by Soviet tanks.
 * Economy: centrally planned, still rebuilding from WWII; NMP ≈ 44B Ostmark.
 *
 * REGION CODES — the same eastern-Länder codes as the 1979 bundle (`BEO` East
 * Berlin + the shared `MV BB ST SN TH`), so both Cold-War eras render from the
 * same ownership-driven Länder geometry. Historically the Länder were dissolved
 * into Bezirke in mid-1952; the Länder remain the gameplay units, with the
 * Bezirke as flavor. The shared codes belong to `DE` only in unified eras — see
 * `seedDD.ts` for the divided-era ownership rules.
 *
 * houseDistricts = Volkskammer seats (nominal, single National Front list;
 * sum = 500). stateSenateSeats = Landtag (landAssembly) seats per Land
 * (sum = 80) — the sub-national chamber Land First Secretaries queue state
 * bills through. gdp in millions of Mark der DDR (per-Land shares of the
 * ~44B NMP).
 */
export const ddRegions1953: State[] = [
  // ── Berlin (the capital, SED stronghold, June 17 epicentre) ─────────────────
  {
    _id: "BEO",
    countryId: "DD",
    regionType: "state",
    name: "Berlin (Ost)",
    population: 1_190_000, // East Berlin 1953 (pre-Wall, still shrinking from 1.8M wartime)
    gdp: 5_200,
    houseDistricts: 32,
    stateSenateSeats: 5,
    region: "Berlin",
    votingSystem: "fptp",
  },
  // ── North (Baltic coast + Brandenburg + Saxony-Anhalt) ──────────────────────
  {
    _id: "MV",
    countryId: "DD",
    regionType: "state",
    name: "Mecklenburg-Vorpommern",
    population: 2_120_000, // swollen by expellee resettlement; agrarian Baltic coast
    gdp: 3_900,
    houseDistricts: 58,
    stateSenateSeats: 9,
    region: "North",
    votingSystem: "fptp",
  },
  {
    _id: "BB",
    countryId: "DD",
    regionType: "state",
    name: "Brandenburg",
    population: 2_620_000, // excl. Berlin; Bezirke Potsdam/Frankfurt(Oder)/Cottbus
    gdp: 5_600,
    houseDistricts: 71,
    stateSenateSeats: 11,
    region: "North",
    votingSystem: "fptp",
  },
  {
    _id: "ST",
    countryId: "DD",
    regionType: "state",
    name: "Sachsen-Anhalt",
    population: 4_120_000, // Halle/Magdeburg — the chemical belt
    gdp: 9_900,
    houseDistricts: 112,
    stateSenateSeats: 18,
    region: "North",
    votingSystem: "fptp",
  },
  // ── South (the industrial heartland) ────────────────────────────────────────
  {
    _id: "SN",
    countryId: "DD",
    regionType: "state",
    name: "Sachsen",
    population: 5_560_000, // Dresden/Leipzig/Karl-Marx-Stadt industrial core
    gdp: 13_900,
    houseDistricts: 151,
    stateSenateSeats: 24,
    region: "South",
    votingSystem: "fptp",
  },
  {
    _id: "TH",
    countryId: "DD",
    regionType: "state",
    name: "Thüringen",
    population: 2_790_000, // Erfurt/Gera/Suhl; Wismut uranium fields
    gdp: 5_500,
    houseDistricts: 76,
    stateSenateSeats: 13,
    region: "South",
    votingSystem: "fptp",
  },
];

export default ddRegions1953;
