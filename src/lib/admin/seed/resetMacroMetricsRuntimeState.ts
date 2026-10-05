import type { Db } from "mongodb";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { MACRO_CATEGORIES } from "@/lib/macroMetrics/paths";
import { METRIC_REGISTRY_SORTED } from "@/lib/metricEngine/registry";

const TOP_LEVEL_RUNTIME_FIELDS = [
  "economicModel",
  "governance",
  "independenceDesire",
  "livingConflictExposure",
  "resetCohortReading",
  // Legacy macro rows may carry these at the document root. Current outputGap
  // is owned by `states`, but clearing the old copy is safe during a full reset.
  "simBaseline",
  "trend",
  "outputGap",
] as const;

/** All macro metric values are reseeded after these old-world engine channels are removed. */
export const MACRO_RUNTIME_UNSET_FIELDS = [
  ...TOP_LEVEL_RUNTIME_FIELDS,
  ...new Set(
    METRIC_REGISTRY_SORTED.filter((node) => MACRO_CATEGORIES.has(node.categoryId)).flatMap(
      ({ id }) => [`${id}.simBaseline`, `${id}.trend`]
    )
  ),
] as const;

export interface ResetMacroMetricsRuntimeStateResult {
  documentsModified: number;
  nationalRollupsDeleted: number;
}

/**
 * Remove world-scoped macro engine state before reference rows are upserted.
 *
 * `writeSplitMetricsBulk` uses `$set` and conditionally omits optional fields,
 * so a reset must clear values from the outgoing world before seeders restore
 * only the fields authored by the incoming preset. National rollups are derived
 * per turn, not seed baselines, and are discarded outright.
 */
export async function resetMacroMetricsRuntimeState(
  db: Db
): Promise<ResetMacroMetricsRuntimeStateResult> {
  const collection = db.collection<MacroMetricsDoc>("macroMetrics");
  const reset = await collection.updateMany(
    {},
    { $unset: Object.fromEntries(MACRO_RUNTIME_UNSET_FIELDS.map((field) => [field, ""])) }
  );
  const national = await collection.deleteMany({ _id: { $in: [...NATIONAL_SCOPE_IDS] } });
  return {
    documentsModified: reset.modifiedCount ?? 0,
    nationalRollupsDeleted: national.deletedCount ?? 0,
  };
}
