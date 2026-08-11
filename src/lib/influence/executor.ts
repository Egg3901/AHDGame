import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { localCampaignBalance } from "@/lib/currency/campaignBalance";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import type {
  Character,
  Election,
  NPP,
  NPPRelationship,
  NPPInfluenceAttempt,
  InfluenceType,
  InfluenceOutcome,
  ElectionCandidate,
  GameState,
} from "@/lib/db/types";
import {
  calculateInfluenceChance,
  rollInfluence,
  determineOutcome,
  getOutcomeMessage,
  getRelationshipChange,
  type InfluenceCalculation,
} from "./calculator";
import { INFLUENCE_ACTIONS, INFLUENCE_LIMITS } from "./constants";
import { activeNppElectionCandidacyFilter } from "@/lib/elections/nppCandidacyQuery";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";
import {
  getEndorsementDecisionPhase,
  isSelfEndorsementCandidate,
  nppCanPlausiblyEndorseElection,
  upsertNppEndorsement,
} from "@/lib/nppEndorsements";

export interface ExecuteInfluenceInput {
  characterId: ObjectId;
  nppId: ObjectId;
  influenceType: InfluenceType;
  fundAmount: number;
  context: {
    electionId?: string;
    candidateId?: string;
  };
}

export interface ExecuteInfluenceResult {
  success: boolean;
  outcome: InfluenceOutcome;
  message: string;
  calculation: InfluenceCalculation;
  roll: number;
  relationshipChange: number;
  newRelationshipScore: number;
  error?: string;
}

export async function validateInfluenceAttempt(
  character: Character,
  npp: NPP,
  influenceType: InfluenceType,
  fundAmount: number,
  context: ExecuteInfluenceInput["context"],
  forexEnabled = false
): Promise<{ valid: boolean; error?: string }> {
  const actionConfig = INFLUENCE_ACTIONS[influenceType];
  const db = await getDb();
  const { rate: homeFxRate } = forexEnabled
    ? await loadCharacterFxRate(db, getHomeCurrency(character))
    : { rate: 1 };

  const totalActionCost = actionConfig.actionCost;
  if (character.actions < totalActionCost) {
    return {
      valid: false,
      error: `Not enough actions. Need ${totalActionCost}, have ${character.actions}.`,
    };
  }

  const totalFundCost = actionConfig.baseFundCost + fundAmount;
  // totalFundCost is ANCHOR; balance is LOCAL. Convert at boundary for the
  // pre-check; the atomic guard further down also operates in local units.
  const totalFundCostLocal = forexEnabled ? totalFundCost * homeFxRate : totalFundCost;
  const balanceLocal = localCampaignBalance(character, forexEnabled);
  if (balanceLocal < totalFundCostLocal) {
    const balanceAnchor = forexEnabled ? balanceLocal / homeFxRate : balanceLocal;
    return {
      valid: false,
      error: `Not enough funds. Need $${totalFundCost.toLocaleString()}, have $${balanceAnchor.toLocaleString()}.`,
    };
  }

  if (npp.retiredAt) {
    return { valid: false, error: "This NPP has retired from politics." };
  }

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn || 1;

  const relationshipKey = `${character._id.toString()}_${npp._id.toString()}`;
  const relationship = await db
    .collection<NPPRelationship>("nppRelationships")
    .findOne({ _id: relationshipKey });

  if (relationship) {
    const turnsSinceLastAttempt = currentTurn - relationship.lastAttemptTurn;
    if (turnsSinceLastAttempt < INFLUENCE_LIMITS.PER_NPP_COOLDOWN_TURNS) {
      const turnsRemaining = INFLUENCE_LIMITS.PER_NPP_COOLDOWN_TURNS - turnsSinceLastAttempt;
      return {
        valid: false,
        error: `You must wait ${turnsRemaining} more turn(s) before attempting to influence this NPP again.`,
      };
    }
  }

  const attemptsThisTurn = await db
    .collection<NPPInfluenceAttempt>("nppInfluenceAttempts")
    .countDocuments({
      characterId: character._id,
      turn: currentTurn,
    });

  if (attemptsThisTurn >= INFLUENCE_LIMITS.MAX_ATTEMPTS_PER_TURN) {
    return {
      valid: false,
      error: `You have already made ${INFLUENCE_LIMITS.MAX_ATTEMPTS_PER_TURN} influence attempts this turn.`,
    };
  }

  if (actionConfig.requiresElection && !context.electionId) {
    return { valid: false, error: "This action requires selecting an election." };
  }

  if (actionConfig.requiresCandidate && !context.candidateId) {
    return { valid: false, error: "This action requires selecting a candidate." };
  }

  if (actionConfig.nppMustBeCandidate && context.electionId) {
    const nppCandidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne(activeNppElectionCandidacyFilter(new ObjectId(context.electionId), npp._id));
    if (!nppCandidate) {
      return { valid: false, error: "This NPP is not a candidate in the selected election." };
    }
  }

  return { valid: true };
}

export async function executeInfluence(
  input: ExecuteInfluenceInput
): Promise<ExecuteInfluenceResult> {
  const [db, forexEnabled] = await Promise.all([getDb(), isForexEnabled()]);
  const actionConfig = INFLUENCE_ACTIONS[input.influenceType];

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: input.characterId });
  const npp = await db.collection<NPP>("npps").findOne({ _id: input.nppId });

  if (!character) {
    return {
      success: false,
      outcome: "failure",
      message: "Character not found",
      calculation: {} as InfluenceCalculation,
      roll: 0,
      relationshipChange: 0,
      newRelationshipScore: 0,
      error: "Character not found",
    };
  }

  if (!npp) {
    return {
      success: false,
      outcome: "failure",
      message: "NPP not found",
      calculation: {} as InfluenceCalculation,
      roll: 0,
      relationshipChange: 0,
      newRelationshipScore: 0,
      error: "NPP not found",
    };
  }

  const { rate: homeFxRate } = forexEnabled
    ? await loadCharacterFxRate(db, getHomeCurrency(character))
    : { rate: 1 };

  const validation = await validateInfluenceAttempt(
    character,
    npp,
    input.influenceType,
    input.fundAmount,
    input.context,
    forexEnabled
  );

  if (!validation.valid) {
    return {
      success: false,
      outcome: "failure",
      message: validation.error || "Validation failed",
      calculation: {} as InfluenceCalculation,
      roll: 0,
      relationshipChange: 0,
      newRelationshipScore: 0,
      error: validation.error,
    };
  }

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn || 1;

  const relationshipKey = `${character._id.toString()}_${npp._id.toString()}`;
  const relationship = await db
    .collection<NPPRelationship>("nppRelationships")
    .findOne({ _id: relationshipKey });

  const calculation = calculateInfluenceChance({
    character,
    npp,
    influenceType: input.influenceType,
    fundsPaid: input.fundAmount,
    relationship,
  });

  const roll = rollInfluence();
  const outcome = determineOutcome(roll, calculation.finalChance);
  const message = getOutcomeMessage(outcome, npp.name, input.influenceType);
  const relationshipChange = getRelationshipChange(outcome);

  const currentRelationshipScore = relationship?.relationshipScore || 0;
  const newRelationshipScore = Math.max(
    INFLUENCE_LIMITS.MIN_RELATIONSHIP,
    Math.min(INFLUENCE_LIMITS.MAX_RELATIONSHIP, currentRelationshipScore + relationshipChange)
  );

  const totalActionCost = actionConfig.actionCost;
  const totalFundCost = actionConfig.baseFundCost + input.fundAmount;
  const now = new Date();

  // Atomic guard. The pre-check in validateInfluenceAttempt is not race-safe:
  // two parallel influence requests could both pass validation and both
  // deduct, pushing campaign funds negative. The {$gte} filter ensures the
  // deduction only applies if the balance is actually sufficient at write
  // time; if it misses we bail before any downstream writes (relationship,
  // NPP, attempt log, effects).
  // totalFundCost is ANCHOR-denominated. Convert to LOCAL once for the filter
  // and $inc — both must guard on the canonical local balance field.
  const totalFundCostLocal = forexEnabled ? totalFundCost * homeFxRate : totalFundCost;
  const campaignFundsField = forexEnabled ? "currencyBalances.campaign" : "funds";
  const debitResult = await db.collection<Character>("characters").updateOne(
    {
      _id: character._id,
      actions: { $gte: totalActionCost },
      [campaignFundsField]: { $gte: totalFundCostLocal },
    },
    {
      $inc: {
        actions: -totalActionCost,
        [campaignFundsField]: -totalFundCostLocal,
      },
      $set: { updatedAt: now },
    }
  );
  if (debitResult.matchedCount === 0) {
    const errMsg =
      "Your available actions or campaign funds changed before the influence attempt completed. Please try again.";
    return {
      success: false,
      outcome: "failure",
      message: errMsg,
      calculation: {} as InfluenceCalculation,
      roll: 0,
      relationshipChange: 0,
      newRelationshipScore: 0,
      error: errMsg,
    };
  }

  if (relationship) {
    await db.collection<NPPRelationship>("nppRelationships").updateOne(
      { _id: relationshipKey },
      {
        $set: {
          relationshipScore: newRelationshipScore,
          lastAttemptTurn: currentTurn,
          updatedAt: now,
        },
        $inc: {
          totalAttempts: 1,
          successfulAttempts: outcome === "success" ? 1 : 0,
        },
      }
    );
  } else {
    await db.collection<NPPRelationship>("nppRelationships").insertOne({
      _id: relationshipKey,
      characterId: character._id,
      nppId: npp._id,
      relationshipScore: newRelationshipScore,
      totalAttempts: 1,
      successfulAttempts: outcome === "success" ? 1 : 0,
      lastAttemptTurn: currentTurn,
      createdAt: now,
      updatedAt: now,
    });
  }

  await db.collection<NPP>("npps").updateOne(
    { _id: npp._id },
    {
      $set: {
        "influenceState.lastInfluencedTurn": currentTurn,
        updatedAt: now,
      },
      $inc: { "influenceState.totalTimesInfluenced": 1 },
    }
  );

  const attemptRecord: NPPInfluenceAttempt = {
    _id: new ObjectId(),
    characterId: character._id,
    nppId: npp._id,
    influenceType: input.influenceType,
    actionCost: totalActionCost,
    fundCost: totalFundCost,
    context: {
      electionId: input.context.electionId ? new ObjectId(input.context.electionId) : undefined,
      candidateId: input.context.candidateId ? new ObjectId(input.context.candidateId) : undefined,
    },
    calculation: { ...calculation, roll },
    outcome,
    resultMessage: message,
    turn: currentTurn,
    createdAt: now,
  };

  await db.collection<NPPInfluenceAttempt>("nppInfluenceAttempts").insertOne(attemptRecord);

  if (outcome === "success") {
    await applyInfluenceEffects(input, npp, character);
  }

  return {
    success: outcome === "success",
    outcome,
    message,
    calculation,
    roll,
    relationshipChange,
    newRelationshipScore,
  };
}

async function applyInfluenceEffects(
  input: ExecuteInfluenceInput,
  npp: NPP,
  character: Character
): Promise<void> {
  const db = await getDb();
  const now = new Date();

  switch (input.influenceType) {
    case "endorse_candidate": {
      if (!input.context.electionId || !input.context.candidateId) break;
      const candidate = await db.collection<ElectionCandidate>("electionCandidates").findOne({
        _id: new ObjectId(input.context.candidateId),
        status: "active",
      });
      if (candidate) {
        const [election, candidateCountAtDecision] = await Promise.all([
          db.collection<Election>("elections").findOne({ _id: candidate.electionId }),
          db
            .collection<ElectionCandidate>("electionCandidates")
            .countDocuments({ electionId: candidate.electionId, status: "active" }),
        ]);
        if (
          election &&
          !isSelfEndorsementCandidate(npp, candidate) &&
          nppCanPlausiblyEndorseElection(npp, election)
        ) {
          const gameState = await db
            .collection<{ _id: string; currentTurn?: number }>("gameState")
            .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
          await upsertNppEndorsement(db, {
            npp,
            candidate,
            source: "arranged",
            now,
            currentTurn: gameState?.currentTurn ?? 0,
            candidateCountAtDecision,
            electionPhaseAtDecision: getEndorsementDecisionPhase(
              election,
              gameState?.currentTurn ?? 0,
              now
            ),
            arrangedBy: character._id,
          });
        }
      }
      break;
    }
    case "withdraw_election": {
      if (!input.context.electionId) break;

      const electionObjId = new ObjectId(input.context.electionId);
      const filter = activeNppElectionCandidacyFilter(electionObjId, npp._id);
      const withdrawCandidate = await db
        .collection<ElectionCandidate>("electionCandidates")
        .findOne(filter);
      if (!withdrawCandidate) break;

      const updateResult = await db.collection<ElectionCandidate>("electionCandidates").updateOne(
        { _id: withdrawCandidate._id },
        {
          $set: {
            status: "withdrawn",
            withdrawnAt: now,
          },
        }
      );
      if (updateResult.modifiedCount > 0) {
        await removeWithdrawnCandidateFromTally(
          db,
          electionObjId,
          withdrawCandidate._id.toString()
        );
      }
      break;
    }
    case "oppose_candidate":
    case "support_leadership":
      break;
  }
}

export async function getInfluenceOptions(
  characterId: ObjectId,
  nppId: ObjectId,
  forexEnabled = false
): Promise<{
  npp: NPP | null;
  relationship: NPPRelationship | null;
  options: Array<{
    type: InfluenceType;
    name: string;
    description: string;
    actionCost: number;
    baseFundCost: number;
    estimatedChance: number;
    available: boolean;
    unavailableReason?: string;
  }>;
  cooldownTurnsRemaining: number;
  attemptsThisTurn: number;
  maxAttemptsPerTurn: number;
}> {
  const db = await getDb();

  const character = await db.collection<Character>("characters").findOne({ _id: characterId });
  const npp = await db.collection<NPP>("npps").findOne({ _id: nppId });

  if (!character || !npp) {
    return {
      npp: null,
      relationship: null,
      options: [],
      cooldownTurnsRemaining: 0,
      attemptsThisTurn: 0,
      maxAttemptsPerTurn: INFLUENCE_LIMITS.MAX_ATTEMPTS_PER_TURN,
    };
  }

  const { rate: homeFxRate } = forexEnabled
    ? await loadCharacterFxRate(db, getHomeCurrency(character))
    : { rate: 1 };

  const relationshipKey = `${characterId.toString()}_${nppId.toString()}`;
  const relationship = await db
    .collection<NPPRelationship>("nppRelationships")
    .findOne({ _id: relationshipKey });

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn || 1;

  let cooldownTurnsRemaining = 0;
  if (relationship) {
    const turnsSinceLastAttempt = currentTurn - relationship.lastAttemptTurn;
    if (turnsSinceLastAttempt < INFLUENCE_LIMITS.PER_NPP_COOLDOWN_TURNS) {
      cooldownTurnsRemaining = INFLUENCE_LIMITS.PER_NPP_COOLDOWN_TURNS - turnsSinceLastAttempt;
    }
  }

  const attemptsThisTurn = await db
    .collection<NPPInfluenceAttempt>("nppInfluenceAttempts")
    .countDocuments({
      characterId,
      turn: currentTurn,
    });

  const options = Object.values(INFLUENCE_ACTIONS).map((config) => {
    const calculation = calculateInfluenceChance({
      character,
      npp,
      influenceType: config.type,
      fundsPaid: 0,
      relationship,
    });

    let available = true;
    let unavailableReason: string | undefined;

    if (cooldownTurnsRemaining > 0) {
      available = false;
      unavailableReason = `Cooldown: ${cooldownTurnsRemaining} turn(s) remaining`;
    } else if (attemptsThisTurn >= INFLUENCE_LIMITS.MAX_ATTEMPTS_PER_TURN) {
      available = false;
      unavailableReason = "Max attempts reached this turn";
    } else if (character.actions < config.actionCost) {
      available = false;
      unavailableReason = "Not enough actions";
    } else if (
      localCampaignBalance(character, forexEnabled) <
      (forexEnabled ? config.baseFundCost * homeFxRate : config.baseFundCost)
    ) {
      available = false;
      unavailableReason = "Not enough funds";
    } else if (npp.retiredAt) {
      available = false;
      unavailableReason = "NPP has retired";
    }

    return {
      type: config.type,
      name: config.name,
      description: config.description,
      actionCost: config.actionCost,
      baseFundCost: config.baseFundCost,
      estimatedChance: calculation.finalChance,
      available,
      unavailableReason,
    };
  });

  return {
    npp,
    relationship,
    options,
    cooldownTurnsRemaining,
    attemptsThisTurn,
    maxAttemptsPerTurn: INFLUENCE_LIMITS.MAX_ATTEMPTS_PER_TURN,
  };
}
