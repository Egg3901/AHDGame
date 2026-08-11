import type { PartySeed } from "@/lib/seeds/reference/politicalParties";

/**
 * Ukraine ruling party (Cold-War presets). The Communist Party of Ukraine was a
 * republican branch of the CPSU, not an independent party, and there was no
 * legal alternative in either authored era, so the roster is a single entry
 * gated to 1953/1979. Party record ids are minted with the `ua_kpu` prefix.
 *
 * Positions sit where a republican branch sits: economically at the planned
 * extreme, socially conservative, and even more Moscow-aligned on foreign
 * policy than the satellite parties (BKP -3, PZPR -2), because the KPU had no
 * foreign policy of its own. Culture is set slightly below the Byelorussian
 * branch: the KPU under Shelest tolerated a measure of national-cultural
 * assertion in the 1960s before Shcherbytsky's Russification drive, and 1953
 * Ukraine had a live memory of the west's dissolved Uniate church, so the
 * party is a shade less flatly assimilationist in posture than the CPB.
 *
 * Treasury is set above Belarus and Bulgaria and above Poland's PZPR: the KPU
 * was by a wide margin the largest republican party organisation outside the
 * RSFSR.
 */
export const uaParties: PartySeed[] = [
  {
    seedOrder: 1,
    countryId: "UKR",
    name: "Communist Party of Ukraine",
    abbreviation: "KPU",
    color: "#C00000",
    economicPosition: -4,
    socialPosition: 2,
    foreignPolicy: -4,
    culture: 1,
    memberCount: 0,
    isDefault: true,
    validForPresets: ["1953-default", "1979-default"],
    regimeStatus: "ruling",
    treasury: 900_000,
    nationalTaxRate: 0,
    politicalStrength: 0,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    createdBy: null,
  },
];
export default uaParties;
