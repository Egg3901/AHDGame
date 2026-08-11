import { ObjectId, type Db } from "mongodb";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import type { Character, Election, ElectionCandidate, NPP, NPPRelationship } from "@/lib/db/types";
import { CAPITAL_ACTIONS } from "@/lib/capital/actions";
import {
  getRequestedEndorsementLikelihood,
  getRequestedEndorsementRelationshipRequirement,
  nppCanPlausiblyEndorseElection,
  type RequestedEndorsementLikelihood,
} from "@/lib/nppEndorsements";

interface EndorsementRequestEvaluation {
  relationshipRequirement: number;
  likelihood: RequestedEndorsementLikelihood;
  canRequest: boolean;
}

export function evaluateRequestedEndorsement(params: {
  npp: NPP;
  election: Election;
  candidateCharacter: Pick<Character, "policies">;
  relationshipScore: number;
}): EndorsementRequestEvaluation {
  const relationshipRequirement = getRequestedEndorsementRelationshipRequirement(
    params.npp,
    params.candidateCharacter
  );
  const likelihood = getRequestedEndorsementLikelihood(
    params.relationshipScore,
    relationshipRequirement
  );
  return {
    relationshipRequirement,
    likelihood,
    canRequest:
      nppCanPlausiblyEndorseElection(params.npp, params.election) && likelihood === "likely_accept",
  };
}

export async function getNppDirectActionView(
  db: Db,
  {
    characterId,
    nppId,
  }: {
    characterId: ObjectId;
    nppId: ObjectId;
  }
) {
  const forexEnabled = await isForexEnabled();
  const relationshipKey = `${characterId.toString()}_${nppId.toString()}`;
  const [npp, characterDoc, relationship] = await Promise.all([
    db.collection<NPP>("npps").findOne({ _id: nppId }),
    db.collection<Character>("characters").findOne(
      { _id: characterId },
      {
        projection: {
          _id: 1,
          actions: 1,
          funds: 1,
          currencyBalances: 1,
          policies: 1,
          countryId: 1,
        },
      }
    ),
    db.collection<NPPRelationship>("nppRelationships").findOne({ _id: relationshipKey }),
  ]);

  if (!npp) {
    return { error: "NPP not found", status: 404 } as const;
  }
  if (!characterDoc) {
    return { error: "Character not found", status: 404 } as const;
  }

  const currentActions = characterDoc.actions ?? 0;
  const useForexCampaignBalance =
    forexEnabled && typeof characterDoc.currencyBalances?.campaign === "number";
  const { rate: homeFxRate } = useForexCampaignBalance
    ? await loadCharacterFxRate(db, getHomeCurrency(characterDoc))
    : { rate: 1 };
  // Stored balance in LOCAL home-currency — what the player actually sees.
  const currentFundsStored = characterDoc.currencyBalances?.campaign ?? characterDoc.funds ?? 0;
  // Anchor-unit balance — used for gating against fundCost (which is anchor).
  const currentFunds = useForexCampaignBalance
    ? currentFundsStored / homeFxRate
    : currentFundsStored;
  const homeCurrency = getHomeCurrency(characterDoc);
  const currencySymbol = CURRENCY_SYMBOLS[homeCurrency] ?? "$";
  const currentRelationship = relationship?.relationshipScore ?? 0;
  const isRetired = !!npp.retiredAt;

  let candidacies: Array<{
    id: string;
    label: string;
    electionLabel: string;
    endorsementLikelihood: RequestedEndorsementLikelihood;
    canRequest: boolean;
  }> = [];

  if (!isRetired) {
    const playerCandidacies = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ characterId, status: "active" })
      .project<{
        _id: ObjectId;
        characterName: string;
        electionId: ObjectId;
      }>({ _id: 1, characterName: 1, electionId: 1 })
      .toArray();

    if (playerCandidacies.length > 0) {
      const elections = await db
        .collection<Election>("elections")
        .find({ _id: { $in: playerCandidacies.map((candidacy) => candidacy.electionId) } })
        .project<{
          _id: ObjectId;
          countryId: string;
          electionType: string;
          state: string;
          senateClass?: number;
        }>({ _id: 1, countryId: 1, electionType: 1, state: 1, senateClass: 1 })
        .toArray();
      const electionById = new Map(
        elections.map((election) => [election._id.toString(), election])
      );

      candidacies = playerCandidacies
        .map((candidacy) => {
          const election = electionById.get(candidacy.electionId.toString());
          if (!election || !nppCanPlausiblyEndorseElection(npp, election as Election)) {
            return null;
          }
          const evaluation = evaluateRequestedEndorsement({
            npp,
            election: election as Election,
            candidateCharacter: characterDoc,
            relationshipScore: currentRelationship,
          });
          return { candidacy, election, evaluation };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .map(({ candidacy, election, evaluation }) => ({
          id: candidacy._id.toString(),
          label: candidacy.characterName,
          electionLabel: `${election.state} ${election.electionType}${
            election.electionType === "senate" && election.senateClass
              ? ` (Class ${election.senateClass})`
              : ""
          }`,
          endorsementLikelihood: evaluation.likelihood,
          canRequest: evaluation.canRequest,
        }));
    }
  }

  const targetFavorability = npp.favorability ?? 50;
  const targetPoliticalInfluence = npp.politicalInfluence ?? 0;

  const actions = Object.values(CAPITAL_ACTIONS).map((config) => {
    const meetsActions = currentActions >= config.actionCost;
    const meetsFunds = currentFunds >= config.fundCost;
    // config.fundCost is ANCHOR; the stored display is in LOCAL.
    const fundCostStored = Math.round(
      useForexCampaignBalance ? config.fundCost * homeFxRate : config.fundCost
    );
    const meetsRelationship =
      config.minRelationship == null ? true : currentRelationship >= config.minRelationship;
    const hasEligibleEndorsementCampaign = candidacies.length > 0;

    // Short-circuit boost/reduce when target stat is pinned at cap/floor —
    // mirrors validateCapitalAction so the UI button reflects the same gate.
    let statCapNote: string | null = null;
    if (config.type === "boost_favorability" && targetFavorability >= 100) {
      statCapNote = "Already maxed (100% favorability).";
    } else if (config.type === "boost_influence" && targetPoliticalInfluence >= 100) {
      statCapNote = "Already maxed (100% political influence).";
    } else if (config.type === "reduce_favorability" && targetFavorability <= 0) {
      statCapNote = "Already at floor (0% favorability).";
    } else if (config.type === "reduce_influence" && targetPoliticalInfluence <= 0) {
      statCapNote = "Already at floor (0% political influence).";
    }

    const enabled =
      !isRetired &&
      meetsActions &&
      meetsFunds &&
      meetsRelationship &&
      statCapNote == null &&
      (config.type !== "request_endorsement" || hasEligibleEndorsementCampaign);

    return {
      type: config.type,
      label: config.label,
      description: config.description,
      actionCost: config.actionCost,
      fundCost: fundCostStored,
      minRelationship: config.minRelationship,
      effectBlurb: config.effectBlurb,
      enabled,
      meetsActions,
      meetsFunds,
      meetsRelationship,
      availabilityNote:
        statCapNote ??
        (config.type === "request_endorsement"
          ? hasEligibleEndorsementCampaign
            ? "Choose an active campaign to see whether this NPP is likely to accept."
            : "You have no active eligible campaigns for this NPP to endorse."
          : null),
    };
  });

  return {
    balance: {
      current: currentActions,
      funds: currentFundsStored,
    },
    homeCurrency,
    currencySymbol,
    relationship: { score: currentRelationship },
    isRetired,
    actions,
    pickerOptions: {
      candidacies,
    },
  } as const;
}
