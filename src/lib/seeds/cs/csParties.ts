import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
export const csParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "CS",
    name: "Komunistická strana Československa",
    abbreviation: "KSČ",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 650_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default csParties;
