import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { type MetricPresetBundle } from "@/lib/seeds/ie/ieMetricPresets";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { RU_GEOGRAPHY } from "@/lib/countries/ru/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";
import { FR_GEOGRAPHY } from "@/lib/countries/fr/geography";
import { IT_GEOGRAPHY } from "@/lib/countries/it/geography";
import { ES_GEOGRAPHY } from "@/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "@/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { GR_GEOGRAPHY } from "@/lib/countries/gr/geography";
import { AT_GEOGRAPHY } from "@/lib/countries/at/geography";
import { FI_GEOGRAPHY } from "@/lib/countries/fi/geography";

export type { MetricPresetBundle };
type PresetBundles = Partial<Record<ResetPresetId, MetricPresetBundle>>;

/**
 * Country → preset → { regionId → { metricPath → value } } overlays for the new ROOT
 * metrics. Mirrors POPULATION_ANCHOR_BUNDLES (populationAnchors.ts); `selectPresetBundle`
 * falls back to `2019-default`, so a country with only a 2019 bundle never throws for a
 * 1991 world. Countries register here as their presets are authored.
 */
export const METRIC_PRESET_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  IE: IE_GEOGRAPHY.metricPresets,
  DE: DE_GEOGRAPHY.metricPresets,
  JP: JP_GEOGRAPHY.metricPresets,
  BR: BR_GEOGRAPHY.metricPresets,
  CN: CN_GEOGRAPHY.metricPresets,
  NG: NG_GEOGRAPHY.metricPresets,
  IT: IT_GEOGRAPHY.metricPresets,
  UK: UK_GEOGRAPHY.metricPresets,
  US: US_GEOGRAPHY.metricPresets,
  // RU (USSR) only exists in the 1953/1979 presets; its base metric bundle is
  // authored as ~1979 values, so only 1953 needs an overlay. No 2019 bundle →
  // `selectPresetBundleOptional` returns undefined (no overlay) for other eras.
  RU: RU_GEOGRAPHY.metricPresets,
  // FR/ES/SE/TR base metric bundles are authored on ~1979 values; without a
  // 1953 overlay `getRegionMetricPresets` returns null and seeders keep modern
  // life expectancy / literacy / urbanization. Same gap class as RU above.
  FR: FR_GEOGRAPHY.metricPresets,
  ES: ES_GEOGRAPHY.metricPresets,
  SE: SE_GEOGRAPHY.metricPresets,
  TR: TR_GEOGRAPHY.metricPresets,
  // AT/FI/GR base metric bundles are authored on ~1979 values; without a 1953
  // overlay `getRegionMetricPresets` returns null and seeders keep modern life
  // expectancy / literacy / urbanization. Same gap class as FR/ES/SE/TR above.
  AT: AT_GEOGRAPHY.metricPresets,
  FI: FI_GEOGRAPHY.metricPresets,
  GR: GR_GEOGRAPHY.metricPresets,
};

/**
 * Per-region metric-value overlay for a reset preset. Falls back to the 2019 bundle when
 * a preset is absent; null when the country has no bundle or the region has no entry.
 * Applied by the per-country seeder AFTER `applyEra1991Adjustments`.
 */
export function getRegionMetricPresets(
  countryId: CountryId,
  regionId: string,
  preset: string | undefined
): Record<string, number> | null {
  const byPreset = METRIC_PRESET_BUNDLES[countryId];
  if (!byPreset) return null;
  const bundle = selectPresetBundleOptional(preset ?? DEFAULT_SEED_PRESET, byPreset);
  return bundle?.[regionId] ?? null;
}

/**
 * Overlay an authored preset (metricPath → value) onto a `StateMetrics` doc, writing
 * each value into its `{ value }` wrapper (preserving any existing `trend`). Returns a
 * clone; the original is untouched. No-op for 2019 (presets derive from the seed).
 */
export function applyMetricPresetToMetrics(
  metrics: StateMetrics,
  overlay: Record<string, number>
): StateMetrics {
  const next = structuredClone(metrics);
  for (const [path, value] of Object.entries(overlay)) {
    const [cat, id] = path.split(".");
    const category = (next as unknown as Record<string, Record<string, { value: number }>>)[cat];
    if (category) category[id] = { ...(category[id] ?? {}), value };
  }
  return next;
}

/**
 * Overlay an authored preset onto a `StateMetricBaseline` doc (raw numbers, not `{ value }`),
 * so a 1991 world's decay targets match its authored metric values — otherwise the seeded
 * 1991 metrics would decay back toward the 2019-shaped baseline. No-op for 2019.
 */
export function applyMetricPresetToBaseline(
  baseline: StateMetricBaseline,
  overlay: Record<string, number>
): StateMetricBaseline {
  const next = structuredClone(baseline);
  const b = next.baselines as unknown as Record<string, Record<string, number>>;
  for (const [path, value] of Object.entries(overlay)) {
    const [cat, id] = path.split(".");
    b[cat] = { ...(b[cat] ?? {}) };
    b[cat][id] = value;
  }
  return next;
}
