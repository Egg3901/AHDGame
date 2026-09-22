import type { State } from "@/lib/db/types";

/**
 * Ireland NUTS III planning regions as State-compatible documents.
 *
 * The 8 planning regions are the playable sub-national units. Each region
 * contributes seats to Dáil Éireann (lower house, 160 total) using PR-STV
 * (approximated here as rcv). Seanad Éireann (upper, 60 seats) is split
 * across regions via stateSenateSeats.
 *
 * - `population` — 2023 CSO estimates (people).
 * - `gdp` — regional GDP in millions of EUR.
 * - `houseDistricts` — Dáil seats allocated to the region
 *     (must sum to 160 across all 8 regions).
 * - `stateSenateSeats` — Seanad seats allocated to the region
 *     (must sum to 60 across all 8 regions, with some rounding).
 * - `region` — traditional province grouping used for regional filters.
 * - `votingSystem` — rcv (PR-STV approximation for Irish multi-seat
 *     constituencies).
 */
export const ieRegions: State[] = [
  // ── Leinster ───────────────────────────────────────────────────────────────
  {
    _id: "DUB",
    countryId: "IE" as const,
    regionType: "region",
    name: "Dublin",
    population: 1_458_000,
    gdp: 180_000,
    houseDistricts: 49,
    stateSenateSeats: 9,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    // Region condenses Kildare + Meath + Wicklow into a single NUTS-III tier.
    // Named for Kildare (largest population in the region).
    _id: "KIL",
    countryId: "IE" as const,
    regionType: "region",
    name: "Kildare",
    population: 610_000,
    gdp: 42_000,
    houseDistricts: 21,
    stateSenateSeats: 8,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    // Region condenses Laois + Longford + Offaly + Westmeath. No single county
    // dominates, so the geographic name "Midlands" is retained.
    _id: "MID",
    countryId: "IE" as const,
    regionType: "region",
    name: "Midlands",
    population: 315_000,
    gdp: 18_000,
    houseDistricts: 11,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },
  {
    // Region condenses Carlow + Kilkenny + Tipperary + Waterford + Wexford.
    // Named for Wexford (largest population in the region).
    _id: "WEX",
    countryId: "IE" as const,
    regionType: "region",
    name: "Wexford",
    population: 389_000,
    gdp: 28_000,
    houseDistricts: 13,
    stateSenateSeats: 7,
    region: "Leinster",
    votingSystem: "rcv",
  },

  // ── Munster ────────────────────────────────────────────────────────────────
  {
    // Region condenses Clare + Limerick. Named for Limerick (dominant city +
    // population). Limerick's mayor mechanic is handled via a per-region label.
    _id: "LIM",
    countryId: "IE" as const,
    regionType: "region",
    name: "Limerick",
    population: 432_000,
    gdp: 38_000,
    houseDistricts: 15,
    stateSenateSeats: 7,
    region: "Munster",
    votingSystem: "rcv",
  },
  {
    // Region condenses Cork City + Cork County + Kerry. Named for Cork
    // (overwhelmingly dominant). Cork's Lord Mayor is handled via per-region label.
    _id: "COR",
    countryId: "IE" as const,
    regionType: "region",
    name: "Cork",
    population: 598_000,
    gdp: 65_000,
    houseDistricts: 20,
    stateSenateSeats: 8,
    region: "Munster",
    votingSystem: "rcv",
  },

  // ── Connacht ───────────────────────────────────────────────────────────────
  {
    // Region condenses Galway + Mayo + Roscommon. Named for Galway (dominant
    // population + the only major city in Connacht). Galway's mayor is
    // handled via a per-region label.
    _id: "GAL",
    countryId: "IE" as const,
    regionType: "region",
    name: "Galway",
    population: 453_000,
    gdp: 35_000,
    houseDistricts: 15,
    stateSenateSeats: 7,
    region: "Connacht",
    votingSystem: "rcv",
  },

  // ── Ulster (Republic portion) ──────────────────────────────────────────────
  {
    // Region condenses Cavan + Donegal + Leitrim + Louth + Monaghan + Sligo
    // (the six Republic-side Ulster counties along the NI border). Named for
    // Donegal (largest population).
    _id: "DON",
    countryId: "IE" as const,
    regionType: "region",
    name: "Donegal",
    population: 485_000,
    gdp: 25_000,
    houseDistricts: 16,
    stateSenateSeats: 7,
    region: "Ulster",
    votingSystem: "rcv",
  },
];

/**
 * Dáil constituencies per region — denormalized for fast lookup during
 * election spawning. Must agree with `ieRegions[*].houseDistricts`.
 *
 * Total: 160 (Dáil Éireann seat count).
 */
export const IE_DAIL_SEATS_PER_REGION: Record<string, number> = Object.fromEntries(
  ieRegions.map((r) => [r._id, r.houseDistricts])
);
