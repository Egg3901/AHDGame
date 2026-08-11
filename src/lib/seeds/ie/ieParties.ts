import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Ireland default political parties.
 *
 * Two preset rosters:
 *   - 2019-default: FG / FF / SF / Labour / Green — the modern roster.
 *     Sinn Féin in 1991 was a tiny abstentionist party with no Dáil seats
 *     (didn't take seats until 1997). Modern Sinn Féin / Greens are gated
 *     to 2019-default only.
 *   - 1991-default: FF / FG / Labour + Workers' Party (WP) + Progressive
 *     Democrats (PD). WP held 7 Dáil seats in 1989; PD held 6 (FF-PD
 *     formed government). WP split into Democratic Left in 1992 then
 *     merged into Labour in 1999; PD dissolved in 2008.
 *
 * Seeded as `isDefault: true` — they always exist and cannot be deleted.
 * seedOrder determines sequentialId assignment within IE.
 */
export const ieParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "IE" as const,
    name: "Fine Gael",
    abbreviation: "FG",
    color: "#009DD6",
    economicPosition: 2,
    socialPosition: -2,
    memberCount: 0,
    isDefault: true,
    treasury: 1_200_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 2,
    countryId: "IE" as const,
    name: "Fianna Fáil",
    abbreviation: "FF",
    color: "#66BB00",
    economicPosition: 0,
    socialPosition: 0,
    memberCount: 0,
    isDefault: true,
    treasury: 1_200_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // 2019-only: SF held no Dáil seats in 1991 (abstentionist) and the
    // modern positioning post-1986 ard fheis / 1997 seat-taking is the
    // wrong calibration for early-1990s republicanism.
    seedOrder: 3,
    countryId: "IE" as const,
    name: "Sinn Féin",
    abbreviation: "SF",
    color: "#326760",
    economicPosition: -3,
    socialPosition: -3,
    memberCount: 0,
    isDefault: true,
    treasury: 800_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2019-default"],
  },
  {
    seedOrder: 4,
    countryId: "IE" as const,
    name: "Labour",
    abbreviation: "LAB",
    color: "#CC0000",
    economicPosition: -2,
    socialPosition: -2,
    memberCount: 0,
    isDefault: true,
    treasury: 400_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    // 2019-only: Green Party held a single Dublin South seat in 1989-1992
    // (Roger Garland) at ~1.5% national vote share — far too small for a
    // top-roster default in 1991.
    seedOrder: 5,
    countryId: "IE" as const,
    name: "Green Party",
    abbreviation: "GP",
    color: "#00B140",
    economicPosition: -1,
    socialPosition: -3,
    memberCount: 0,
    isDefault: true,
    treasury: 300_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["2019-default"],
  },
  // ─── 1991-only defaults ────────────────────────────────────────────────
  {
    // 1991-only: Workers' Party (Páirtí na nOibrithe). Marxist-Leninist
    // party that emerged from Official Sinn Féin after the 1969-70 split;
    // held 7 Dáil seats in 1989 (peak). Split into Democratic Left in
    // February 1992, which merged into Labour in 1999.
    seedOrder: 6,
    countryId: "IE" as const,
    name: "Workers' Party",
    abbreviation: "WP",
    color: "#C8102E",
    economicPosition: -4,
    socialPosition: -2,
    memberCount: 0,
    isDefault: true,
    treasury: 400_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1991-default"],
  },
  {
    // 1991-only: Progressive Democrats. Free-market liberal party founded
    // 1985 (Desmond O'Malley breakaway from FF). Held 6 Dáil seats in 1989
    // and was the FF coalition partner 1989-1992. Voluntarily dissolved
    // in 2008-09 after losing seats.
    seedOrder: 7,
    countryId: "IE" as const,
    name: "Progressive Democrats",
    abbreviation: "PD",
    color: "#7B68EE",
    economicPosition: 3,
    socialPosition: -1,
    memberCount: 0,
    isDefault: true,
    treasury: 400_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
    validForPresets: ["1991-default"],
  },
];
