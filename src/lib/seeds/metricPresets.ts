import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import { selectPresetBundleOptional } from "@/lib/seeds/presetSelector";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import {
  ieMetricPresets2019,
  ieMetricPresets1991,
  type MetricPresetBundle,
} from "@/lib/seeds/ie/ieMetricPresets";
import { deMetricPresets2019, deMetricPresets1991 } from "@/lib/seeds/de/deMetricPresets";
import { jpMetricPresets2019, jpMetricPresets1991 } from "@/lib/seeds/jp/jpMetricPresets";
import { brMetricPresets2019, brMetricPresets1991 } from "@/lib/seeds/br/brMetricPresets";
import { cnMetricPresets2019, cnMetricPresets1991 } from "@/lib/seeds/cn/cnMetricPresets";
import { ngMetricPresets2019, ngMetricPresets1991 } from "@/lib/seeds/ng/ngMetricPresets";
import { ukMetricPresets2019, ukMetricPresets1991 } from "@/lib/seeds/uk/ukMetricPresets";
import { usMetricPresets2019, usMetricPresets1991 } from "@/lib/seeds/reference/usMetricPresets";
import { ieMetricPresets1953 } from "@/lib/seeds/ie/ieMetricPresets1953";
import { deMetricPresets1953 } from "@/lib/seeds/de/deMetricPresets1953";
import { jpMetricPresets1953 } from "@/lib/seeds/jp/jpMetricPresets1953";
import { brMetricPresets1953 } from "@/lib/seeds/br/brMetricPresets1953";
import { cnMetricPresets1953 } from "@/lib/seeds/cn/cnMetricPresets1953";
import { ngMetricPresets1953 } from "@/lib/seeds/ng/ngMetricPresets1953";
import { ukMetricPresets1953 } from "@/lib/seeds/uk/ukMetricPresets1953";
import { usMetricPresets1953 } from "@/lib/seeds/reference/usMetricPresets1953";
import { ruMetricPresets1953 } from "@/lib/seeds/ru/ruMetricPresets1953";
import { ukMetricPresets1979 } from "@/lib/seeds/uk/ukMetricPresets1979";
import { deMetricPresets1979 } from "@/lib/seeds/de/deMetricPresets1979";
import { jpMetricPresets1979 } from "@/lib/seeds/jp/jpMetricPresets1979";
import { brMetricPresets1979 } from "@/lib/seeds/br/brMetricPresets1979";
import { cnMetricPresets1979 } from "@/lib/seeds/cn/cnMetricPresets1979";
import { itMetricPresets1953 } from "@/lib/seeds/it/itMetricPresets1953";
import { frMetricPresets1953 } from "@/lib/seeds/fr/frMetricPresets1953";
import { esMetricPresets1953 } from "@/lib/seeds/es/esMetricPresets1953";
import { seMetricPresets1953 } from "@/lib/seeds/se/seMetricPresets1953";
import { trMetricPresets1953 } from "@/lib/seeds/tr/trMetricPresets1953";
import { atMetricPresets1953 } from "@/lib/seeds/at/atMetricPresets1953";
import { fiMetricPresets1953 } from "@/lib/seeds/fi/fiMetricPresets1953";
import { grMetricPresets1953 } from "@/lib/seeds/gr/grMetricPresets1953";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export type { MetricPresetBundle };
type PresetBundles = Partial<Record<ResetPresetId, MetricPresetBundle>>;

/**
 * Country → preset → { regionId → { metricPath → value } } overlays for the new ROOT
 * metrics. Mirrors POPULATION_ANCHOR_BUNDLES (populationAnchors.ts); `selectPresetBundle`
 * falls back to `2019-default`, so a country with only a 2019 bundle never throws for a
 * 1991 world. DE/JP/BR/CN/UK/US register here as each country's presets are authored.
 */
const METRIC_PRESET_BUNDLES: Partial<Record<CountryId, PresetBundles>> = {
  IE: {
    "2019-default": ieMetricPresets2019,
    "1991-default": ieMetricPresets1991,
    "1953-default": ieMetricPresets1953,
  },
  DE: {
    "2019-default": deMetricPresets2019,
    "1991-default": deMetricPresets1991,
    "1979-default": deMetricPresets1979,
    "1953-default": deMetricPresets1953,
  },
  JP: {
    "2019-default": jpMetricPresets2019,
    "1991-default": jpMetricPresets1991,
    "1979-default": jpMetricPresets1979,
    "1953-default": jpMetricPresets1953,
  },
  BR: {
    "2019-default": brMetricPresets2019,
    "1991-default": brMetricPresets1991,
    "1979-default": brMetricPresets1979,
    "1953-default": brMetricPresets1953,
  },
  CN: {
    "2019-default": cnMetricPresets2019,
    "1991-default": cnMetricPresets1991,
    "1979-default": cnMetricPresets1979,
    "1953-default": cnMetricPresets1953,
  },
  NG: {
    "2019-default": ngMetricPresets2019,
    "1991-default": ngMetricPresets1991,
    "1953-default": ngMetricPresets1953,
  },
  IT: {
    "1953-default": itMetricPresets1953,
  },
  UK: {
    "2019-default": ukMetricPresets2019,
    "1991-default": ukMetricPresets1991,
    "1979-default": ukMetricPresets1979,
    "1953-default": ukMetricPresets1953,
  },
  US: {
    "2019-default": usMetricPresets2019,
    "1991-default": usMetricPresets1991,
    "1953-default": usMetricPresets1953,
  },
  // RU (USSR) only exists in the 1953/1979 presets; its base metric bundle is
  // authored as ~1979 values, so only 1953 needs an overlay. No 2019 bundle →
  // `selectPresetBundleOptional` returns undefined (no overlay) for other eras.
  RU: {
    "1953-default": ruMetricPresets1953,
  },
  // FR/ES/SE/TR base metric bundles are authored on ~1979 values; without a
  // 1953 overlay `getRegionMetricPresets` returns null and seeders keep modern
  // life expectancy / literacy / urbanization. Same gap class as RU above.
  FR: {
    "1953-default": frMetricPresets1953,
  },
  ES: {
    "1953-default": esMetricPresets1953,
  },
  SE: {
    "1953-default": seMetricPresets1953,
  },
  TR: {
    "1953-default": trMetricPresets1953,
  },
  // AT/FI/GR base metric bundles are authored on ~1979 values; without a 1953
  // overlay `getRegionMetricPresets` returns null and seeders keep modern life
  // expectancy / literacy / urbanization. Same gap class as FR/ES/SE/TR above.
  AT: {
    "1953-default": atMetricPresets1953,
  },
  FI: {
    "1953-default": fiMetricPresets1953,
  },
  GR: {
    "1953-default": grMetricPresets1953,
  },
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
