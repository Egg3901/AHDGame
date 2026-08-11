import type { Db } from "mongodb";
import { logWarning } from "@/lib/utils/errorLog";
import { stateMetrics } from "@/lib/seeds/reference/stateMetrics";
import { stateMetrics1979 } from "@/lib/seeds/reference/stateMetrics1979";
import { stateMetrics1991 } from "@/lib/seeds/reference/stateMetrics1991";
import { stateMetrics1999 } from "@/lib/seeds/reference/stateMetrics1999";
import { stateMetrics2007 } from "@/lib/seeds/reference/stateMetrics2007";
import { stateMetrics2023 } from "@/lib/seeds/reference/stateMetrics2023";
import { stateMetrics1953 } from "@/lib/seeds/reference/stateMetrics1953";
import { selectPresetBundle } from "@/lib/seeds/presetSelector";
import { writeSplitMetrics } from "@/lib/macroMetrics/split";

/**
 * Seed every region's METRICS for a preset.
 *
 * Renamed from `seedStateMetrics`: it has not written the `stateMetrics`
 * collection since that store was retired. It reads the legacy-SHAPED seed
 * arrays (still named `stateMetrics*` below, because that is what they are —
 * authored docs in the legacy shape) and hands each to `writeSplitMetrics`,
 * which extracts the macro half to `macroMetrics`. The political half comes
 * from the politicalMetrics board, seeded separately by seedPoliticalMetrics.
 *
 * The admin seed TARGET was renamed to `regionMetrics` at the same time, with
 * `stateMetrics` kept as a parse-time alias so a saved selection still works.
 */
export async function seedRegionMetrics(
  db: Db,
  reset: boolean,
  log: (msg: string) => void,
  preset: string
) {
  if (reset) {
    // Only macroMetrics: nothing writes stateMetrics since step-6 Phase 3, and
    // clearing the leftover legacy collection belongs to the migration.
    for (const collection of ["macroMetrics"]) {
      await db
        .collection(collection)
        .drop()
        .catch((error) => {
          logWarning("Collection drop failed (may not exist)", {
            component: "AdminSeed",
            action: "drop collection",
            metadata: { collection, error: String(error) },
          });
        });
    }
  }
  const bundle = selectPresetBundle(
    preset,
    {
      "1953-default": stateMetrics1953,
      "2019-default": stateMetrics,
      "1979-default": stateMetrics1979,
      "1991-default": stateMetrics1991,
      "1999-default": stateMetrics1999,
      "2007-default": stateMetrics2007,
      "2023-default": stateMetrics2023,
    },
    "seedRegionMetrics:stateMetrics1953"
  );
  const { getRegionMetricPresets, applyMetricPresetToMetrics } =
    await import("@/lib/seeds/metricPresets");
  for (const raw of bundle) {
    // Overlay the per-region/era authored values for the new ROOT metrics (both eras authored).
    const overlay = getRegionMetricPresets("US", String(raw._id), preset);
    const metrics = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
    // SP5: split write — the US is playable, so the splitter emits ONLY the
    // macroMetrics doc (subsumes SP4's strip at seed time).
    await writeSplitMetrics(db, { ...metrics, countryId: metrics.countryId ?? "US" });
  }
  log(`Seeded ${bundle.length} state metrics (${preset})`);
}
