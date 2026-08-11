import { type Db, type Filter, ObjectId } from "mongodb";
import type { CrisisEffect } from "@/lib/db/types/crisis";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { boardDeltaForLegacyEffect } from "@/lib/politicalLegislation/legacyEffectBridge";
import { applyBoardDelta } from "@/lib/politicalLegislation/boardWrite";
import type { CharacterStats, StatKey } from "@/lib/stats/statsConstants";
import { STAT_MIN, STAT_MAX } from "@/lib/stats/statsConstants";

/**
 * Clamp a stat value to the legal [STAT_MIN, STAT_MAX] range.
 */
function clampStat(value: number): number {
  return Math.min(STAT_MAX, Math.max(STAT_MIN, value));
}

/**
 * Apply crisis effects to the actual game collections:
 * - macroMetrics + politicalMetrics (for metric effects)
 * - governmentApproval (for approval effects)
 * - corporateSectors (for profitMargin effects)
 * - federalBudget (for inflation effects)
 * - characters (for stat effects)
 */
export async function applyCrisisEffects(
  db: Db,
  effects: CrisisEffect[],
  targetStateIds: string[],
  affectedCountries: string[],
  affectedCharacterIds?: ObjectId[]
): Promise<void> {
  const metricEffects = effects.filter((e) => e.targetType === "metric");
  const approvalEffects = effects.filter((e) => e.targetType === "approval");
  const profitMarginEffects = effects.filter((e) => e.targetType === "profitMargin");
  const inflationEffects = effects.filter((e) => e.targetType === "inflation");
  const statEffects = effects.filter((e) => e.targetType === "stat");

  if (metricEffects.length > 0) {
    await applyMetricEffects(db, targetStateIds, metricEffects);
  }

  if (approvalEffects.length > 0) {
    await applyApprovalEffects(db, affectedCountries, approvalEffects);
  }

  if (profitMarginEffects.length > 0) {
    await applyProfitMarginEffects(db, targetStateIds, profitMarginEffects);
  }

  if (inflationEffects.length > 0) {
    await applyInflationEffects(db, affectedCountries, inflationEffects);
  }

  if (statEffects.length > 0 && affectedCharacterIds && affectedCharacterIds.length > 0) {
    await applyStatEffects(db, affectedCharacterIds, statEffects);
  }
}

/**
 * Crisis inflation shock. Bumps each affected country's national inflation rate
 * (`federalBudget.economicFactors.inflationRate`). The per-turn inflation recalc
 * (`recalculateInflationPerTurn`) blends this through ~35% inertia, so the shock
 * decays over subsequent turns rather than persisting forever — the realistic
 * behaviour for a transient crisis.
 */
async function applyInflationEffects(
  db: Db,
  affectedCountries: string[],
  effects: CrisisEffect[]
): Promise<void> {
  const delta = effects.reduce((sum, e) => sum + e.value, 0);
  if (affectedCountries.length === 0 || delta === 0) return;

  await db.collection("federalBudget").updateMany(
    { countryId: { $in: affectedCountries } },
    {
      $inc: { "economicFactors.inflationRate": delta },
      $set: { "economicFactors.lastUpdated": new Date() },
    }
  );
}

async function applyMetricEffects(
  db: Db,
  targetStateIds: string[],
  effects: CrisisEffect[]
): Promise<void> {
  const inc: Record<string, number> = {};
  for (const effect of effects) {
    if (effect.metricCategory && effect.metricField) {
      const path = `${effect.metricCategory}.${effect.metricField}.value`;
      inc[path] = (inc[path] ?? 0) + effect.value;
    }
  }
  if (Object.keys(inc).length === 0 || targetStateIds.length === 0) return;

  // Macro paths land on macroMetrics; political paths land on each target
  // region's political board.
  const macroInc: Record<string, number> = {};
  const politicalInc: Record<string, number> = {};
  for (const [path, delta] of Object.entries(inc)) {
    (isMacroMetricPath(path) ? macroInc : politicalInc)[path] = delta;
  }

  const writes: Array<Promise<unknown>> = [];
  if (Object.keys(macroInc).length > 0) {
    writes.push(
      db
        .collection("macroMetrics")
        .updateMany(
          { _id: { $in: targetStateIds.map((id) => id as unknown as import("mongodb").ObjectId) } },
          { $inc: macroInc, $set: { lastUpdated: new Date() } }
        )
    );
  }
  // Political effects move the BOARD, as a VALUE shift.
  //
  // A crisis is an EVENT: it damages something and the damage heals. Shifting
  // the value gives exactly that, because the dynamics phase drifts the value
  // back toward its composed target each turn — the board's analogue of the
  // decay the legacy `$inc` relied on. A residual would instead move the
  // country's equilibrium, so one earthquake would permanently redefine how
  // good its infrastructure is. Same reasoning, and the same mode, as the
  // sovereign-default trust hit.
  //
  // Through `applyBoardDelta`, never a dotted `$inc`: board docs key `values`
  // by literal dotted strings, so `{ $inc: { "values.order.safety": d } }` is
  // read as a PATH and quietly creates a nested object nothing reads.
  //
  // The paths are stripped of their trailing `.value` because the bridge takes
  // "category.metricId" — the legacy `$inc` shape carries a third segment.
  for (const [path, delta] of Object.entries(politicalInc)) {
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
  affectedCountries: string[],
  effects: CrisisEffect[]
): Promise<void> {
  const approvalDelta = effects.reduce((sum, e) => sum + e.value, 0);

  if (affectedCountries.length > 0) {
    await db.collection("governmentApprovals").updateMany(
      {
        _id: { $in: affectedCountries.map((id) => id as unknown as import("mongodb").ObjectId) },
      },
      { $inc: { approvalRating: approvalDelta } }
    );
  }
}

async function applyProfitMarginEffects(
  db: Db,
  targetStateIds: string[],
  effects: CrisisEffect[]
): Promise<void> {
  for (const effect of effects) {
    const filter: Record<string, unknown> = { stateId: { $in: targetStateIds } };
    if (effect.sectorType) filter.sectorType = effect.sectorType;
    if (effect.strategyId) filter.strategyId = effect.strategyId;

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
 * Each matching stat is decremented by the effect's value, clamped to [1, 10].
 * Characters without stats are skipped silently.
 */
async function applyStatEffects(
  db: Db,
  characterIds: ObjectId[],
  effects: CrisisEffect[]
): Promise<void> {
  // Build a map: statKey -> total drop
  const dropsByStat: Record<string, number> = {};
  for (const effect of effects) {
    if (!effect.statKey) continue;
    dropsByStat[effect.statKey] = (dropsByStat[effect.statKey] ?? 0) + Math.abs(effect.value);
  }

  const statKeys = Object.keys(dropsByStat);
  if (statKeys.length === 0 || characterIds.length === 0) return;

  // Pull current stats, apply drops, write back
  const chars = await db
    .collection<{ _id: ObjectId; stats?: CharacterStats }>("characters")
    .find({ _id: { $in: characterIds } }, { projection: { _id: 1, stats: 1 } })
    .toArray();

  const ops: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update: { $set: { stats: CharacterStats; updatedAt: Date } };
    };
  }> = [];

  for (const char of chars) {
    if (!char.stats) continue;
    const nextStats = { ...char.stats };
    for (const key of statKeys) {
      if (nextStats[key as StatKey] != null) {
        nextStats[key as StatKey] = clampStat(nextStats[key as StatKey] - dropsByStat[key]);
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
