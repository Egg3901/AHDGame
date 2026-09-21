import { describe, expect, it } from "vitest";
import { metricCategories } from "@/lib/constants/metricDefinitions";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { buildCanonicalMetricInventory } from "./metricInventory";

describe("canonical metric inventory", () => {
  it("records each storage path once and preserves unresolved overlap as audit data", () => {
    const inventory = buildCanonicalMetricInventory({
      legacyCategories: metricCategories,
      politicalFamilies: POLITICAL_METRIC_FAMILIES,
      legislationTypes,
      isMacroPath: isMacroMetricPath,
    });
    const ids = inventory.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(inventory.entries.some((entry) => entry.storageOwner === "macroMetrics")).toBe(true);
    expect(
      inventory.entries.filter((entry) => entry.storageOwner === "politicalMetrics")
    ).toHaveLength(63);
    expect(Array.isArray(inventory.sameSlugGroups)).toBe(true);
  });
});
