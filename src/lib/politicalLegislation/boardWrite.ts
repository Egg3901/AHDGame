/**
 * The ONE safe way to move a single political-board family.
 *
 * WHY THIS EXISTS — a board doc's `values`/`residuals` keys are literal dotted
 * strings ("governance.integrity"), not nested objects. So a Mongo update path
 * like `{ $inc: { "residuals.governance.integrity": d } }` does NOT touch that
 * key: Mongo reads the dots as a path and quietly creates
 * `residuals: { governance: { integrity: d } }` instead. The read side then
 * looks up `residuals["governance.integrity"]`, finds nothing, and the write is
 * silently lost. Nothing errors; the effect just never happens.
 *
 * So every single-family write goes through a read-modify-write of the WHOLE
 * object, which is what the dynamics phase already does for the same reason.
 *
 * VALUE vs RESIDUAL — the caller's choice, and it is a real modelling decision:
 *
 *   "value"    a TRANSIENT SHOCK. The dynamics phase drifts the value back
 *              toward its law-implied target every turn, so the hit fades —
 *              exactly what the legacy `$inc` + natural-decay pair did. Right
 *              for events: a sovereign default damages trust, and trust
 *              recovers.
 *
 *   "residual" a STRUCTURAL shift of the equilibrium itself, so the value
 *              drifts to a NEW resting point and stays there. Right for
 *              enacted law, whose effect should persist while it is in force.
 *              A value shift would be drifted straight back out and the law
 *              would flicker and vanish.
 */
import type { AnyBulkWriteOperation, Db, Filter } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";

const clampScore = (v: number) => Math.max(0, Math.min(100, v));

export interface BoardDeltaResult {
  regionsUpdated: number;
}

/**
 * Add `scoreDelta` to one family across every region matching `filter`.
 *
 * Values clamp to 0-100. Residuals do NOT: a residual is a signed gap, and
 * clamping it would quietly cap how far a structural effect can push. The
 * composed target is clamped by `composeTarget` at read time instead.
 */
export async function applyBoardDelta(
  db: Db,
  filter: Filter<PoliticalMetricsDoc>,
  familyId: string,
  scoreDelta: number,
  mode: "value" | "residual"
): Promise<BoardDeltaResult> {
  if (!Number.isFinite(scoreDelta) || scoreDelta === 0) return { regionsUpdated: 0 };

  const docs = await db.collection<PoliticalMetricsDoc>("politicalMetrics").find(filter).toArray();
  if (docs.length === 0) return { regionsUpdated: 0 };

  const id = familyId as PoliticalMetricId;
  const now = new Date();
  const ops: AnyBulkWriteOperation<PoliticalMetricsDoc>[] = [];

  for (const doc of docs) {
    if (mode === "value") {
      const current = doc.values?.[id];
      if (typeof current !== "number" || !Number.isFinite(current)) continue;
      const next = clampScore(current + scoreDelta);
      if (next === current) continue;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { values: { ...doc.values, [id]: next }, lastUpdated: now } },
        },
      });
    } else {
      // A doc with no residuals yet is left alone: the dynamics phase heals it
      // to `value - lawTarget` on its next touch, and pre-empting that here
      // would bake this delta into what is supposed to be the RESET-time
      // structural gap.
      if (!doc.residuals) continue;
      const current = doc.residuals[id];
      const base = typeof current === "number" && Number.isFinite(current) ? current : 0;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: { residuals: { ...doc.residuals, [id]: base + scoreDelta }, lastUpdated: now },
          },
        },
      });
    }
  }

  if (ops.length === 0) return { regionsUpdated: 0 };
  await db.collection<PoliticalMetricsDoc>("politicalMetrics").bulkWrite(ops);
  return { regionsUpdated: ops.length };
}
