import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
/** Yugoslavia ruling party (Cold-War presets — Tito's League of Communists). SKJ, gated to 1953/1979. */
export const yuParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "YU",
    name: "Savez komunista Jugoslavije",
    abbreviation: "SKJ",
    color: "#C00000",
    economicPosition: -3,
    socialPosition: 1,
    // Non-aligned (0): expelled from Cominform 1948; never Warsaw Pact; received
    // US military/economic aid in the 1950s while remaining a one-party communist
    // state. Contrast HU/CS/BG ruling parties at foreignPolicy -3 (Soviet satellite).
    foreignPolicy: 0,
    culture: 1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 700_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default yuParties;
