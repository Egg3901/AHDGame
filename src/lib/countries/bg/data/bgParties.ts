import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { bgParties2027 } from "./bgParties2027";
export const bgParties: PartySeed[] = [
  ...bgParties2027,
  {
    seedOrder: 1,
    countryId: "BG",
    name: "Bulgarian Communist Party",
    abbreviation: "BKP",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 2,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 600_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default bgParties;
