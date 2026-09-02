/**
 * National Front bloc-list quotas.
 *
 * WHAT A BLOC-LIST ELECTION IS. Several one-party states did not hold a contest
 * between parties at all. They ran a SINGLE list, agreed in advance, on which
 * every participating party had a fixed seat quota, and the electorate voted the
 * list up or down. The DDR's National Front is the type specimen: the 1954
 * Volkskammer returned 466 seats on one list with 99.46% of the vote, and the
 * seat split was a negotiated allocation, not an outcome.
 *
 *   SED   117    Free German Trade Union Federation (FDGB)  53
 *   CDU    52    Democratic Women's League (DFD)            29
 *   LDPD   52    Free German Youth (FDJ)                    29
 *   NDPD   52    Cultural Association (Kulturbund)          18
 *   DBD    52    Peasants Mutual Aid (VdgB)                 12
 *
 * WHY THE GAME NEEDS THIS RATHER THAN A VOTE MULTIPLIER. Before this, the DDR
 * resolved as ordinary multi-seat proportional PR with the ruling party carrying
 * `DEFAULT_OPS_VOTE_MULTIPLIERS.ruling` (3.0) against the bloc parties' 0.375.
 * That multiplier is one factor in a stack that also contains policy-distance
 * appeal, party fit, regional bases and per-group favourability, and the appeal
 * term swings far wider than 8x. So the weighting lost. On the live 1953 world
 * the Berlin-Ost Volkskammer race projected:
 *
 *   LDPD 35.9%   SED 19.1%   DBD 19.0%   CDU 17.8%   NDPD 8.2%
 *
 * against the 66.7 / 8.3 / 8.3 / 8.3 / 8.3 the character-creation notice
 * promises players. The ruling party of a one-party state was running third and
 * would have handed the largest Volkskammer delegation to the LDPD. Raising the
 * multiplier only moves the threshold at which a well-fitted candidate breaks
 * it; the multiplier is simply the wrong instrument for a chamber whose seats
 * were never contested between parties.
 *
 * Under a quota the numbers cannot be gamed by candidate positioning, because
 * the party split is not an outcome of the vote. The vote decides WHO fills each
 * party's slots, which is the contest DDR politics actually had, and the one the
 * players are already in.
 *
 * MASS ORGANISATIONS. The game models five DD parties and no mass organisations,
 * so the 141 seats held by the FDGB, DFD, FDJ, Kulturbund and VdgB have to go
 * somewhere. They fold into the SED, which is where their political control
 * actually sat: all five were SED-run transmission belts whose delegations voted
 * with the party. That gives the SED 25.1% nominal + 30.3% organisational =
 * 55.4%, and leaves each bloc party on its exact historical 11.2%. Rounded to
 * 55 / 11.25 x 4, which sums to 100 exactly.
 *
 * The alternative, giving the SED only its nominal 25%, would model the
 * institution and lose the politics: a ruling party without a working majority
 * in its own rubber-stamp parliament cannot govern, and the DDR's SED plainly
 * could.
 */

import type { CountryId, GovernmentType } from "./countries";

export interface BlocListQuota {
  /** Display name of the alliance, for UI copy. */
  label: string;
  /**
   * Party `sequentialId` (as a string, matching `ElectionCandidate.party`)
   * mapped to its share of the chamber. Values are weights and are normalised,
   * so they do not have to sum to 100.
   */
  shares: Readonly<Record<string, number>>;
}

/**
 * Per-country bloc-list quotas. A country absent from this map resolves its
 * elections normally, so this is inert for every country but the DDR today.
 *
 * DD party sequentialIds: 1 SED, 2 CDU, 3 LDPD, 4 NDPD, 5 DBD.
 */
export const BLOC_LIST_QUOTAS: Partial<Record<CountryId, BlocListQuota>> = {
  DD: {
    label: "National Front",
    shares: {
      "1": 55, // SED, including the mass organisations it controlled
      "2": 11.25, // CDU
      "3": 11.25, // LDPD
      "4": 11.25, // NDPD
      "5": 11.25, // DBD
    },
  },
};

/** The bloc-list quota for a country, or null when it holds ordinary elections. */
export function blocListQuota(countryId: string | null | undefined): BlocListQuota | null {
  if (!countryId) return null;
  return BLOC_LIST_QUOTAS[countryId as CountryId] ?? null;
}

/** True when the country allocates legislative seats by bloc-list quota. */
export function isBlocListCountry(countryId: string | null | undefined): boolean {
  return blocListQuota(countryId) !== null;
}

/**
 * Runtime quota for an election. A country keeps its historical quota config,
 * but a democratic regime conversion must immediately switch its elections to
 * ordinary allocation.
 */
export function blocListQuotaForGovernment(
  countryId: string | null | undefined,
  governmentType: GovernmentType | null | undefined
): BlocListQuota | null {
  return governmentType === "onePartyState" ? blocListQuota(countryId) : null;
}
