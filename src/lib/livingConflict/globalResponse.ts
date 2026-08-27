import type { Db, ObjectId } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type {
  CampaignCapabilitySnapshot,
  CampaignCountryMemory,
  CampaignStage,
} from "@/lib/db/types/livingConflictCampaign";
import type {
  Crisis,
  CrisisDecisionNode,
  CrisisDecisionOption,
  CrisisInteraction,
  GlobalResponseOutcome,
  GlobalResponseRole,
  ResolvedGlobalResponse,
} from "@/lib/db/types/crisis";
import { badRequest } from "@/lib/api/errors";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { applyCrisisEffects } from "@/lib/crises/applyEffects";
import { getGameState } from "@/lib/gameState";
import { logWireEvent } from "@/lib/wireEvent";
import { applyTensionEvent } from "@/lib/coldwar/tension";
import { EQUIPMENT_TRACK_MAX } from "@/lib/military/arsenal";
import { adjustIntensity, applyCommitment, relieveCommitment } from "./engine";
import { livingConflictDef } from "./registry";
import { loadConflictState, saveConflictState } from "./driver";
import {
  applyCampaignOutcome,
  assessCampaignOptions,
  assessCampaignRequirement,
  CAMPAIGN_STAGE_LABELS,
  consequenceBand,
  emptyCountryMemory,
  estimateCampaignIntelligence,
  normalizeCampaignState,
  recordCampaignCommitment,
  shouldExposeCovertResponse,
  type CampaignIntelligenceAssessment,
  type CampaignRequirementResult,
} from "./campaign";

/**
 * The deep module for shared world-event responses. Callers only need to ask
 * which options a country sees, debit an authored response cost, or resolve the
 * window. Role lookup, tallying, threshold selection, country-scoped effects,
 * and persistent conflict trajectory changes stay behind this interface.
 */

export function globalResponseRoleFor(
  crisis: Pick<Crisis, "globalResponse">,
  countryId: string
): GlobalResponseRole | null {
  return crisis.globalResponse?.roleByCountry[countryId] ?? null;
}

export function optionsForGlobalResponder(
  crisis: Pick<Crisis, "globalResponse">,
  node: CrisisDecisionNode,
  countryId: string
): CrisisDecisionOption[] {
  const role = globalResponseRoleFor(crisis, countryId);
  if (!role) return [];
  return node.optionsByRole?.[role] ?? node.options ?? [];
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value * 10) / 10));
}

/**
 * A nation's current capability snapshot. Country-scoped and independent of any
 * one crisis, so a caller answering several crises in a single request should
 * load it once and pass it back in rather than paying for the militaryUnits
 * read per crisis.
 */
export async function loadCampaignCapability(
  db: Db,
  countryId: string
): Promise<CampaignCapabilitySnapshot> {
  const [budget, approval, units] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ countryId: countryId as FederalBudget["countryId"] }),
    db
      .collection<GovernmentApproval>("governmentApprovals")
      .findOne({ _id: countryId as GovernmentApproval["_id"] }),
    db
      .collection<MilitaryUnit>("militaryUnits")
      .find({ countryId: countryId as MilitaryUnit["countryId"] })
      .project<Pick<MilitaryUnit, "personnel" | "readiness" | "equipment">>({
        personnel: 1,
        readiness: 1,
        equipment: 1,
      })
      .toArray(),
  ]);
  const totalPersonnel = units.reduce((sum, unit) => sum + Math.max(1, unit.personnel ?? 0), 0);
  const militaryReadiness =
    totalPersonnel > 0
      ? units.reduce(
          (sum, unit) => sum + clamp(unit.readiness) * Math.max(1, unit.personnel ?? 0),
          0
        ) / totalPersonnel
      : 20;
  const logistics =
    totalPersonnel > 0
      ? units.reduce(
          (sum, unit) =>
            sum +
            clamp(((unit.equipment?.support ?? 0) / EQUIPMENT_TRACK_MAX) * 100) *
              Math.max(1, unit.personnel ?? 0),
          0
        ) / totalPersonnel
      : 20;
  const gdp = budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : budget?.gdp;
  const treasuryPctGdp = gdp && gdp > 0 ? (budget?.treasuryBalance ?? 0) / gdp : 0;
  return {
    treasuryPctGdp: Math.max(-1, Math.min(1, treasuryPctGdp)),
    militaryReadiness: clamp(militaryReadiness),
    logistics: clamp(logistics),
    domesticSupport: clamp(approval?.approvalRating ?? 50),
    intelligence: clamp(25 + militaryReadiness * 0.35 + logistics * 0.25),
    assessedAt: new Date(),
  };
}

/**
 * The two country-scoped inputs every eligibility question needs: which campaign
 * stage the conflict is in, and what the nation can currently bring to bear.
 */
async function responderContext(
  db: Db,
  definition: NonNullable<Crisis["globalResponse"]>,
  countryId: string,
  capability?: CampaignCapabilitySnapshot
): Promise<{ stage: CampaignStage; capability: CampaignCapabilitySnapshot }> {
  const state = await loadConflictState(db, definition.conflictKey);
  const stage = definition.campaign?.stage ?? normalizeCampaignState(state.campaign).stage;
  return { stage, capability: capability ?? (await loadCampaignCapability(db, countryId)) };
}

/**
 * Per-option eligibility for one country. The Actions-page card and the crisis
 * detail page both gate their buttons on this, so a player is never offered an
 * option the command path is bound to refuse (ticket #1183). Null when the
 * country has no role in this response.
 */
export async function optionAvailabilityForGlobalResponder(
  db: Db,
  crisis: Pick<Crisis, "globalResponse">,
  countryId: string,
  options: CrisisDecisionOption[],
  capability?: CampaignCapabilitySnapshot
): Promise<Record<string, CampaignRequirementResult> | null> {
  const definition = crisis.globalResponse;
  if (!definition || !globalResponseRoleFor(crisis, countryId)) return null;
  const context = await responderContext(db, definition, countryId, capability);
  return assessCampaignOptions(options, context.capability, context.stage);
}

export interface GlobalResponseCampaignBrief {
  stage: CampaignStage;
  stageLabel: string;
  stageTurns: number;
  cycle: number;
  capability: CampaignCapabilitySnapshot;
  intelligence: CampaignIntelligenceAssessment;
  countryMemory: CampaignCountryMemory;
  consequenceBands: Record<string, ReturnType<typeof consequenceBand>>;
  optionAvailability: Record<string, CampaignRequirementResult>;
}

/** Country-specific campaign view. Exact aggregate risk stays behind fog of war. */
export async function campaignBriefForGlobalResponder(
  db: Db,
  crisis: Pick<Crisis, "globalResponse">,
  countryId: string,
  turn: number,
  options: CrisisDecisionOption[]
): Promise<GlobalResponseCampaignBrief | null> {
  const definition = crisis.globalResponse;
  const role = globalResponseRoleFor(crisis, countryId);
  if (!definition || !role) return null;
  const state = await loadConflictState(db, definition.conflictKey);
  const campaign = normalizeCampaignState(state.campaign);
  const stage = definition.campaign?.stage ?? campaign.stage;
  const capability = await loadCampaignCapability(db, countryId);
  return {
    stage,
    stageLabel: CAMPAIGN_STAGE_LABELS[stage],
    stageTurns: campaign.stageTurns,
    cycle: definition.campaign?.cycle ?? campaign.cycle,
    capability,
    intelligence: estimateCampaignIntelligence(campaign, capability, {
      conflictKey: definition.conflictKey,
      countryId,
      role,
      turn,
      intensity: state.intensity,
    }),
    countryMemory: campaign.countryMemory[countryId] ?? emptyCountryMemory(),
    consequenceBands: Object.fromEntries(
      Object.entries(campaign.consequences).map(([key, value]) => [key, consequenceBand(value)])
    ),
    optionAvailability: assessCampaignOptions(options, capability, stage),
  };
}

/** Re-read and enforce campaign requirements at command time. */
export async function prepareGlobalResponseOption(
  db: Db,
  crisis: Pick<Crisis, "globalResponse">,
  countryId: string,
  option: CrisisDecisionOption
): Promise<CampaignCapabilitySnapshot> {
  const definition = crisis.globalResponse;
  // A missing definition is a data fault, not a player error: leave it bare so
  // handleRouteError captures it.
  if (!definition) throw new Error("Global response definition missing");
  const { stage, capability } = await responderContext(db, definition, countryId);
  const assessment = assessCampaignRequirement(option.campaignRequirement, capability, stage);
  if (!assessment.eligible) {
    // A refusal the player can act on — the same reasons the crisis page lists
    // under the option. Typed so it reaches them as a 400, not a generic 500.
    throw badRequest(`National capacity is insufficient: ${assessment.reasons.join("; ")}`);
  }
  return capability;
}

export async function recordGlobalResponseCommitment(
  db: Db,
  crisis: Pick<Crisis, "globalResponse" | "livingConflictEventId">,
  countryId: string,
  turn: number,
  option: CrisisDecisionOption
): Promise<void> {
  const definition = crisis.globalResponse;
  if (!definition || !option.campaignCommitment) return;
  const state = await loadConflictState(db, definition.conflictKey);
  state.campaign = recordCampaignCommitment(
    state.campaign,
    countryId,
    `${crisis.livingConflictEventId ?? definition.eventKey}:${countryId}`,
    turn,
    option.campaignCommitment
  );
  await saveConflictState(db, state);
}

/** Redact covert choices from every country except the author until exposure. */
export function visibleGlobalResponses(
  responses: NonNullable<CrisisInteraction["leaderResponses"]>,
  viewerCountryId: string
): NonNullable<CrisisInteraction["leaderResponses"]> {
  return responses.map((response) => {
    if (
      response.visibility !== "covert" ||
      response.countryId === viewerCountryId ||
      response.revealedAt
    ) {
      return response;
    }
    return {
      ...response,
      optionId: "undisclosed",
      optionLabel: "Undisclosed action",
      effects: [],
      responseScores: undefined,
      campaignCommitment: undefined,
      capabilitySnapshot: undefined,
    };
  });
}

export function scoresForResponses(
  responses: NonNullable<CrisisInteraction["leaderResponses"]>
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const response of responses) {
    for (const [axis, value] of Object.entries(response.responseScores ?? {})) {
      if (!Number.isFinite(value)) continue;
      scores[axis] = (scores[axis] ?? 0) + value;
    }
  }
  return scores;
}

export function scoresForGlobalResponse(
  crisis: Pick<Crisis, "globalResponse">,
  interaction: Pick<CrisisInteraction, "leaderResponses" | "decisionTree" | "currentNodeId">
): Record<string, number> {
  const scores = scoresForResponses(interaction.leaderResponses ?? []);
  const responded = new Set(
    (interaction.leaderResponses ?? []).map((response) => response.countryId)
  );
  const node = interaction.decisionTree.find(
    (candidate) => candidate.nodeId === interaction.currentNodeId
  );
  if (!node || !crisis.globalResponse) return scores;

  for (const [countryId, role] of Object.entries(crisis.globalResponse.roleByCountry)) {
    if (responded.has(countryId)) continue;
    const defaultId = crisis.globalResponse.defaultOptionIdByRole[role];
    const option = (node.optionsByRole?.[role] ?? node.options ?? []).find(
      (candidate) => candidate.optionId === defaultId
    );
    for (const [axis, value] of Object.entries(option?.responseScores ?? {})) {
      if (Number.isFinite(value)) scores[axis] = (scores[axis] ?? 0) + value;
    }
  }
  return scores;
}

function outcomeMatches(outcome: GlobalResponseOutcome, scores: Record<string, number>): boolean {
  return outcome.conditions.every((condition) => {
    const value = scores[condition.axis] ?? 0;
    if (condition.min !== undefined && value < condition.min) return false;
    if (condition.max !== undefined && value > condition.max) return false;
    return true;
  });
}

export function selectGlobalResponseOutcome(
  outcomes: GlobalResponseOutcome[],
  defaultOutcomeId: string,
  scores: Record<string, number>
): GlobalResponseOutcome {
  const ordered = [...outcomes].sort((a, b) => b.priority - a.priority);
  return (
    ordered.find((outcome) => outcomeMatches(outcome, scores)) ??
    outcomes.find((outcome) => outcome.outcomeId === defaultOutcomeId) ??
    ordered[ordered.length - 1]
  );
}

/** Debit a response's real fiscal cost, sized against the live national GDP. */
export async function spendGlobalResponseCost(
  db: Db,
  countryId: string,
  option: CrisisDecisionOption
): Promise<number> {
  const pct = option.treasuryCostPctGdp ?? 0;
  if (!(pct > 0)) return 0;
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId: countryId as FederalBudget["countryId"] });
  const gdp =
    budget?.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : (budget?.gdp ?? 0);
  const amount = Math.max(0, Math.round(gdp * pct));
  if (amount > 0) {
    await spendFromTreasury(db, countryId, amount, { resyncDerived: true });
  }
  return amount;
}

async function applyEffectsForCountry(
  db: Db,
  countryId: string,
  effects: CrisisDecisionOption["effects"]
): Promise<void> {
  if (effects.length === 0) return;
  const states = await db
    .collection<{ _id: string }>("states")
    .find({ countryId }, { projection: { _id: 1 } })
    .toArray();
  const characters = effects.some((effect) => effect.targetType === "stat")
    ? await db
        .collection<{ _id: ObjectId }>("characters")
        .find({ countryId }, { projection: { _id: 1 } })
        .toArray()
    : [];
  await applyCrisisEffects(
    db,
    effects,
    states.map((state) => state._id),
    [countryId],
    characters.map((character) => character._id)
  );
}

async function applyOutcomeTrajectory(
  db: Db,
  crisis: Crisis,
  outcome: GlobalResponseOutcome,
  resolutionId: string
): Promise<{ previousStage: CampaignStage; nextStage: CampaignStage; applied: boolean } | null> {
  const definition = crisis.globalResponse;
  if (!definition) return null;
  const def = livingConflictDef(definition.conflictKey);
  if (!def) return null;

  let state = await loadConflictState(db, def.key);
  const campaignResult = applyCampaignOutcome(state.campaign, {
    resolutionId,
    outcomeId: outcome.outcomeId,
    delta: outcome.campaignDelta,
    nextStage: outcome.nextCampaignStage,
  });
  state.campaign = campaignResult.state;
  if (outcome.intensityDelta) {
    state = adjustIntensity(state, outcome.intensityDelta);
  }
  const gameState = await getGameState(db);
  for (const [side, amount] of Object.entries(outcome.pressureDelta ?? {})) {
    if (!amount) continue;
    state =
      amount > 0
        ? applyCommitment(def, state, side, amount, gameState?.currentYear)
        : relieveCommitment(def, state, side, Math.abs(amount));
  }
  await saveConflictState(db, state);
  if (campaignResult.applied && outcome.tensionDelta) {
    const gameState = await getGameState(db);
    await applyTensionEvent(
      db,
      gameState?.currentTurn ?? crisis.startTurn,
      outcome.tensionDelta > 0 ? "escalation" : "detente",
      outcome.label,
      outcome.tensionDelta
    );
  }
  return campaignResult;
}

/**
 * Resolve a shared response exactly once. The interaction document is claimed
 * before effects are applied, so replayed turns cannot double-charge an outcome.
 */
export async function resolveGlobalResponse(
  db: Db,
  crisisId: ObjectId
): Promise<ResolvedGlobalResponse | null> {
  const crisis = await db.collection<Crisis>("crises").findOne({ _id: crisisId });
  if (!crisis?.globalResponse) return null;
  const interaction = await db
    .collection<CrisisInteraction>("crisisInteractions")
    .findOne({ crisisId });
  if (!interaction) return null;
  if (interaction.globalResponseOutcome) return interaction.globalResponseOutcome;

  const scores = scoresForGlobalResponse(crisis, interaction);
  const outcome = selectGlobalResponseOutcome(
    crisis.globalResponse.outcomes,
    crisis.globalResponse.defaultOutcomeId,
    scores
  );
  if (!outcome) return null;

  const now = new Date();
  const resolved: ResolvedGlobalResponse = {
    outcomeId: outcome.outcomeId,
    label: outcome.label,
    description: outcome.description,
    scores,
    respondedCountries: interaction.leaderResponses?.length ?? 0,
    eligibleCountries: Object.keys(crisis.globalResponse.roleByCountry).length,
    resolvedAt: now,
  };
  const responsesWithExposure = (interaction.leaderResponses ?? []).map((response) => {
    const risk = response.campaignCommitment?.covertExposureRisk ?? 0;
    if (
      response.visibility === "covert" &&
      shouldExposeCovertResponse(crisisId.toString(), response.countryId, risk)
    ) {
      return { ...response, revealedAt: now };
    }
    return response;
  });

  const claimed = await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
    { _id: interaction._id, globalResponseOutcome: { $exists: false } },
    {
      $set: {
        globalResponseOutcome: resolved,
        leaderResponses: responsesWithExposure,
        currentNodeId: null,
        decisionDeadline: null,
        resolvedAt: now,
        resolutionOutcome: "completed",
        updatedAt: now,
      },
    }
  );
  if (claimed.modifiedCount === 0) {
    return (
      (
        await db
          .collection<CrisisInteraction>("crisisInteractions")
          .findOne({ _id: interaction._id })
      )?.globalResponseOutcome ?? null
    );
  }

  for (const [countryId, role] of Object.entries(crisis.globalResponse.roleByCountry)) {
    const effects = outcome.effectsByRole?.[role] ?? [];
    if (effects.length > 0) await applyEffectsForCountry(db, countryId, effects);
  }
  const campaignResult = await applyOutcomeTrajectory(
    db,
    crisis,
    outcome,
    crisis.livingConflictEventId ?? crisisId.toString()
  );
  if (campaignResult) {
    resolved.campaignStageBefore = campaignResult.previousStage;
    resolved.campaignStageAfter = campaignResult.nextStage;
    await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
      { _id: interaction._id },
      {
        $set: {
          "globalResponseOutcome.campaignStageBefore": campaignResult.previousStage,
          "globalResponseOutcome.campaignStageAfter": campaignResult.nextStage,
          updatedAt: new Date(),
        },
      }
    );
  }
  await logWireEvent("crisis_outcome", outcome.wireMessage, {
    href: `/world/crises/${crisisId.toString()}`,
  });
  return resolved;
}
