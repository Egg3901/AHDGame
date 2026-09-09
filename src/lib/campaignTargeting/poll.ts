/**
 * Campaign polls read the same turnout inputs and targeted ad responses as
 * election counting. projectCampaignPoll estimates the next slice of voters;
 * it does not rewrite ballots already counted or reveal rivals' ad purchases.
 */

import { COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS } from "@/lib/constants/countries";
import { resolveTurnout } from "@/lib/electionEngine/resolvedTurnout";
import {
  calcPrimaryScore,
  primarySharePctSoftmax,
  PRIMARY_SHARE_SOFTMAX_TEMPERATURE,
} from "@/lib/primaryScore";
import { NPP_PRIMARY_SCORE_MULTIPLIER } from "@/lib/electionEngine/constants";
import {
  shiftDemographicsForPrimary,
  applyPrimaryTurnoutRetention,
} from "@/lib/campaigns/shiftPrimaryElectorate";
import { ObjectId, type Db } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  StateDemographicTurnout,
  StatePartyOrg,
} from "@/lib/db/types";
import { fetchEnrichedCandidates } from "@/lib/electionEngine/candidateEnrichment";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import { distributeVotesBySwingFlow } from "@/lib/electionEngine/voteDistributionSwingFlow";
import { buildGranularElectorateSubstrate } from "@/lib/demographics/granularElectorate";
import { loadCampaignAudience } from "./audience";
import {
  targetedAdBonuses,
  turnoutForElection,
  usesCampaignAds,
  campaignPrimaryScore,
  meanAdBonus,
  organizationAdWeight,
  NG_CAMPAIGN_TURNOUT_RATE,
} from "./rules";

export async function projectCampaignPoll(
  db: Db,
  electionId: string,
  character: Character,
  turnoutDoc: StateDemographicTurnout | null,
  partyOrgs: StatePartyOrg[],
  inPrimary: boolean
) {
  const election = await db
    .collection<Election>("elections")
    .findOne({ _id: new ObjectId(electionId), countryId: character.countryId });
  if (!election) return null;
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      electionId: election._id,
      status: "active",
      ...(inPrimary ? { party: character.party } : {}),
    })
    .toArray();
  const myCandidate = candidates.find((candidate) => candidate.characterId.equals(character._id));
  if (!myCandidate) return null;
  const [audience, enriched] = await Promise.all([
    loadCampaignAudience(db, character.countryId, character.homeState, turnoutDoc),
    fetchEnrichedCandidates(candidates, {
      includePartyPositions: true,
      countryId: character.countryId,
    }),
  ]);
  if (!audience || !usesCampaignAds(election, enriched)) return null;
  const substrate = buildGranularElectorateSubstrate({
    ...audience.context,
    campaignRulesVersion: election.campaignRulesVersion ?? 0,
    turnoutDoc: turnoutForElection(turnoutDoc, election),
    liveTurnouts: resolveTurnout(
      audience.context.statePopulation,
      audience.context.demographics,
      audience.context.categories,
      turnoutForElection(turnoutDoc, election),
      audience.context
    ).byGroup,
    enriched,
  });
  if (!substrate?.campaignCells) return null;
  const presidential = election.electionType === "president";
  const cells = substrate.campaignCells;
  const bonusesByCandidate = Object.fromEntries(
    enriched.map((candidate) => [
      candidate.candidateId,
      targetedAdBonuses(
        cells,
        { economicLean: candidate.charEP, socialLean: candidate.charSP },
        candidate.targetedAds ?? [],
        character.homeState,
        audience.context.currentTurn
      ),
    ])
  );
  const base = {
    myCandidateId: myCandidate._id.toString(),
    totalPool: substrate.totalPool,
    cells,
    bonusesByCandidate,
  };
  if (presidential && COUNTRIES_WITH_BESPOKE_PRESIDENTIAL_ELECTIONS.has(election.countryId)) {
    if (election.countryId !== "NG" || inPrimary) return null;
    const weights = enriched.map((candidate) => {
      const org =
        partyOrgs.find(
          (row) => row.stateId === character.homeState && row.partyId === candidate.party
        )?.organization ?? 0;
      return organizationAdWeight(
        org,
        meanAdBonus(cells, bonusesByCandidate[candidate.candidateId])
      );
    });
    const sum = weights.reduce((total, weight) => total + weight, 0);
    const pool = audience.context.statePopulation * NG_CAMPAIGN_TURNOUT_RATE;
    return {
      ...base,
      totalPool: pool,
      votes: Object.fromEntries(
        enriched.map((candidate, index) => [
          candidate.candidateId,
          sum > 0 ? (pool * weights[index]) / sum : 0,
        ])
      ),
    };
  }
  if (inPrimary && !presidential) {
    const scores = enriched.map(
      (candidate) =>
        calcPrimaryScore(
          candidate.charEP,
          candidate.charSP,
          candidate.partyEcon ?? 0,
          candidate.partySocial ?? 0,
          candidate.favorability,
          candidate.politicalInfluence,
          candidate.infamy,
          audience.context.stateEconomicLean,
          audience.context.stateSocialLean
        ) * (candidate.isNPP ? NPP_PRIMARY_SCORE_MULTIPLIER : 1)
    );
    const adjusted = primarySharePctSoftmax(
      scores.map((score, index) =>
        campaignPrimaryScore(
          score,
          meanAdBonus(cells, bonusesByCandidate[enriched[index].candidateId]),
          PRIMARY_SHARE_SOFTMAX_TEMPERATURE
        )
      )
    );
    const registration = partyOrgs.find((org) => org.partyId === character.party)?.registration;
    const pool =
      substrate.totalPool *
      (typeof registration === "number" ? Math.min(100, Math.max(0, registration)) / 100 : 1);
    return {
      ...base,
      totalPool: pool,
      votes: Object.fromEntries(
        enriched.map((candidate, i) => [candidate.candidateId, (adjusted[i] / 100) * pool])
      ),
    };
  }
  let demographics = substrate.demographics;
  let liveTurnouts = substrate.liveTurnouts;
  if (inPrimary) {
    const position = {
      economicPosition: enriched[0]?.partyEcon ?? 0,
      socialPosition: enriched[0]?.partySocial ?? 0,
    };
    demographics = shiftDemographicsForPrimary(substrate.demographics, position);
    liveTurnouts = applyPrimaryTurnoutRetention(
      substrate.liveTurnouts,
      substrate.demographics,
      position
    );
  }

  const distribute = inPrimary ? distributeVotesByGroupLevelAllocation : distributeVotesBySwingFlow;
  const result = distribute(
    substrate.enriched,
    substrate.totalPool,
    substrate.totalPool,
    audience.context.statePopulation,
    demographics,
    substrate.categories,
    new Map(partyOrgs.map((org) => [org.partyId, org.organization])),
    {
      isGeneralElection: !inPrimary,
      currentStateId: character.homeState,
      countryId: character.countryId,
      liveTurnouts,
      useAveragedPositions: presidential && !inPrimary,
      partyPositionWeight: presidential ? 1 / 3 : undefined,
      useNationalInfluenceForReach: presidential,
      presidentialPrimaryNationalReach: presidential && inPrimary,
      hasPlayerInRace: true,
      votingSystem: presidential ? "rcv" : audience.context.votingSystem,
    }
  );
  return { ...base, votes: result.votesPerCandidate };
}

export type CampaignPollProjection = NonNullable<Awaited<ReturnType<typeof projectCampaignPoll>>>;
