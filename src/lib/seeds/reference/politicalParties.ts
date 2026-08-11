import type { PoliticalParty } from "@/lib/db/types";

/**
 * Party seed data type - excludes fields generated at insert time.
 * seedOrder determines the sequentialId assignment order.
 */
export type PartySeed = Omit<PoliticalParty, "_id" | "sequentialId" | "createdAt" | "updatedAt"> & {
  seedOrder: number;
  /**
   * When set, this party is only seeded for the listed preset IDs (e.g.
   * `["1991-default"]` for UUP — the historically-dominant unionist
   * party in NI pre-1998 that doesn't fit a 2019 roster). When omitted,
   * the party is preset-agnostic (the common case).
   *
   * `ensureDefaultParties` and `seedUKParties` skip parties whose
   * `validForPresets` excludes the current preset, and `resetGameWorld`
   * deletes default parties whose `validForPresets` no longer matches
   * the new preset on reset.
   */
  validForPresets?: string[];
};

export const politicalParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "US",
    name: "Democratic Party",
    abbreviation: "DEM",
    color: "#3B82F6", // Blue
    economicPosition: -2, // Center-left
    socialPosition: -2, // Center-left
    foreignPolicy: -1, // multilateralist, alliance-friendly, comfortable using force but prefers coalitions
    culture: -2, // progressive multiculturalism, secularism
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    treasury: 1000000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    memberCount: 0,
    isDefault: true,
    createdBy: null,
  },
  {
    seedOrder: 2,
    countryId: "US",
    name: "Republican Party",
    abbreviation: "REP",
    color: "#EF4444", // Red
    economicPosition: 2, // Center-right
    socialPosition: 2, // Center-right
    foreignPolicy: 3, // hawkish, military-projection, China/Iran/Russia confrontational
    culture: 3, // traditional values, anti-DEI, restrictive on immigration
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    treasury: 1000000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    memberCount: 0,
    isDefault: true,
    createdBy: null,
  },
];
