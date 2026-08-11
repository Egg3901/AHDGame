import type { State } from "@/lib/db/types";

/**
 * China macro-regions as State-compatible documents.
 *
 * The 7 geographic macro-regions are the playable sub-national units. Each
 * region represents a major geographic and economic zone of China, contributing
 * a share of the 2980 National People's Congress (NPC) seats used as the
 * direct-mandate pool for seat allocation.
 *
 * - `population` — 2023 demographic estimates (people).
 * - `gdp` — regional GDP in millions of CNY.
 * - `houseDistricts` — NPC seats allocated to the region
 *     (must sum to 2980 across all 7 regions).
 * - `stateSenateSeats` — CPPCC seats allocated to the region
 *     (must sum to 2169 across all 7 regions).
 * - `region` — geographic macro-region name.
 * - `votingSystem` — FPTP placeholder (nominal; NPC uses indirect election).
 */
export const cnRegions: State[] = [
  // ── Dongbei (Northeast) ────────────────────────────────────────────────────
  {
    _id: "DB",
    countryId: "CN",
    regionType: "province",
    name: "Dongbei",
    population: 99_500_000,
    gdp: 5_500_000,
    houseDistricts: 238,
    stateSenateSeats: 175,
    region: "Dongbei",
    votingSystem: "fptp",
  },

  // ── Huabei (North) ─────────────────────────────────────────────────────────
  {
    _id: "HB",
    countryId: "CN",
    regionType: "province",
    name: "Huabei",
    population: 135_000_000,
    gdp: 18_000_000,
    houseDistricts: 323,
    stateSenateSeats: 235,
    region: "Huabei",
    votingSystem: "fptp",
  },

  // ── Huadong (East) ─────────────────────────────────────────────────────────
  {
    _id: "HD",
    countryId: "CN",
    regionType: "province",
    name: "Huadong",
    population: 385_000_000,
    gdp: 42_000_000,
    houseDistricts: 922,
    stateSenateSeats: 671,
    region: "Huadong",
    votingSystem: "fptp",
  },

  // ── Huazhong (Central) ─────────────────────────────────────────────────────
  {
    _id: "HZ",
    countryId: "CN",
    regionType: "province",
    name: "Huazhong",
    population: 165_000_000,
    gdp: 16_000_000,
    houseDistricts: 395,
    stateSenateSeats: 287,
    region: "Huazhong",
    votingSystem: "fptp",
  },

  // ── Huanan (South) ─────────────────────────────────────────────────────────
  {
    _id: "HN",
    countryId: "CN",
    regionType: "province",
    name: "Huanan",
    population: 132_000_000,
    gdp: 18_000_000,
    houseDistricts: 316,
    stateSenateSeats: 230,
    region: "Huanan",
    votingSystem: "fptp",
  },

  // ── Xinan (Southwest) ──────────────────────────────────────────────────────
  {
    _id: "XN",
    countryId: "CN",
    regionType: "province",
    name: "Xinan",
    population: 195_000_000,
    gdp: 14_000_000,
    houseDistricts: 466,
    stateSenateSeats: 339,
    region: "Xinan",
    votingSystem: "fptp",
  },

  // ── Xibei (Northwest) ──────────────────────────────────────────────────────
  {
    _id: "XB",
    countryId: "CN",
    regionType: "province",
    name: "Xibei",
    population: 130_000_000,
    gdp: 8_500_000,
    houseDistricts: 320,
    stateSenateSeats: 232,
    region: "Xibei",
    votingSystem: "fptp",
  },
];

/**
 * NPC seats per region — denormalized for fast lookup during
 * election spawning. Must agree with `cnRegions[*].houseDistricts`.
 *
 * Total: 2980 (NPC lower chamber).
 */
export const CN_DISTRICTS_PER_REGION: Record<string, number> = Object.fromEntries(
  cnRegions.map((r) => [r._id, r.houseDistricts])
);
