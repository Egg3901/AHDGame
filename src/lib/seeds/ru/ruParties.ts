import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * USSR default political parties (1953 / 1979 presets).
 *
 * The Soviet Union was a strict one-party state — unlike China's united-front
 * model, there were no legal satellite parties. So only the CPSU is seeded as
 * the sole ruling party. The reformist wing that would emerge on liberalization
 * is handled dynamically via the country config's faction-defection / collapse
 * mechanics (`factionDefectionName`, `collapseTargetSystem`), not as a seeded
 * party.
 *
 * Gated to the 1953 and 1979 presets (`validForPresets`) — the USSR exists in
 * both Cold-War eras and dissolved in 1991. Positions on the -5..+5 scale.
 */
export const ruParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "RU",
    name: "Communist Party of the Soviet Union",
    abbreviation: "CPSU",
    color: "#CC0000",
    economicPosition: -4, // total state ownership, Gosplan central planning
    socialPosition: 2, // officially secular but socially authoritarian / conformist
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
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
];

export default ruParties;
