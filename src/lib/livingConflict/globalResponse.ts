import type { Db, ObjectId } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import type {
  Crisis,
  CrisisDecisionNode,
  CrisisDecisionOption,
  CrisisInteraction,
  GlobalResponseOutcome,
  GlobalResponseRole,
  ResolvedGlobalResponse,
} from "@/lib/db/types/crisis";
import { spendFromTreasury } from "@/lib/budget/treasurySpend";
import { applyCrisisEffects } from "@/lib/crises/applyEffects";
import { getGameState } from "@/lib/gameState";
import { logWireEvent } from "@/lib/wireEvent";
import { adjustIntensity, applyCommitment, relieveCommitment } from "./engine";
import { livingConflictDef } from "./registry";
import { loadConflictState, saveConflictState } from "./driver";

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
  outcome: GlobalResponseOutcome
): Promise<void> {
  const definition = crisis.globalResponse;
  if (!definition) return;
  const def = livingConflictDef(definition.conflictKey);
  if (!def) return;

  let state = await loadConflictState(db, def.key);
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

  const claimed = await db.collection<CrisisInteraction>("crisisInteractions").updateOne(
    { _id: interaction._id, globalResponseOutcome: { $exists: false } },
    {
      $set: {
        globalResponseOutcome: resolved,
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
  await applyOutcomeTrajectory(db, crisis, outcome);
  await logWireEvent("crisis_outcome", outcome.wireMessage, {
    href: `/world/crises/${crisisId.toString()}`,
  });
  return resolved;
}
