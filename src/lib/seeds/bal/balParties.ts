import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Baltic ruling party (Cold-War presets), gated to 1953/1979.
 *
 * One party, as with PL/BG/CS. The three republican parties (the Estonian,
 * Latvian and Lithuanian Communist Parties) were not separate organisations in
 * any meaningful sense: they were republican branches of the CPSU, bound by
 * democratic centralism and staffed at the top by cadres sent from Moscow or
 * by returning Russian-speaking "Yestonians" and "Latovichi". Seeding three
 * parties would imply a federal party system that did not exist, so the seed
 * carries the single branch organisation and lets the republican split live in
 * the regions and the census instead.
 *
 * Positions relative to the satellite parties: this is not a satellite state
 * with its own foreign ministry but a set of union republics inside the USSR.
 * The treasury is the smallest of
 * the bloc set for the same reason — a republican party organisation had a much
 * thinner independent purse than the PZPR or the BKP.
 */
export const balParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "BAL",
    name: "Communist Party of the Soviet Union (Baltic Republican Organisations)",
    abbreviation: "CPSU",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 500_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default balParties;
