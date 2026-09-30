/**
 * Unanswered living-conflict decisions apply their authored fallback trajectory.
 * A source marker on each affected document makes a resumed expiry safe; no
 * character is impersonated and this path cannot introduce legislation.
 */
import type { Db } from "mongodb";
import type { CrisisOptionAction } from "@/lib/db/types/crisis";
import type { LivingConflictState } from "./types";
import { livingConflictDef } from "./registry";
import { applyConflictOutcome, evaluateConflictTransitions } from "./engine";

type Trajectory = Extract<CrisisOptionAction, { kind: "livingConflictTrajectory" }>;

export async function applyLivingConflictFallback(
  db: Db,
  sourceId: string,
  action: Trajectory
): Promise<void> {
  const def = livingConflictDef(action.conflictKey);
  if (!def) throw new Error(`Unknown living conflict: ${action.conflictKey}`);
  const conflicts = db.collection<LivingConflictState>("livingConflicts");
  const current = await conflicts.findOne({ defKey: def.key });
  if (!current?.hasOpened) return;
  if (!current.fallbackResolutionIds?.includes(sourceId)) {
    const next = evaluateConflictTransitions(def, applyConflictOutcome(def, current, action)).state;
    const changed = await conflicts.updateOne(
      { defKey: def.key, updatedAt: current.updatedAt, fallbackResolutionIds: { $ne: sourceId } },
      {
        $set: {
          ...next,
          fallbackResolutionIds: [...(current.fallbackResolutionIds ?? []), sourceId].slice(-256),
        },
      }
    );
    if (changed.matchedCount === 0)
      throw new Error("Conflict changed during fallback; retry expiry.");
  }
  const regional = action.regionalEffects;
  if (!regional) return;
  // Each write is an atomic clamp plus receipt. A crash after either document
  // commits retries only the missing write, without reapplying its sibling.
  for (const [collection, path, delta] of [
    ["macroMetrics", "independenceDesire.value", regional.independenceDesireDelta],
    ["politicalMetrics", "governance.localAutonomy", regional.devolutionSatisfactionDelta],
  ] as const) {
    if (!delta) continue;
    // Metric dimension keys contain literal dots, so the political map needs
    // $getField/$setField instead of interpreting the dimension as a path.
    const political = collection === "politicalMetrics";
    const currentValue = political
      ? { $getField: { field: "governance.localAutonomy", input: "$values" } }
      : `$${path}`;
    const value = { $max: [0, { $min: [100, { $add: [currentValue, delta] }] }] };
    await db.collection<{ _id: string; livingConflictFallbacks?: string[] }>(collection).updateOne(
      {
        _id: regional.regionId,
        livingConflictFallbacks: { $ne: sourceId },
        $expr: { $ne: [{ $type: currentValue }, "missing"] },
      },
      [
        {
          $set: {
            ...(political
              ? {
                  values: {
                    $setField: { field: "governance.localAutonomy", input: "$values", value },
                  },
                }
              : { [path]: value }),
            livingConflictFallbacks: {
              $slice: [
                { $concatArrays: [{ $ifNull: ["$livingConflictFallbacks", []] }, [sourceId]] },
                -256,
              ],
            },
            lastUpdated: "$$NOW",
          },
        },
      ]
    );
  }
}
