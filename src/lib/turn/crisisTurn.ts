import { ObjectId, type Db, type Filter } from "mongodb";
import { logWireEvent } from "@/lib/wireEvent";
import { createNotifications } from "@/lib/notifications";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import type { Crisis, CrisisEffect, CrisisInteraction } from "@/lib/db/types/crisis";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import type { MetricCategoryId } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import {
  createCrisisInteraction,
  getExpiredInteractions,
  autoResolveCrisisInteraction,
  calculateCollectiveReduction,
} from "@/lib/crises/interactionEngine";
import { processCrisisAidResolutions, reverseCrisisAidPenalties } from "@/lib/crises/aidFinalize";

/**
 * Process active crises for the current turn.
 * - Flat effects applied on startTurn only; tick effects every turn
 * - Scope resolved to target stateIds; effects applied per region
 * - Auto-resolves crises that exceed durationTurns
 * - Emits wire events on crisis activation and resolution
 * - Handles crisis interactions (decision trees, collective contributions)
 *
 * Runs in Group 11 (Effects & Metrics) — parallel-safe with other phases.
 * Runs after corporations (Group 1a), before history snapshots (Group 13).
 */
/** Trim to a max length on a word boundary, appending an ellipsis when cut. */
function truncate(s: string | undefined | null, max: number): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

export async function processCrisisTurn(db: Db, turn: number): Promise<number> {
  const crises = await db.collection<Crisis>("crises").find({ status: "active" }).toArray();

  // Aid-bill resolution + penalty reversal run independently of whether any
  // crisis is currently active, so they must execute before the early return.
  await processCrisisAidResolutions(db, turn);
  await reverseCrisisAidPenalties(db, turn);

  if (crises.length === 0) return 0;

  const allStates = await db.collection<State>("states").find({}).toArray();

  // country → stateId[] for scope resolution
  const statesByCountry = new Map<string, string[]>();
  for (const state of allStates) {
    const existing = statesByCountry.get(state.countryId) ?? [];
    existing.push(state._id);
    statesByCountry.set(state.countryId, existing);
  }
  const allStateIds = allStates.map((s) => s._id);

  // stateId → countryId for region-scoped approval effects
  const countryByState = new Map<string, string>();
  for (const state of allStates) {
    countryByState.set(state._id, state.countryId);
  }

  const toResolve: Crisis[] = [];

  for (const crisis of crises) {
    const targetStateIds = resolveScope(crisis, allStateIds, statesByCountry);

    // Check for interaction-based duration reduction
    let effectiveDuration = crisis.durationTurns;
    if (crisis.interactionDefinition) {
      const interaction = await db
        .collection<CrisisInteraction>("crisisInteractions")
        .findOne({ crisisId: crisis._id });
      if (interaction && effectiveDuration !== null) {
        const reduction = calculateCollectiveReduction(interaction, effectiveDuration);
        effectiveDuration = Math.max(1, effectiveDuration - reduction);
      }
    }

    // Per-turn effects ramp DOWN linearly from full strength at onset to zero at
    // expiry (so a 24-turn crisis is at 50% by turn 12). One-time `flat`/`gdpLoss`
    // effects are not scaled — they fire once, at onset.
    const tickScale = tickDecayFactor(turn, crisis.startTurn, effectiveDuration);
    const effectsToApply = crisis.effects
      .filter(
        (e) => e.effectType === "tick" || (e.effectType === "flat" && turn === crisis.startTurn)
      )
      .map((e) => (e.effectType === "tick" ? { ...e, value: e.value * tickScale } : e));

    if (effectsToApply.length > 0 && targetStateIds.length > 0) {
      await applyMetricEffects(
        db,
        targetStateIds,
        effectsToApply.filter((e) => e.targetType === "metric")
      );
      await applyApprovalEffects(
        db,
        crisis,
        targetStateIds,
        countryByState,
        statesByCountry,
        effectsToApply.filter((e) => e.targetType === "approval")
      );
      await applyProfitMarginEffects(
        db,
        targetStateIds,
        effectsToApply.filter((e) => e.targetType === "profitMargin")
      );
      await applyInflationEffects(
        db,
        crisis,
        targetStateIds,
        countryByState,
        statesByCountry,
        effectsToApply.filter((e) => e.targetType === "inflation")
      );
      await applyGdpLossEffects(
        db,
        targetStateIds,
        effectsToApply.filter((e) => e.targetType === "gdpLoss")
      );
      await applyStatEffects(
        db,
        crisis,
        targetStateIds,
        countryByState,
        statesByCountry,
        effectsToApply.filter((e) => e.targetType === "stat")
      );
    }

    // Wire event on activation turn only
    if (turn === crisis.startTurn) {
      await logWireEvent("crisis_start", crisis.wireMessageOnStart, {
        href: `/world/crises/${crisis._id.toString()}`,
      });

      // Create interaction document for interactive crises (only if enabled)
      if (crisis.interactionDefinition) {
        const { isCrisisInteractionEnabled } = await import("@/lib/crises/featureFlag");
        if (await isCrisisInteractionEnabled()) {
          await createCrisisInteraction(db, crisis);
        }
      }

      // Notify affected players
      await notifyAffectedPlayers(db, crisis, targetStateIds, "crisis_start");
    }

    // Expiry check: durationTurns null = indefinite; use effectiveDuration
    if (effectiveDuration !== null && turn >= crisis.startTurn + effectiveDuration) {
      toResolve.push(crisis);
    }
  }

  // Batch-resolve expired crises
  if (toResolve.length > 0) {
    const ids = toResolve.map((c) => c._id);
    await db
      .collection<Crisis>("crises")
      .updateMany(
        { _id: { $in: ids } },
        { $set: { status: "resolved", endTurn: turn, resolvedAt: new Date() } }
      );
    // Close any still-open interactions for the resolved crises. Multi-responder
    // global crises carry no decision deadline, so they never auto-resolve on a
    // timer — without this they'd linger "open" after the crisis itself ended.
    // Each leader's effects were already applied at response time; this only
    // flips the lifecycle flag so the panel reads as resolved.
    await db.collection<CrisisInteraction>("crisisInteractions").updateMany(
      { crisisId: { $in: ids }, resolvedAt: null },
      {
        $set: {
          currentNodeId: null,
          decisionDeadline: null,
          resolvedAt: new Date(),
          resolutionOutcome: "completed",
          updatedAt: new Date(),
        },
      }
    );
    for (const crisis of toResolve) {
      if (crisis.wireMessageOnEnd) {
        await logWireEvent("crisis_end", crisis.wireMessageOnEnd, {
          href: `/world/crises/${crisis._id.toString()}`,
        });
      }
      // Notify affected players of resolution
      const targetStateIds = resolveScope(crisis, allStateIds, statesByCountry);
      await notifyAffectedPlayers(db, crisis, targetStateIds, "crisis_end");
    }
  }

  // Auto-resolve expired interactions (only if enabled)
  const { isCrisisInteractionEnabled } = await import("@/lib/crises/featureFlag");
  if (await isCrisisInteractionEnabled()) {
    const expiredInteractions = await getExpiredInteractions(db);
    for (const interaction of expiredInteractions) {
      await autoResolveCrisisInteraction(db, interaction._id);
    }
  }

  return crises.length;
}

/**
 * Linear ramp-down for per-turn (`tick`) effects: 1.0 at onset → 0 at expiry, so
 * a crisis's drag fades smoothly over its life (at the midpoint it is at 50%).
 * Indefinite crises (`duration` null/≤0) never fade — they hold full strength.
 */
export function tickDecayFactor(turn: number, startTurn: number, duration: number | null): number {
  if (duration === null || duration <= 0) return 1;
  const elapsed = turn - startTurn;
  return Math.max(0, Math.min(1, 1 - elapsed / duration));
}

/**
 * One-time real GDP-output loss (physical-destruction disasters). Each effect's
 * `value` is the fraction of the affected region's GDP destroyed; multiple losses
 * compound multiplicatively. Applied as `$mul` on `state.gdp` so the economy
 * regrows from the reduced base on subsequent turns (the loss persists).
 */
async function applyGdpLossEffects(
  db: Db,
  targetStateIds: string[],
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0 || targetStateIds.length === 0) return;

  let factor = 1;
  for (const effect of effects) {
    const fraction = Math.max(0, Math.min(0.95, Math.abs(effect.value)));
    factor *= 1 - fraction;
  }
  if (factor >= 1) return;

  await db
    .collection("states")
    .updateMany(
      { _id: { $in: targetStateIds.map((id) => id as unknown as import("mongodb").ObjectId) } },
      { $mul: { gdp: factor } }
    );
}

function resolveScope(
  crisis: Crisis,
  allStateIds: string[],
  statesByCountry: Map<string, string[]>
): string[] {
  if (crisis.scope === "global") return allStateIds;
  if (crisis.scope === "country") {
    return crisis.countryIds.flatMap((cId) => statesByCountry.get(cId) ?? []);
  }
  return crisis.regionIds;
}

async function notifyAffectedPlayers(
  db: Db,
  crisis: Crisis,
  targetStateIds: string[],
  type: "crisis_start" | "crisis_end"
): Promise<void> {
  // Find all characters in affected states
  const characters = await db
    .collection("characters")
    .find({
      homeState: { $in: targetStateIds },
      active: { $ne: false },
    })
    .project({ _id: 1, userId: 1 })
    .toArray();

  const userIds = [...new Set(characters.map((c) => c.userId?.toString()).filter(Boolean))];
  if (userIds.length === 0) return;

  // Keep the inbox body to a single concise line — prefer the wire copy and fall
  // back to a trimmed description. The full flavor text lives on the crisis detail
  // page, reached via the "View crisis" link (metadata.crisisId → sourceLink).
  const message =
    type === "crisis_start"
      ? crisis.wireMessageOnStart?.trim() || truncate(crisis.description, 160)
      : crisis.wireMessageOnEnd?.trim() || `The ${crisis.name} has eased.`;

  const title = type === "crisis_start" ? crisis.name : `${crisis.name} — Resolved`;

  const notifications = userIds.map((userId) => ({
    userId: new ObjectId(userId),
    type: "crisis" as const,
    title,
    message,
    metadata: { crisisId: crisis._id.toString() },
  }));

  await createNotifications(notifications);
}

async function applyMetricEffects(
  db: Db,
  targetStateIds: string[],
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;

  // Accumulate all metric deltas per path, then apply them as ONE aggregation-
  // pipeline update clamped to the metric's bounds (S8: the old bare `$inc`
  // could push a metric arbitrarily far out of range and the excursion
  // persisted forever). Bound source: metricDefinitions minValue/maxValue with
  // the same `?? 0` / `?? 100` defaults processStateMetrics uses for its own
  // clamp — crisis effects can target ANY stateMetrics field (not just engine
  // registry nodes), and metricDefinitions is the write-path-authoritative
  // range for that collection. Mirrors the profitMargin pipeline clamp below.
  const deltas: Record<string, { delta: number; min: number; max: number }> = {};
  for (const effect of effects) {
    if (effect.metricCategory && effect.metricField) {
      const path = `${effect.metricCategory}.${effect.metricField}.value`;
      const def = getMetricDefinition(
        effect.metricCategory as MetricCategoryId,
        effect.metricField
      );
      const entry = deltas[path] ?? {
        delta: 0,
        min: def?.minValue ?? 0,
        max: def?.maxValue ?? 100,
      };
      entry.delta += effect.value;
      deltas[path] = entry;
    }
  }
  if (Object.keys(deltas).length === 0 || targetStateIds.length === 0) return;

  // Routing mirrors crises/applyEffects: macro paths -> macroMetrics for every
  // target region, political paths -> each region's board. The macro half gets
  // the S8 clamped aggregation-pipeline update so a crisis can never push a
  // metric out of its definition bounds; the board half is clamped 0-100 by
  // `applyBoardDelta` itself.
  const macroDeltas: typeof deltas = {};
  const politicalDeltas: typeof deltas = {};
  for (const [path, entry] of Object.entries(deltas)) {
    (isMacroMetricPath(path) ? macroDeltas : politicalDeltas)[path] = entry;
  }
  const clampedSet = (bucket: typeof deltas): Record<string, unknown> => {
    const set: Record<string, unknown> = { lastUpdated: "$$NOW" };
    for (const [path, { delta, min, max }] of Object.entries(bucket)) {
      // $ifNull preserves the old $inc upsert-ish semantics for a missing
      // field (treated as 0, then clamped) instead of erroring on null.
      set[path] = {
        $max: [min, { $min: [max, { $add: [{ $ifNull: [`$${path}`, 0] }, delta] }] }],
      };
    }
    return set;
  };

  const writes: Array<Promise<unknown>> = [];
  if (Object.keys(macroDeltas).length > 0) {
    writes.push(
      db
        .collection("macroMetrics")
        .updateMany(
          { _id: { $in: targetStateIds.map((id) => id as unknown as import("mongodb").ObjectId) } },
          [{ $set: clampedSet(macroDeltas) }]
        )
    );
  }
  // The per-turn political half, as a VALUE shift — the same events channel and
  // the same reasoning as the one-off effects in crises/applyEffects: a crisis
  // damages something and the damage heals, which is what the dynamics phase's
  // drift gives a value. A residual would make an ongoing crisis permanently
  // redefine the country's equilibrium every turn it runs.
  //
  // The bridge takes "category.metricId", so the trailing `.value` that the
  // legacy `$set` path carries is dropped.
  for (const [path, { delta }] of Object.entries(politicalDeltas)) {
    const [category, metricId] = path.split(".");
    const hit = boardDeltaForLegacyEffect(category, metricId, delta);
    if (!hit) continue;
    for (const stateId of targetStateIds) {
      writes.push(
        applyBoardDelta(
          db,
          { _id: stateId } as Filter<PoliticalMetricsDoc>,
          hit.familyId,
          hit.scoreDelta,
          "value"
        )
      );
    }
  }

  await Promise.all(writes);
}

async function applyApprovalEffects(
  db: Db,
  crisis: Crisis,
  targetStateIds: string[],
  countryByState: Map<string, string>,
  statesByCountry: Map<string, string[]>,
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;

  const approvalDelta = effects.reduce((sum, e) => sum + e.value, 0);

  // Deduplicate affected countries — region-scoped crises derive from parent country
  let affectedCountries: string[];
  if (crisis.scope === "global") {
    affectedCountries = [...statesByCountry.keys()];
  } else if (crisis.scope === "country") {
    affectedCountries = crisis.countryIds as string[];
  } else {
    const countries = new Set<string>();
    for (const stateId of targetStateIds) {
      const countryId = countryByState.get(stateId);
      if (countryId) countries.add(countryId);
    }
    affectedCountries = [...countries];
  }

  if (affectedCountries.length > 0) {
    await db.collection("governmentApprovals").updateMany(
      {
        _id: { $in: affectedCountries.map((id) => id as unknown as import("mongodb").ObjectId) },
      },
      { $inc: { approvalRating: approvalDelta } }
    );
  }
}

async function applyInflationEffects(
  db: Db,
  crisis: Crisis,
  targetStateIds: string[],
  countryByState: Map<string, string>,
  statesByCountry: Map<string, string[]>,
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;

  const delta = effects.reduce((sum, e) => sum + e.value, 0);
  if (delta === 0) return;

  // Same country derivation as approval — region-scoped crises map to parent country.
  let affectedCountries: string[];
  if (crisis.scope === "global") {
    affectedCountries = [...statesByCountry.keys()];
  } else if (crisis.scope === "country") {
    affectedCountries = crisis.countryIds as string[];
  } else {
    const countries = new Set<string>();
    for (const stateId of targetStateIds) {
      const countryId = countryByState.get(stateId);
      if (countryId) countries.add(countryId);
    }
    affectedCountries = [...countries];
  }

  if (affectedCountries.length > 0) {
    // Bumps the real national inflation rate; the per-turn inflation recalc then
    // blends it through inertia, so a crisis shock decays over subsequent turns.
    await db.collection("federalBudget").updateMany(
      { countryId: { $in: affectedCountries } },
      {
        $inc: { "economicFactors.inflationRate": delta },
        $set: { "economicFactors.lastUpdated": new Date() },
      }
    );
  }
}

async function applyProfitMarginEffects(
  db: Db,
  targetStateIds: string[],
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;

  for (const effect of effects) {
    if (effect.effectType === "decay") continue;
    const filter: Record<string, unknown> = { stateId: { $in: targetStateIds } };
    if (effect.sectorType) filter.sectorType = effect.sectorType;
    if (effect.strategyId) filter.strategyId = effect.strategyId;

    // Aggregation pipeline update to clamp profitMargin to [0, 100]
    await db.collection("corporateSectors").updateMany(filter, [
      {
        $set: {
          profitMargin: {
            $max: [0, { $min: [100, { $add: ["$profitMargin", effect.value] }] }],
          },
        },
      },
    ]);
  }
}

/**
 * Apply stat-loss effects to characters affected by a crisis.
 * Characters in the affected scope lose the specified stat points.
 */
async function applyStatEffects(
  db: Db,
  crisis: Crisis,
  targetStateIds: string[],
  countryByState: Map<string, string>,
  statesByCountry: Map<string, string[]>,
  effects: CrisisEffect[]
): Promise<void> {
  if (effects.length === 0) return;

  // Build a map: statKey -> total drop
  const dropsByStat: Record<string, number> = {};
  for (const effect of effects) {
    if (!effect.statKey) continue;
    dropsByStat[effect.statKey] = (dropsByStat[effect.statKey] ?? 0) + Math.abs(effect.value);
  }

  const statKeys = Object.keys(dropsByStat);
  if (statKeys.length === 0) return;

  // Resolve affected characters by scope
  const filter: Record<string, unknown> = { retiredAt: null };
  if (crisis.scope === "global") {
    // All active characters
  } else if (crisis.scope === "country") {
    const affectedCountries = crisis.countryIds as string[];
    filter["currentOffice.countryId"] = { $in: affectedCountries };
  } else {
    filter["currentOffice.stateId"] = { $in: targetStateIds };
  }

  const chars = await db
    .collection<{ _id: ObjectId; stats?: Record<string, number> }>("characters")
    .find(filter, { projection: { _id: 1, stats: 1 } })
    .toArray();

  const ops: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: { stats: Record<string, number>; updatedAt: Date } };
    };
  }> = [];

  for (const char of chars) {
    if (!char.stats) continue;
    const nextStats = { ...char.stats };
    for (const key of statKeys) {
      if (nextStats[key] != null) {
        nextStats[key] = Math.min(10, Math.max(1, nextStats[key] - dropsByStat[key]));
      }
    }
    ops.push({
      updateOne: {
        filter: { _id: char._id },
        update: { $set: { stats: nextStats, updatedAt: new Date() } },
      },
    });
  }

  if (ops.length > 0) {
    await db.collection("characters").bulkWrite(ops);
  }
}

export { applyProfitMarginEffects as applyProfitMarginEffectsForTest };
