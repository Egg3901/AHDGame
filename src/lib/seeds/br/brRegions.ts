import type { State } from "@/lib/db/types";

/**
 * Brazil IBGE macro-regions as State-compatible documents.
 *
 * The 5 macro-regions are the playable sub-national units. Each region
 * contributes a share of the 513 Chamber of Deputies seats (open-list PR
 * by state in practice; FPTP is used here as a placeholder).
 *
 * - `population` — 2023 IBGE estimates (people).
 * - `gdp` — regional GDP in millions of BRL.
 * - `houseDistricts` — Chamber of Deputies seats allocated to the region
 *     (must sum to 513 across all 5 regions).
 * - `stateSenateSeats` — Federal Senate seats allocated to the region
 *     (must sum to 81 across all 5 regions).
 * - `region` — IBGE macro-region grouping used for regional filters.
 * - `votingSystem` — Placeholder; actual system is open-list PR.
 */
export const brRegions: State[] = [
  // ── Norte ──────────────────────────────────────────────────────────────────
  {
    _id: "NORTE",
    countryId: "BR",
    regionType: "state",
    name: "Norte",
    population: 18_430_000,
    gdp: 480_000,
    houseDistricts: 75,
    stateSenateSeats: 21,
    region: "Norte",
    votingSystem: "fptp",
  },

  // ── Nordeste ───────────────────────────────────────────────────────────────
  {
    _id: "NORDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Nordeste",
    population: 57_071_000,
    gdp: 1_400_000,
    houseDistricts: 144,
    stateSenateSeats: 27,
    region: "Nordeste",
    votingSystem: "fptp",
  },

  // ── Centro-Oeste ───────────────────────────────────────────────────────────
  {
    _id: "CENTRO_OESTE",
    countryId: "BR",
    regionType: "state",
    name: "Centro-Oeste",
    population: 16_729_000,
    gdp: 1_200_000,
    houseDistricts: 42,
    stateSenateSeats: 12,
    region: "Centro-Oeste",
    votingSystem: "fptp",
  },

  // ── Sudeste ────────────────────────────────────────────────────────────────
  {
    _id: "SUDESTE",
    countryId: "BR",
    regionType: "state",
    name: "Sudeste",
    population: 88_371_000,
    gdp: 6_200_000,
    houseDistricts: 179,
    stateSenateSeats: 12,
    region: "Sudeste",
    votingSystem: "fptp",
  },

  // ── Sul ────────────────────────────────────────────────────────────────────
  {
    _id: "SUL",
    countryId: "BR",
    regionType: "state",
    name: "Sul",
    population: 30_367_000,
    gdp: 1_800_000,
    houseDistricts: 73,
    stateSenateSeats: 9,
    region: "Sul",
    votingSystem: "fptp",
  },
];

/**
 * Chamber of Deputies seats per macro-region — denormalized for fast lookup
 * during election spawning. Must agree with `brRegions[*].houseDistricts`.
 *
 * Total: 513 (fixed constitutional allocation).
 */
export const BR_SEATS_PER_REGION: Record<string, number> = Object.fromEntries(
  brRegions.map((r) => [r._id, r.houseDistricts])
);
