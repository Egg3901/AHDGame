import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { getHomeCurrency, loadCharacterFxRate } from "@/lib/currency/characterFunds";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type {
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
  CAPITAL_ACTIONS,
  type CapitalActionContext,
} from "@/lib/capital/actions";
import { nppCanPlausiblyEndorseElection } from "@/lib/nppEndorsements";
import { evaluateRequestedEndorsement } from "@/lib/npps/queries/directAction";
import { isSameCountry } from "@/lib/api/sameCountry";
import { statMultiplier } from "@/lib/stats/statMultiplier";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyDirectActionSpend,
  buildDirectActionFingerprint,
} from "@/lib/npps/commands/directActionSpend";

export { DirectActionBalanceConflictError } from "@/lib/npps/commands/directActionSpend";

export async function applyNppDirectAction(
  db: Db,
  {
    nppId,
    characterId,
    actorParty,
    action,
    candidacyId,
    idempotencyKey,
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
    idempotencyKey?: string;
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

  const config = CAPITAL_ACTIONS[action];
  if (!config) {
    return {
      error: `Unknown action: ${action}`,
      failure: "unknown_action" as const,
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

  const fingerprint = buildDirectActionFingerprint({
    characterId,
    nppId,
    action,
    candidacyId,
    actionCost: plan.actionCost,
    fundCostAnchor: plan.fundCost,
    fundsField: campaignFundsField,
  });
  const key = idempotencyKey !== undefined ? idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Direct-action idempotency key must be 1-128 characters");
  }

  // A receipt already on file means this key was seen before: the first
  // attempt already passed validation, so a crash-recovery retry (or a
  // duplicate delivery) must NOT re-validate against post-debit reads, where
  // the spent balances would fail the cost gates. It reconciles through the
  // keyed steps instead and reports the stored outcome.
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const priorReceipt = await receipts.findOne({ _id: key });

  if (!priorReceipt) {
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
  }

  // Endorsement inputs are assembled on every path (fresh and replay): the
  // spend primitive re-reads the candidacy/election at apply time so a retry
  // converges, and the snapshot below feeds the compensation revert.
  let endorsement: {
    candidacyId: string;
    arrangedByParty?: string;
    now: Date;
    currentTurn: number;
    priorActive: NPPEndorsement[];
  } | null = null;
  let context: { candidacyId?: ObjectId } = {};
  if (plan.sideEffects.createEndorsement) {
    const endorsementCandidacyId = plan.sideEffects.createEndorsement.candidacyId;
    if (!endorsementCandidacyId) {
      throw new TypeError("Direct-action endorsement plan needs candidacyId");
    }
    const candidacyOid = new ObjectId(endorsementCandidacyId);
    context = { candidacyId: candidacyOid };
    const candidacy = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({ _id: candidacyOid });
    const priorActive =
      candidacy && !candidacy.isNPP
        ? await db
            .collection<NPPEndorsement>("nppEndorsements")
            .find({ nppId, electionId: candidacy.electionId, isActive: true })
            .toArray()
        : [];
    endorsement = {
      candidacyId: endorsementCandidacyId,
      ...(actorParty ? { arrangedByParty: actorParty } : {}),
      now,
      currentTurn,
      priorActive,
    };
  }

  const favorUpdate =
    plan.sideEffects.favorabilityDelta !== undefined ||
    plan.sideEffects.politicalInfluenceDelta !== undefined
      ? {
          favorability: updatedFavorability,
          politicalInfluence: updatedPoliticalInfluence,
          updatedAt: now,
          prior: {
            favorability: npp.favorability,
            politicalInfluence: npp.politicalInfluence,
            updatedAt: npp.updatedAt,
          },
        }
      : null;

  const outcome = await applyDirectActionSpend(db, {
    characterId,
    nppId,
    nppName: npp.name,
    relationshipKey,
    action,
    actionCost: plan.actionCost,
    fundCostLocal,
    fundsField: campaignFundsField,
    relationshipDelta,
    relationshipBefore: currentRelationship,
    relationshipAfter: newRelationship,
    lastAttemptTurn: currentTurn,
    priorRelationship: relationshipDoc,
    favorUpdate,
    endorsement,
    log: {
      actionsSpent: plan.actionCost,
      fundsSpentAnchor: plan.fundCost,
      effectSummary: plan.effectSummary,
      turn: currentTurn,
      context,
    },
    now,
    fingerprint,
    idempotencyKey: key,
  });

  const homeCurrency = getHomeCurrency(characterDoc);
  const currencySymbol = CURRENCY_SYMBOLS[homeCurrency] ?? "$";

  return {
    success: true,
    effect: outcome.effect,
    action: outcome.action,
    actions: outcome.actions,
    funds: {
      current: outcome.funds.current,
      // fundCostLocal is the stored (home-currency) amount we just debited.
      spent: Math.round(fundCostLocal),
    },
    homeCurrency,
    currencySymbol,
    relationship: outcome.relationship,
  } as const;
}
