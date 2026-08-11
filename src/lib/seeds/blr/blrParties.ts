import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
/** Byelorussia ruling party (Cold-War presets). The CPB, gated to 1953/1979.
 *
 *  One party only, matching Poland's plParties.ts. Poland at least had a
 *  satellite bloc on paper (the ZSL and SD sat in the Sejm under the PZPR), and
 *  the codebase still declines to seed them. Byelorussia had no equivalent at
 *  all: as a union republic its Supreme Soviet ran a single-list bloc of
 *  "communists and non-party people" with no second organisation to name, so
 *  adding a front or bloc party here would invent a body that never existed. */
export const blrParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "BLR",
    name: "Communist Party of Byelorussia",
    abbreviation: "CPB",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 2,
    foreignPolicy: -4,
    culture: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 550_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default blrParties;
