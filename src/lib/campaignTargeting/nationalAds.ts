/**
 * Nationwide contests with an aggregate electorate consume regional ads as a
 * population-weighted audience bonus. Unadvertised regions contribute zero,
 * preserving the existing aggregate vote model and the shared bonus cap.
 */
import type { CountryId } from "@/lib/constants/countries";
import type { Db } from "mongodb";
import type { State } from "@/lib/db/types";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
import { loadRegionalCampaignCells } from "./audience";
import { meanAdBonus, targetedAdBonuses } from "./rules";

export async function applyNationalAds(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  candidates: EnrichedCandidate[],
  groupIds: string[],
  preloadedStates?: Map<string, State>,
  campaignRulesVersion = 1
): Promise<EnrichedCandidate[]> {
  if (!candidates.some((candidate) => candidate.targetedAds?.length)) return candidates;
  const regions = preloadedStates
    ? [...preloadedStates.values()].filter(
        (state) => state.countryId === countryId && state._id !== countryId
      )
    : await db
        .collection<State>("states")
        .find({ countryId, _id: { $ne: countryId } })
        .toArray();
  const population = regions.reduce(
    (sum, state) => sum + (state.votingEligiblePopulation ?? state.population),
    0
  );
  if (!(population > 0)) return candidates;
  const purchased = new Set(
    candidates.flatMap((candidate) => candidate.targetedAds?.map((ad) => ad.stateId) ?? [])
  );
  const targets = regions.filter((state) => purchased.has(state._id));
  if (!targets.length) return candidates;
  const cellsByRegion = await loadRegionalCampaignCells(
    db,
    regions,
    campaignRulesVersion ? new Set() : new Set([`${countryId}:${countryId}`])
  );
  const cells = cellsByRegion.get(`${countryId}:${countryId}${campaignRulesVersion ? "" : ":0"}`);
  if (!cells) return candidates;
  return candidates.map((candidate) => {
    if (!candidate.targetedAds?.length) return candidate;
    const bonus = meanAdBonus(
      cells,
      targetedAdBonuses(
        cells,
        { economicLean: candidate.charEP, socialLean: candidate.charSP },
        candidate.targetedAds,
        countryId,
        currentTurn
      )
    );
    return {
      ...candidate,
      targetedAdBonuses: Object.fromEntries(groupIds.map((group) => [group, bonus])),
    };
  });
}
