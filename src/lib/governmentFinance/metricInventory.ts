import type { MetricCategory } from "@/lib/constants/metricDefinitions";
import type { LegislationType } from "@/lib/db/types/legislation";
import type { PoliticalMetricFamily } from "@/lib/politicalMetrics/types";

export type MetricStorageOwner = "macroMetrics" | "stateMetrics_compat" | "politicalMetrics";

export interface MetricInventoryEntry {
  id: string;
  displayName: string;
  storageOwner: MetricStorageOwner;
  unit: string;
  minValue?: number;
  maxValue?: number;
  higherIsBetter?: boolean;
  legislationSources: string[];
}

export interface CanonicalMetricInventory {
  entries: MetricInventoryEntry[];
  unknownLegislationTargets: string[];
  sameSlugGroups: Array<{ slug: string; ids: string[] }>;
}

function lawTargets(type: LegislationType): string[] {
  const targets = [
    ...(type.effectTarget ? [type.effectTarget] : []),
    ...(type.effectTargets ?? []),
    ...(type.effectTargetsWeighted ?? []),
  ];
  return [...new Set(targets.map((target) => `${target.metricCategoryId}.${target.metricId}`))];
}

function slug(id: string): string {
  return id
    .split(".")
    .at(-1)!
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/**
 * Machine-readable inventory only. It records ownership and consumers without
 * deciding whether similar concepts are aliases, derivations, or distinct.
 */
export function buildCanonicalMetricInventory(input: {
  legacyCategories: readonly MetricCategory[];
  politicalFamilies: readonly PoliticalMetricFamily[];
  legislationTypes: readonly LegislationType[];
  isMacroPath: (path: string) => boolean;
}): CanonicalMetricInventory {
  const legislationSources = new Map<string, Set<string>>();
  for (const type of input.legislationTypes) {
    for (const target of lawTargets(type)) {
      const sources = legislationSources.get(target) ?? new Set<string>();
      sources.add(type._id);
      legislationSources.set(target, sources);
    }
  }

  const entries: MetricInventoryEntry[] = [];
  for (const category of input.legacyCategories) {
    for (const metric of category.metrics) {
      const id = `${category.id}.${metric.id}`;
      entries.push({
        id,
        displayName: metric.name,
        storageOwner: input.isMacroPath(id) ? "macroMetrics" : "stateMetrics_compat",
        unit: metric.unit,
        ...(metric.minValue !== undefined ? { minValue: metric.minValue } : {}),
        ...(metric.maxValue !== undefined ? { maxValue: metric.maxValue } : {}),
        higherIsBetter: metric.isHigherBetter,
        legislationSources: [...(legislationSources.get(id) ?? [])].sort(),
      });
    }
  }
  for (const family of input.politicalFamilies) {
    entries.push({
      id: family.id,
      displayName: family.slug,
      storageOwner: "politicalMetrics",
      unit: "index",
      minValue: 0,
      maxValue: 100,
      higherIsBetter: family.higherIsBetter,
      legislationSources: [...(legislationSources.get(family.id) ?? [])].sort(),
    });
  }

  const known = new Set(entries.map((entry) => entry.id));
  const unknownLegislationTargets = [...legislationSources.keys()]
    .filter((target) => !known.has(target))
    .sort();
  const bySlug = new Map<string, string[]>();
  for (const entry of entries) {
    const key = slug(entry.id);
    const ids = bySlug.get(key) ?? [];
    ids.push(entry.id);
    bySlug.set(key, ids);
  }
  const sameSlugGroups = [...bySlug.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ slug: name, ids: ids.sort() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return {
    entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
    unknownLegislationTargets,
    sameSlugGroups,
  };
}
