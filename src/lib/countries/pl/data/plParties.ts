import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
/** Poland ruling party (Cold-War presets). PZPR, gated to 1953/1979. */
export const plParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "PL",
    name: "Polska Zjednoczona Partia Robotnicza",
    abbreviation: "PZPR",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 800_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default plParties;
