import { metricCategories } from "../../src/lib/constants/metricDefinitions";
import { buildCanonicalMetricInventory } from "../../src/lib/governmentFinance/metricInventory";
import { isMacroMetricPath } from "../../src/lib/macroMetrics/paths";
import { POLITICAL_METRIC_FAMILIES } from "../../src/lib/politicalMetrics/families";
import { legislationTypes } from "../../src/lib/seeds/reference/legislationTypes";

export function runMetricInventory() {
  const inventory = buildCanonicalMetricInventory({
    legacyCategories: metricCategories,
    politicalFamilies: POLITICAL_METRIC_FAMILIES,
    legislationTypes,
    isMacroPath: isMacroMetricPath,
  });
  return {
    entryCount: inventory.entries.length,
    byOwner: Object.fromEntries(
      ["macroMetrics", "stateMetrics_compat", "politicalMetrics"].map((owner) => [
        owner,
        inventory.entries.filter((entry) => entry.storageOwner === owner).length,
      ])
    ),
    legislationTargetCount: inventory.entries.filter((entry) => entry.legislationSources.length > 0)
      .length,
    unknownLegislationTargets: inventory.unknownLegislationTargets,
    sameSlugGroups: inventory.sameSlugGroups,
  };
}

if (process.argv[1]?.endsWith("metricInventory2026-09-21.ts")) {
  console.log(JSON.stringify(runMetricInventory(), null, 2));
}
