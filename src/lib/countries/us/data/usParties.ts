import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * United States default political parties.
 *
 * ⚠️ THESE WERE THE ONLY PARTY ROWS IN `seeds/reference/politicalParties.ts`,
 * A FILE NAMED AS IF IT HELD EVERY COUNTRY'S. Every other country already keeps
 * its own roster -- Japan in `jp/data/jpParties.ts`, and the rest in
 * `admin/seed/seedAT.ts`, `seedBR.ts`, `seedCN.ts` and their siblings. The US
 * was the odd one out purely because it is the DEFAULT country, so its data
 * ended up in the shared file under the shared name.
 *
 * Consumers had already noticed and worked around it:
 * `finalizeResetGameWorld.ts` imported it as
 * `const { politicalParties: usParties } = ...`, renaming it at the call site,
 * and `StartingStateDashboardData.ts` files it under a `US:` key. When readers
 * alias a shared name to a country name, the name is wrong.
 *
 * seedOrder determines the sequentialId assignment order within the US.
 */
export const usParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "US",
    name: "Democratic Party",
    abbreviation: "DEM",
    color: "#3B82F6", // Blue
    economicPosition: -2, // Center-left
    socialPosition: -2, // Center-left
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
