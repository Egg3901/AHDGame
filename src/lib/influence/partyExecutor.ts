import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  NPP,
  NPPInfluenceAttempt,
  InfluenceOutcome,
  GameState,
  StatePartyOrg,
  PoliticalParty,
  State,
  ElectionCandidate,
} from "@/lib/db/types";
import type { Election } from "@/lib/db/types";
import { rollInfluence } from "./calculator";
import {
  calculatePartyInfluenceChance,
  getPartyOutcomeMessage,
  type PartyInfluenceCalculation,
} from "./partyExecutorCalculations";
import {
  validateStatePartyInfluence,
  validateNationalPartyInfluence,
  getStatesWithoutPlayers,
} from "./partyExecutorValidation";
import { applyPartyInfluenceEffects } from "./partyExecutorEffects";
import type { ExecutePartyInfluenceInput } from "./partyExecutorTypes";
import { calculateRelocationCapacity, calculateRelocationRequestCost } from "@/lib/npp/recruitment";
import {
  NPP_MANAGEMENT_AP_COST,
  nppActionPointCap,
  nppManagementFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import { getOfficeLabel } from "@/lib/utils/politics";
import { formatElectionTypeLabel } from "@/lib/utils/electionLabels";

export type { PartyInfluenceCalculation } from "./partyExecutorCalculations";
export type { ExecutePartyInfluenceInput } from "./partyExecutorTypes";

export interface ExecutePartyInfluenceResult {
  success: boolean;
  outcome: InfluenceOutcome;
  message: string;
  calculation: PartyInfluenceCalculation;
  roll: number;
  error?: string;
}

export { validateStatePartyInfluence, validateNationalPartyInfluence, getStatesWithoutPlayers };

function qualifiesForStateLeadershipBonus(
  influenceType: ExecutePartyInfluenceInput["influenceType"]
) {
  return influenceType === "boost_loyalty" || influenceType === "reduce_stubbornness";
}

const STATE_PARTY_INFLUENCE_HIDDEN_BONUS = 3;

async function findPartyForInfluence(
  db: Db,
  input: ExecutePartyInfluenceInput
): Promise<PoliticalParty | null> {
  const parsedPartyId = Number.parseInt(input.partyId, 10);
  if (input.partyObjectId) {
    return db.collection<PoliticalParty>("politicalParties").findOne({ _id: input.partyObjectId });
  }
  if (!Number.isNaN(parsedPartyId) && input.countryId) {
    return db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: input.countryId, sequentialId: parsedPartyId });
  }
  return null;
}

async function getNationalRelocationTargetCost(
  db: Db,
  partyId: string,
  countryId: CountryId,
  targetStateId: string | undefined
): Promise<
  | { ok: true; cost: { actions: number; funds: number }; targetState: State }
  | { ok: false; error: string }
> {
  if (!targetStateId) {
    return { ok: false, error: "Select a target state for this relocation request." };
  }

  const targetState = await db
    .collection<State>("states")
    .findOne({ _id: targetStateId, countryId });
  if (!targetState) {
    return { ok: false, error: "Target state not found in this country." };
  }

  const countryStates = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  const countryStateIds = countryStates.map((state) => state._id);
  const partyNpps = await db
    .collection<NPP>("npps")
    .find({
      party: partyId,
      retiredAt: null,
      homeState: { $in: countryStateIds },
    })
    .project<{ homeState: string }>({ homeState: 1 })
    .toArray();

  const partyNPPCount = partyNpps.length;
  const targetStateNPPCount = partyNpps.filter((npp) => npp.homeState === targetStateId).length;

  return {
    ok: true,
    targetState,
    cost: calculateRelocationRequestCost(targetStateNPPCount, partyNPPCount),
  };
}

async function executeStatePartyInfluenceCore(
  input: ExecutePartyInfluenceInput
): Promise<ExecutePartyInfluenceResult> {
  const db = await getDb();

  if (!input.stateId) {
    return {
      success: false,
      outcome: "failure",
      message: "State ID is required for state party influence",
      calculation: {} as PartyInfluenceCalculation,
      roll: 0,
      error: "State ID is required",
    };
  }

  const statePartyKey = `${input.stateId}_${input.partyId}`;
  const statePartyOrg = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ _id: statePartyKey });
  const npp = await db.collection<NPP>("npps").findOne({ _id: input.nppId });
  const party = await findPartyForInfluence(db, input);

  if (!statePartyOrg || !npp || !party) {
    return {
      success: false,
      outcome: "failure",
      message: !statePartyOrg
        ? "State party organization not found"
        : !npp
          ? "NPP not found"
          : "Party not found",
      calculation: {} as PartyInfluenceCalculation,
      roll: 0,
      error: !statePartyOrg
        ? "State party organization not found"
        : !npp
          ? "NPP not found"
          : "Party not found",
    };
  }

  const validation = await validateStatePartyInfluence(
    statePartyOrg,
    npp,
    input.influenceType,
    input.fundAmount,
    input.actorCharacterId,
    input.context
  );

  if (!validation.valid) {
    return {
      success: false,
      outcome: "failure",
      message: validation.error || "Validation failed",
      calculation: {} as PartyInfluenceCalculation,
      roll: 0,
      error: validation.error,
    };
  }

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn || 1;
  const stateLeadershipBonus =
    qualifiesForStateLeadershipBonus(input.influenceType) &&
    (statePartyOrg.chairId?.equals(input.actorCharacterId) ||
      statePartyOrg.viceChairId?.equals(input.actorCharacterId))
      ? STATE_PARTY_INFLUENCE_HIDDEN_BONUS
      : 0;
  // Fund lever retired — NPP work no longer spends treasury, so no fund bonus.
  const calculation = calculatePartyInfluenceChance(
    npp,
    input.partyId,
    statePartyOrg.organization,
    0,
    stateLeadershipBonus
  );
  const roll = rollInfluence();
  // NPP Management actions always succeed (this executor only ever serves the
  // route-restricted state management set). The roll is still computed for the
  // attempt record's calculation block.
  const outcome: InfluenceOutcome = "success";

  // NPP Management spends a flat 1 AP plus a fixed per-action treasury cost.
  const totalActionCost = NPP_MANAGEMENT_AP_COST;
  const totalFundCost = nppManagementFundCost(
    input.influenceType,
    nppTreasuryCurrency(party.countryId)
  );
  const now = new Date();

  // Heal legacy rows whose AP pool was never initialized (e.g. a paused / never-
  // regenerated game) to the full tier cap, so the atomic `$gte` debit can match.
  // Guarded by `$exists:false` → idempotent under concurrent spends.
  if (statePartyOrg.nppActionPoints == null) {
    const apCap = nppActionPointCap("state", resolvePartyTier(party));
    await db
      .collection<StatePartyOrg>("statePartyOrg")
      .updateOne(
        { _id: statePartyKey, nppActionPoints: { $exists: false } },
        { $set: { nppActionPoints: apCap } }
      );
    statePartyOrg.nppActionPoints = apCap;
  }

  const resourceDebit = await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
    {
      _id: statePartyKey,
      nppActionPoints: { $gte: totalActionCost },
      treasury: { $gte: totalFundCost },
    },
    {
      $inc: { nppActionPoints: -totalActionCost, treasury: -totalFundCost },
      $set: { updatedAt: now },
    }
  );

  if (resourceDebit.matchedCount === 0) {
    return {
      success: false,
      outcome: "failure",
      message: "Insufficient state party resources",
      calculation,
      roll,
      error: "Insufficient state party resources",
    };
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

  const effectResult =
    outcome === "success" ? await applyPartyInfluenceEffects(input, npp, party) : {};

  if (
    input.influenceType === "withdraw_election" &&
    outcome === "success" &&
    effectResult.withdrawApplied === false
  ) {
    await db.collection<StatePartyOrg>("statePartyOrg").updateOne(
      { _id: statePartyKey },
      {
        $inc: { nppActionPoints: totalActionCost, treasury: totalFundCost },
        $set: { updatedAt: new Date() },
      }
    );
    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: npp._id },
        { $inc: { "influenceState.totalTimesInfluenced": -1 }, $set: { updatedAt: new Date() } }
      );

    const failOutcome: InfluenceOutcome = "failure";
    const failMsg =
      "The NPP could not be withdrawn (no active candidacy matched). Your party was not charged.";
    const failMessage = getPartyOutcomeMessage(
      failOutcome,
      npp.name,
      input.influenceType,
      party.name
    );

    const failAttempt: NPPInfluenceAttempt = {
      _id: new ObjectId(),
      characterId: input.actorCharacterId,
      nppId: npp._id,
      influenceType: input.influenceType,
      actionCost: totalActionCost,
      fundCost: totalFundCost,
      context: {
        electionId: input.context.electionId ? new ObjectId(input.context.electionId) : undefined,
        candidateId: input.context.candidateId
          ? new ObjectId(input.context.candidateId)
          : undefined,
        targetStateId: input.context.targetStateId,
      },
      calculation: {
        baseChance: calculation.baseChance,
        stubbornnessPenalty: calculation.stubbornnessPenalty,
        partyBonus: calculation.partyBonus,
        politicalInfluenceBonus: 0,
        favorabilityBonus: 0,
        fundBonus: calculation.fundBonus,
        relationshipBonus: calculation.organizationBonus,
        finalChance: calculation.finalChance,
        roll,
      },
      outcome: failOutcome,
      resultMessage: failMessage,
      turn: currentTurn,
      partyInfluence: { type: "state", partyId: input.partyId, stateId: input.stateId! },
      createdAt: now,
    };
    await db.collection<NPPInfluenceAttempt>("nppInfluenceAttempts").insertOne(failAttempt);

    return {
      success: false,
      outcome: failOutcome,
      message: failMsg,
      calculation,
      roll,
      error: failMsg,
    };
  }

  const statChange = effectResult.statChange;
  const message =
    effectResult.messageOverride ??
    getPartyOutcomeMessage(outcome, npp.name, input.influenceType, party.name, statChange);

  const attemptRecord: NPPInfluenceAttempt = {
    _id: new ObjectId(),
    characterId: input.actorCharacterId,
    nppId: npp._id,
    influenceType: input.influenceType,
    actionCost: totalActionCost,
    fundCost: totalFundCost,
    context: {
      electionId: input.context.electionId ? new ObjectId(input.context.electionId) : undefined,
      candidateId: input.context.candidateId ? new ObjectId(input.context.candidateId) : undefined,
      targetStateId: input.context.targetStateId,
    },
    calculation: {
      baseChance: calculation.baseChance,
      stubbornnessPenalty: calculation.stubbornnessPenalty,
      partyBonus: calculation.partyBonus,
      politicalInfluenceBonus: 0,
      favorabilityBonus: 0,
      fundBonus: calculation.fundBonus,
      relationshipBonus: calculation.organizationBonus,
      finalChance: calculation.finalChance,
      roll,
    },
    outcome,
    resultMessage: message,
    turn: currentTurn,
    partyInfluence: { type: "state", partyId: input.partyId, stateId: input.stateId! },
    createdAt: now,
  };

  await db.collection<NPPInfluenceAttempt>("nppInfluenceAttempts").insertOne(attemptRecord);
  return { success: outcome === "success", outcome, message, calculation, roll };
}

async function executeNationalPartyInfluenceCore(
  input: ExecutePartyInfluenceInput
): Promise<ExecutePartyInfluenceResult> {
  const db = await getDb();
  const party = await findPartyForInfluence(db, input);
  const npp = await db.collection<NPP>("npps").findOne({ _id: input.nppId });

  if (!party || !npp) {
    return {
      success: false,
      outcome: "failure",
      message: !party ? "Party not found" : "NPP not found",
      calculation: {} as PartyInfluenceCalculation,
      roll: 0,
      error: !party ? "Party not found" : "NPP not found",
    };
  }

  const validation = await validateNationalPartyInfluence(
    party,
    npp,
    input.influenceType,
    input.fundAmount,
    input.actorCharacterId,
    input.context
  );

  if (!validation.valid) {
    return {
      success: false,
      outcome: "failure",
      message: validation.error || "Validation failed",
      calculation: {} as PartyInfluenceCalculation,
      roll: 0,
      error: validation.error,
    };
  }

  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const currentTurn = gameState?.currentTurn || 1;
  const statePartyKey = `${npp.homeState}_${input.partyId}`;
  const statePartyOrg = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ _id: statePartyKey });
  const organizationLevel = statePartyOrg?.organization || 50;
  // Fund lever retired — NPP work no longer spends treasury, so no fund bonus.
  const calculation = calculatePartyInfluenceChance(npp, input.partyId, organizationLevel, 0);

  const roll = rollInfluence();
  // NPP Management actions always succeed (this executor only ever serves the
  // route-restricted national management set). The roll is still computed for
  // the attempt record's calculation block.
  const outcome: InfluenceOutcome = "success";
  // NPP Management spends a flat 1 AP plus a fixed per-action treasury cost.
  // Relocation still validates its target eligibility; its treasury cost is 0.
  const totalActionCost = NPP_MANAGEMENT_AP_COST;
  const totalFundCost = nppManagementFundCost(
    input.influenceType,
    nppTreasuryCurrency(party.countryId)
  );
  if (input.influenceType === "relocate_state") {
    const moveTarget = await getNationalRelocationTargetCost(
      db,
      input.partyId,
      party.countryId,
      input.context.targetStateId
    );
    if (!moveTarget.ok) {
      return {
        success: false,
        outcome: "failure",
        message: moveTarget.error,
        calculation,
        roll,
        error: moveTarget.error,
      };
    }
  }
  const now = new Date();

  // Heal legacy rows whose AP pool was never initialized (e.g. a paused / never-
  // regenerated game) to the full tier cap, so the atomic `$gte` debit can match.
  if (party.nppActionPoints == null) {
    const apCap = nppActionPointCap("national", resolvePartyTier(party));
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: party._id, nppActionPoints: { $exists: false } },
        { $set: { nppActionPoints: apCap } }
      );
    party.nppActionPoints = apCap;
  }

  const resourceDebit = await db.collection<PoliticalParty>("politicalParties").updateOne(
    {
      _id: party._id,
      nppActionPoints: { $gte: totalActionCost },
      treasury: { $gte: totalFundCost },
    },
    {
      $inc: { nppActionPoints: -totalActionCost, treasury: -totalFundCost },
      $set: { updatedAt: now },
    }
  );

  if (resourceDebit.matchedCount === 0) {
    return {
      success: false,
      outcome: "failure",
      message: "Insufficient party resources",
      calculation,
      roll,
      error: "Insufficient party resources",
    };
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

  let effectResult: Awaited<ReturnType<typeof applyPartyInfluenceEffects>> = {};
  if (outcome === "success") {
    effectResult = await applyPartyInfluenceEffects(input, npp, party);
    if (input.influenceType === "withdraw_election" && effectResult.withdrawApplied === false) {
      await db.collection<PoliticalParty>("politicalParties").updateOne(
        { _id: party._id },
        {
          $inc: { nppActionPoints: totalActionCost, treasury: totalFundCost },
          $set: { updatedAt: new Date() },
        }
      );
      await db
        .collection<NPP>("npps")
        .updateOne(
          { _id: npp._id },
          { $inc: { "influenceState.totalTimesInfluenced": -1 }, $set: { updatedAt: new Date() } }
        );

      const failOutcome: InfluenceOutcome = "failure";
      const failMsg =
        "The NPP could not be withdrawn (no active candidacy matched). Your party was not charged.";
      const failMessage = getPartyOutcomeMessage(
        failOutcome,
        npp.name,
        input.influenceType,
        party.name
      );

      const failAttempt: NPPInfluenceAttempt = {
        _id: new ObjectId(),
        characterId: input.actorCharacterId,
        nppId: npp._id,
        influenceType: input.influenceType,
        actionCost: totalActionCost,
        fundCost: totalFundCost,
        context: {
          electionId: input.context.electionId ? new ObjectId(input.context.electionId) : undefined,
          candidateId: input.context.candidateId
            ? new ObjectId(input.context.candidateId)
            : undefined,
          targetStateId: input.context.targetStateId,
        },
        calculation: {
          baseChance: calculation.baseChance,
          stubbornnessPenalty: calculation.stubbornnessPenalty,
          partyBonus: calculation.partyBonus,
          politicalInfluenceBonus: 0,
          favorabilityBonus: 0,
          fundBonus: calculation.fundBonus,
          relationshipBonus: calculation.organizationBonus,
          finalChance: calculation.finalChance,
          roll,
        },
        outcome: failOutcome,
        resultMessage: failMessage,
        turn: currentTurn,
        partyInfluence: { type: "national", partyId: input.partyId, stateId: npp.homeState },
        createdAt: now,
      };
      await db.collection<NPPInfluenceAttempt>("nppInfluenceAttempts").insertOne(failAttempt);

      return {
        success: false,
        outcome: failOutcome,
        message: failMsg,
        calculation,
        roll,
        error: failMsg,
      };
    }
  }

  const statChange = effectResult.statChange;
  const message =
    effectResult.messageOverride ??
    getPartyOutcomeMessage(outcome, npp.name, input.influenceType, party.name, statChange);

  const attemptRecord: NPPInfluenceAttempt = {
    _id: new ObjectId(),
    characterId: input.actorCharacterId,
    nppId: npp._id,
    influenceType: input.influenceType,
    actionCost: totalActionCost,
    fundCost: totalFundCost,
    context: {
      electionId: input.context.electionId ? new ObjectId(input.context.electionId) : undefined,
      candidateId: input.context.candidateId ? new ObjectId(input.context.candidateId) : undefined,
      targetStateId: input.context.targetStateId,
    },
    calculation: {
      baseChance: calculation.baseChance,
      stubbornnessPenalty: calculation.stubbornnessPenalty,
      partyBonus: calculation.partyBonus,
      politicalInfluenceBonus: 0,
      favorabilityBonus: 0,
      fundBonus: calculation.fundBonus,
      relationshipBonus: calculation.organizationBonus,
      finalChance: calculation.finalChance,
      roll,
    },
    outcome,
    resultMessage: message,
    turn: currentTurn,
    partyInfluence: { type: "national", partyId: input.partyId, stateId: npp.homeState },
    createdAt: now,
  };

  await db.collection<NPPInfluenceAttempt>("nppInfluenceAttempts").insertOne(attemptRecord);
  return { success: outcome === "success", outcome, message, calculation, roll };
}

export async function executeStatePartyInfluence(
  input: ExecutePartyInfluenceInput
): Promise<ExecutePartyInfluenceResult> {
  return executeStatePartyInfluenceCore(input);
}

export async function executeNationalPartyInfluence(
  input: ExecutePartyInfluenceInput
): Promise<ExecutePartyInfluenceResult> {
  return executeNationalPartyInfluenceCore(input);
}

export { calculatePartyInfluenceChance } from "./partyExecutorCalculations";
export { hasActivePlayersInState } from "./partyExecutorValidation";

/**
 * Display label for the race an NPP is currently standing in, for the roster's
 * "Running: ..." tag. Uses the country-aware election-type map so non-US races
 * read as their own chamber rather than a raw type string, and only names the
 * state when the seat sits outside the NPP's home state (the roster row already
 * prints the home state beside the name).
 */
function buildCandidacyLabel(
  election:
    Pick<Election, "state" | "electionType" | "senateClass" | "chamberClass"> | null | undefined,
  countryId: CountryId,
  homeState: string
): string | null {
  if (!election) return null;
  const chamber = formatElectionTypeLabel(election.electionType, countryId);
  const classSuffix =
    election.electionType === "senate" && election.senateClass
      ? ` (Class ${election.senateClass})`
      : election.chamberClass
        ? ` (Class ${election.chamberClass})`
        : "";
  const statePrefix = election.state && election.state !== homeState ? `${election.state} ` : "";
  return `${statePrefix}${chamber}${classSuffix}`;
}

export async function getStatePartyInfluenceOptions(
  statePartyOrg: StatePartyOrg,
  party: PoliticalParty,
  includeLeadershipBonus = false
): Promise<{
  politicalStrength: number;
  treasury: number;
  partyName: string;
  nppsInState: Array<{
    id: string;
    sequentialId: number | null;
    name: string;
    party: string;
    estimatedChance: number;
    stats: {
      favorability: number;
      politicalInfluence: number;
      loyalty: number;
      ambition: number;
      stubbornness: number;
    };
    currentOfficeLabel?: string | null;
    activeCandidacyLabel?: string | null;
  }>;
}> {
  const db = await getDb();

  const npps = await db
    .collection<NPP>("npps")
    .find({ homeState: statePartyOrg.stateId, party: statePartyOrg.partyId, retiredAt: null })
    .toArray();
  const nppIds = npps.map((npp) => npp._id);
  const candidacies =
    nppIds.length > 0
      ? await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({
            nppId: { $in: nppIds },
            status: "active",
          })
          .toArray()
      : [];
  const electionIds = candidacies.map((candidate) => candidate.electionId);
  const elections =
    electionIds.length > 0
      ? await db
          .collection<Election>("elections")
          .find(
            { _id: { $in: electionIds } },
            { projection: { _id: 1, electionType: 1, state: 1, senateClass: 1, chamberClass: 1 } }
          )
          .toArray()
      : [];
  const electionMap = new Map(elections.map((election) => [election._id.toString(), election]));

  const nppsWithChances = npps.map((npp) => {
    const calculation = calculatePartyInfluenceChance(
      npp,
      statePartyOrg.partyId,
      statePartyOrg.organization,
      0,
      includeLeadershipBonus ? STATE_PARTY_INFLUENCE_HIDDEN_BONUS : 0
    );
    const activeCandidacy = candidacies.find((candidate) => candidate.nppId?.equals(npp._id));
    const activeElection = activeCandidacy
      ? electionMap.get(activeCandidacy.electionId.toString())
      : null;
    return {
      id: npp._id.toString(),
      sequentialId: npp.sequentialId ?? null,
      name: npp.name,
      party: npp.party,
      estimatedChance: calculation.finalChance,
      stats: {
        favorability: npp.favorability,
        politicalInfluence: npp.politicalInfluence,
        loyalty: npp.personality.loyalty,
        ambition: npp.personality.ambition,
        stubbornness: npp.personality.stubbornness,
      },
      currentOfficeLabel: npp.currentOffice
        ? getOfficeLabel(npp.currentOffice, party.countryId)
        : null,
      activeCandidacyLabel: buildCandidacyLabel(activeElection, party.countryId, npp.homeState),
    };
  });

  return {
    politicalStrength: statePartyOrg.politicalStrength || 0,
    treasury: statePartyOrg.treasury,
    partyName: party.name,
    nppsInState: nppsWithChances,
  };
}

export async function getNationalPartyInfluenceOptions(party: PoliticalParty): Promise<{
  politicalStrength: number;
  treasury: number;
  partyName: string;
  availableStates: string[];
  stateNames: Record<string, string>;
  targetStates: Array<{
    id: string;
    name: string;
    actionCost: number;
    fundCost: number;
    currentNPPs: number;
    maxSlots: number;
    full: boolean;
  }>;
  nppsByState: Record<
    string,
    Array<{
      id: string;
      sequentialId: number | null;
      name: string;
      party: string;
      estimatedChance: number;
      stats: {
        favorability: number;
        politicalInfluence: number;
        loyalty: number;
        ambition: number;
        stubbornness: number;
      };
      currentOfficeLabel?: string | null;
      activeCandidacyLabel?: string | null;
    }>
  >;
}> {
  const db = await getDb();
  const partyId = String(party.sequentialId);
  const countryId = party.countryId ?? "US";
  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, name: 1 } })
    .toArray();
  const stateIds = states.map((state) => state._id);
  const stateNames = Object.fromEntries(states.map((state) => [state._id, state.name]));

  const npps = await db
    .collection<NPP>("npps")
    .find({
      homeState: { $in: stateIds },
      party: partyId,
      retiredAt: null,
    })
    .toArray();

  const nppsByState: Record<
    string,
    Array<{
      id: string;
      sequentialId: number | null;
      name: string;
      party: string;
      estimatedChance: number;
      stats: {
        favorability: number;
        politicalInfluence: number;
        loyalty: number;
        ambition: number;
        stubbornness: number;
      };
      currentOfficeLabel?: string | null;
      activeCandidacyLabel?: string | null;
    }>
  > = {};

  const allStatePartyKeys = stateIds.map((id) => `${id}_${partyId}`);
  const statePartyOrgs =
    allStatePartyKeys.length > 0
      ? await db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ _id: { $in: allStatePartyKeys } })
          .toArray()
      : [];
  const orgByStateKey = new Map(statePartyOrgs.map((o) => [o._id, o]));

  // Enrich with candidacy / office info so the roster filters work.
  const nppIds = npps.map((npp) => npp._id);
  const candidacies =
    nppIds.length > 0
      ? await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ nppId: { $in: nppIds }, status: "active" })
          .toArray()
      : [];
  const electionIds = candidacies.map((c) => c.electionId);
  const elections =
    electionIds.length > 0
      ? await db
          .collection<Election>("elections")
          .find(
            { _id: { $in: electionIds } },
            { projection: { _id: 1, electionType: 1, state: 1, senateClass: 1, chamberClass: 1 } }
          )
          .toArray()
      : [];
  const electionMap = new Map(elections.map((e) => [e._id.toString(), e]));

  for (const npp of npps) {
    const statePartyKey = `${npp.homeState}_${partyId}`;
    const statePartyOrg = orgByStateKey.get(statePartyKey);
    const orgLevel = statePartyOrg?.organization || 50;
    const calculation = calculatePartyInfluenceChance(npp, partyId, orgLevel, 0);

    if (!nppsByState[npp.homeState]) {
      nppsByState[npp.homeState] = [];
    }
    const activeCandidacy = candidacies.find((c) => c.nppId?.equals(npp._id));
    const activeElection = activeCandidacy
      ? electionMap.get(activeCandidacy.electionId.toString())
      : null;
    nppsByState[npp.homeState].push({
      id: npp._id.toString(),
      sequentialId: npp.sequentialId ?? null,
      name: npp.name,
      party: npp.party,
      estimatedChance: calculation.finalChance,
      stats: {
        favorability: npp.favorability,
        politicalInfluence: npp.politicalInfluence,
        loyalty: npp.personality.loyalty,
        ambition: npp.personality.ambition,
        stubbornness: npp.personality.stubbornness,
      },
      currentOfficeLabel: npp.currentOffice ? getOfficeLabel(npp.currentOffice, countryId) : null,
      activeCandidacyLabel: buildCandidacyLabel(activeElection, countryId, npp.homeState),
    });
  }

  // Relocation capacity is roster-aware — see `calculateRelocationCapacity`. The
  // picker must use the same rule the executor enforces, or a target renders as
  // selectable and is then refused (or vice versa).
  const partyNppCount = npps.length;
  const targetStates = states.map((state) => {
    const currentNPPs = nppsByState[state._id]?.length ?? 0;
    const orgLevel = orgByStateKey.get(`${state._id}_${partyId}`)?.organization ?? 0;
    const maxSlots = calculateRelocationCapacity(orgLevel, partyNppCount, states.length);
    return {
      id: state._id,
      name: state.name,
      // Relocation costs a flat 1 AP like every other management action.
      actionCost: NPP_MANAGEMENT_AP_COST,
      fundCost: 0,
      currentNPPs,
      maxSlots,
      full: currentNPPs >= maxSlots,
    };
  });

  return {
    politicalStrength: party.politicalStrength || 0,
    treasury: party.treasury,
    partyName: party.name,
    availableStates: stateIds,
    stateNames,
    targetStates,
    nppsByState,
  };
}
