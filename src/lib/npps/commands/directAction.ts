import { ObjectId, type ClientSession, type Db } from "mongodb";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type {
  CapitalActionLog,
  Character,
  Election,
  ElectionCandidate,
  GameState,
  NPP,
  NPPEndorsement,
  NPPRelationship,
} from "@/lib/db/types";
import {
  buildCapitalActionPlan,
  validateCapitalAction,
  type CapitalActionContext,
} from "@/lib/capital/actions";
import {
  getEndorsementDecisionPhase,
  nppCanPlausiblyEndorseElection,
  upsertNppEndorsement,
} from "@/lib/nppEndorsements";
import { evaluateRequestedEndorsement } from "@/lib/npps/queries/directAction";
import { isSameCountry } from "@/lib/api/sameCountry";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

export class DirectActionBalanceConflictError extends Error {}

interface DirectActionRollbackSnapshot {
  relationship: NPPRelationship | null;
  endorsementElectionId?: ObjectId;
  endorsements?: NPPEndorsement[];
}

export async function applyNppDirectAction(
  db: Db,
  {
    nppId,
    characterId,
    actorParty,
    action,
    candidacyId,
  }: {
    nppId: ObjectId;
    characterId: ObjectId;
    actorParty?: string;
    action:
      | "request_endorsement"
      | "private_meeting"
      | "boost_favorability"
      | "boost_influence"
      | "reduce_favorability"
      | "reduce_influence";
    candidacyId?: string;
  }
) {
  const forexEnabled = await isForexEnabled();
  const relationshipKey = `${characterId.toString()}_${nppId.toString()}`;
  const [npp, characterDoc, relationshipDoc, gameStateDoc] = await Promise.all([
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
          stats: 1,
        },
      }
    ),
    db.collection<NPPRelationship>("nppRelationships").findOne({ _id: relationshipKey }),
    db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
  ]);

  if (!npp) return { error: "NPP not found", status: 404 } as const;
  if (!characterDoc) return { error: "Character not found", status: 404 } as const;

  if (!isSameCountry(characterDoc, npp)) {
    return {
      error: "You cannot interact with politicians from other countries",
      status: 400,
    } as const;
  }

  const currentActions = characterDoc.actions ?? 0;
  const useForexCampaignBalance =
    forexEnabled && typeof characterDoc.currencyBalances?.campaign === "number";
  const { rate: homeFxRate } = useForexCampaignBalance
    ? await loadCharacterFxRate(db, getHomeCurrency(characterDoc))
    : { rate: 1 };
  // validateCapitalAction expects ANCHOR units (action plans are anchor-denominated).
  // Read the LOCAL stored balance and convert to anchor.
  const balanceLocal = characterDoc.currencyBalances?.campaign ?? characterDoc.funds ?? 0;
  const currentFunds = useForexCampaignBalance ? balanceLocal / homeFxRate : balanceLocal;
  const currentRelationship = relationshipDoc?.relationshipScore ?? 0;
  const currentTurn = gameStateDoc?.currentTurn ?? 0;

  const validationCtx: CapitalActionContext = {
    currentActions,
    currentFunds,
    currentRelationship,
    isRetired: !!npp.retiredAt,
    targetFavorability: npp.favorability ?? 50,
    targetPoliticalInfluence: npp.politicalInfluence ?? 0,
    context: { candidacyId },
  };
  const validation = validateCapitalAction(action, validationCtx);
  if (!validation.ok || !validation.config) {
    return {
      error: validation.message ?? "Action rejected",
      failure: validation.failure,
      status: 400,
    } as const;
  }

  if (action === "request_endorsement") {
    const candidacy = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      _id: new ObjectId(candidacyId!),
      characterId,
      status: "active",
    });
    if (!candidacy || candidacy.isNPP) {
      return { error: "Selected candidacy is not active.", status: 400 } as const;
    }

    const election = await db
      .collection<Election>("elections")
      .findOne({ _id: candidacy.electionId });
    if (!election) {
      return { error: "Selected candidacy is not active.", status: 400 } as const;
    }
    if (!nppCanPlausiblyEndorseElection(npp, election)) {
      return {
        error: "This NPP cannot endorse a candidacy outside their country.",
        status: 400,
      } as const;
    }

    const evaluation = evaluateRequestedEndorsement({
      npp,
      election,
      candidateCharacter: characterDoc,
      relationshipScore: currentRelationship,
    });
    if (!evaluation.canRequest) {
      return {
        error: "This NPP is likely to decline your endorsement request right now.",
        failure: "relationship_too_low",
        status: 400,
      } as const;
    }
  }

  const plan = buildCapitalActionPlan(action, validationCtx);
  const now = new Date();

  // Charisma scales the upside of relationship-building / favorability boosts
  // (gentle ±20%). Only positive deltas are amplified; reduce/penalty actions
  // keep their fixed magnitude. Unmigrated characters use a neutral 1.0×.
  const charismaMult = statMultiplier(characterDoc.stats?.charisma ?? NEUTRAL_STAT);
  const relationshipDelta =
    plan.relationshipDelta > 0
      ? Math.round(plan.relationshipDelta * charismaMult)
      : plan.relationshipDelta;
  const rawFavDelta = plan.sideEffects.favorabilityDelta ?? 0;
  const favorabilityDelta = rawFavDelta > 0 ? Math.round(rawFavDelta * charismaMult) : rawFavDelta;

  const newRelationship = Math.max(-100, Math.min(100, currentRelationship + relationshipDelta));
  const updatedFavorability = Math.min(100, Math.max(0, npp.favorability + favorabilityDelta));
  const updatedPoliticalInfluence = Math.min(
    100,
    Math.max(0, npp.politicalInfluence + (plan.sideEffects.politicalInfluenceDelta ?? 0))
  );

  // plan.fundCost is ANCHOR (derived from anchor-valued currentFunds in the
  // capital-action plan). Convert to LOCAL once for the filter + $inc.
  const fundCostLocal = useForexCampaignBalance ? plan.fundCost * homeFxRate : plan.fundCost;
  const campaignFundsField = useForexCampaignBalance ? "currencyBalances.campaign" : "funds";

  const applyDirectAction = async (
    session?: ClientSession,
    onActionSpent?: () => void
  ): Promise<{ actions: number; funds: number }> => {
    const characterUpdate = await db.collection<Character>("characters").findOneAndUpdate(
      {
        _id: characterId,
        actions: { $gte: plan.actionCost },
        [campaignFundsField]: { $gte: fundCostLocal },
      },
      {
        $inc: {
          actions: -plan.actionCost,
          [campaignFundsField]: -fundCostLocal,
        },
      },
      { returnDocument: "after", ...(session ? { session } : {}) }
    );
    if (!characterUpdate) {
      throw new DirectActionBalanceConflictError(
        "Action balance changed mid-interaction; reload and try again."
      );
    }

    onActionSpent?.();

    await db.collection<NPPRelationship>("nppRelationships").updateOne(
      { _id: relationshipKey },
      {
        $set: {
          relationshipScore: newRelationship,
          lastAttemptTurn: currentTurn,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: relationshipKey,
          characterId,
          nppId,
          createdAt: now,
        },
        $inc: { totalAttempts: 1, successfulAttempts: 1 },
      },
      { upsert: true, ...(session ? { session } : {}) }
    );

    const context: CapitalActionLog["context"] = {};
    if (plan.sideEffects.createEndorsement) {
      const candidacyOid = new ObjectId(plan.sideEffects.createEndorsement.candidacyId);
      const candidacy = await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne({ _id: candidacyOid, status: "active" }, session ? { session } : undefined);
      if (candidacy) {
        const [election, candidateCountAtDecision] = await Promise.all([
          db
            .collection<Election>("elections")
            .findOne({ _id: candidacy.electionId }, session ? { session } : undefined),
          db
            .collection<ElectionCandidate>("electionCandidates")
            .countDocuments(
              { electionId: candidacy.electionId, status: "active" },
              session ? { session } : undefined
            ),
        ]);

        if (election) {
          await upsertNppEndorsement(db, {
            npp,
            candidate: candidacy,
            source: "arranged",
            now,
            currentTurn,
            candidateCountAtDecision,
            electionPhaseAtDecision: getEndorsementDecisionPhase(election, currentTurn, now),
            arrangedBy: characterId,
            arrangedByParty: actorParty,
            session,
          });
        }
      }
      context.candidacyId = candidacyOid;
    }

    if (
      plan.sideEffects.favorabilityDelta !== undefined ||
      plan.sideEffects.politicalInfluenceDelta !== undefined
    ) {
      await db.collection<NPP>("npps").updateOne(
        { _id: nppId },
        {
          $set: {
            favorability: updatedFavorability,
            politicalInfluence: updatedPoliticalInfluence,
            updatedAt: now,
          },
        },
        session ? { session } : undefined
      );
    }

    await db.collection<CapitalActionLog>("capitalActionLogs").insertOne(
      {
        _id: new ObjectId(),
        characterId,
        nppId,
        action,
        actionsSpent: plan.actionCost,
        fundsSpent: plan.fundCost,
        relationshipBefore: currentRelationship,
        relationshipAfter: newRelationship,
        effectSummary: plan.effectSummary,
        context,
        turn: currentTurn,
        createdAt: now,
      },
      session ? { session } : undefined
    );

    return {
      actions: characterUpdate.actions,
      funds: characterUpdate.currencyBalances?.campaign ?? characterUpdate.funds ?? 0,
    };
  };

  const remainingBalances = await runWithOptionalTransaction(
    async (session) => applyDirectAction(session),
    async () => {
      const rollbackSnapshot: DirectActionRollbackSnapshot = { relationship: relationshipDoc };
      if (plan.sideEffects.createEndorsement) {
        const candidacy = await db.collection<ElectionCandidate>("electionCandidates").findOne({
          _id: new ObjectId(plan.sideEffects.createEndorsement.candidacyId),
        });
        if (candidacy) {
          rollbackSnapshot.endorsementElectionId = candidacy.electionId;
          rollbackSnapshot.endorsements = await db
            .collection<NPPEndorsement>("nppEndorsements")
            .find({ nppId, electionId: candidacy.electionId })
            .toArray();
        }
      }

      let actionSpent = false;
      try {
        return await applyDirectAction(undefined, () => {
          actionSpent = true;
        });
      } catch (error) {
        if (actionSpent) {
          await db.collection<Character>("characters").updateOne(
            { _id: characterId },
            {
              $inc: {
                actions: plan.actionCost,
                [campaignFundsField]: fundCostLocal,
              },
            }
          );
        }
        if (rollbackSnapshot.relationship) {
          await db
            .collection<NPPRelationship>("nppRelationships")
            .replaceOne({ _id: relationshipKey }, rollbackSnapshot.relationship, {
              upsert: true,
            });
        } else {
          await db
            .collection<NPPRelationship>("nppRelationships")
            .deleteOne({ _id: relationshipKey });
        }
        if (
          plan.sideEffects.favorabilityDelta !== undefined ||
          plan.sideEffects.politicalInfluenceDelta !== undefined
        ) {
          await db.collection<NPP>("npps").updateOne(
            { _id: nppId },
            {
              $set: {
                favorability: npp.favorability,
                politicalInfluence: npp.politicalInfluence,
                updatedAt: npp.updatedAt,
              },
            }
          );
        }
        if (rollbackSnapshot.endorsementElectionId) {
          await db.collection<NPPEndorsement>("nppEndorsements").deleteMany({
            nppId,
            electionId: rollbackSnapshot.endorsementElectionId,
          });
          if ((rollbackSnapshot.endorsements?.length ?? 0) > 0) {
            await db
              .collection<NPPEndorsement>("nppEndorsements")
              .insertMany(rollbackSnapshot.endorsements!);
          }
        }
        throw error;
      }
    }
  );

  const homeCurrency = getHomeCurrency(characterDoc);
  const currencySymbol = CURRENCY_SYMBOLS[homeCurrency] ?? "$";

  return {
    success: true,
    effect: plan.effectSummary,
    action,
    actions: {
      current: remainingBalances.actions,
      spent: plan.actionCost,
    },
    funds: {
      current: remainingBalances.funds,
      // fundCostLocal is the stored (home-currency) amount we just debited.
      spent: Math.round(fundCostLocal),
    },
    homeCurrency,
    currencySymbol,
    relationship: {
      before: currentRelationship,
      after: newRelationship,
      delta: relationshipDelta,
    },
  } as const;
}
