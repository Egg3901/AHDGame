import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * China default political parties.
 *
 * Economic/social positions on -5 to +5 scale, calibrated to China's
 * one-party dominant political system:
 *   CCP:   Chinese Communist Party — dominant ruling party, economically left
 *          (state ownership, SOE dominance, central planning), socially
 *          authoritarian / nationalist (leans traditional).
 *   CDL:   China Democratic League — largest of the eight officially recognized
 *          minor parties; historically associated with intellectuals and
 *          educators. Holds seats in CPPCC.
 *   CNDCA: China National Democratic Construction Association — business-
 *          oriented democratic party, represents private entrepreneurs and
 *          industry. Holds seats in CPPCC.
 *
 * All parties operate within the Chinese People's Political Consultative
 * Conference (CPPCC) framework under CCP leadership.
 *
 * Seeded as `isDefault: true` — they always exist and cannot be deleted.
 * seedOrder determines sequentialId assignment within CN.
 */
export const cnParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "CN",
    name: "Chinese Communist Party",
    abbreviation: "CCP",
    color: "#DE2910",
    economicPosition: -3, // state ownership, SOE dominance, five-year planning
    socialPosition: 2, // nominally secular but socially authoritarian / nationalist
    foreignPolicy: 3, // BRI, regional assertion, anti-US-containment, "wolf warrior" diplomacy
    culture: 5, // Chinese cultural nationalism, "core socialist values", anti-Western influence
    memberCount: 0,
    isDefault: true,
    regimeStatus: "ruling",
    treasury: 2_000_000,
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
    countryId: "CN",
    name: "China Democratic League",
    abbreviation: "CDL",
    color: "#FFD700",
    economicPosition: -1,
    socialPosition: 0,
    foreignPolicy: 2, // united-front participant, follows CCP foreign line in practice
    culture: 2, // defers to CCP cultural framework; nominally pluralist but constrained
    memberCount: 0,
    isDefault: true,
    regimeStatus: "approved",
    treasury: 200_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
  {
    seedOrder: 3,
    countryId: "CN",
    name: "China National Democratic Construction Association",
    abbreviation: "CNDCA",
    color: "#1E90FF",
    economicPosition: 1,
    socialPosition: 0,
    foreignPolicy: 2, // united-front participant; same alignment as CDL
    culture: 2, // defers to CCP cultural framework; business-class base
    memberCount: 0,
    isDefault: true,
    regimeStatus: "approved",
    treasury: 200_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
