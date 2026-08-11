import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_LEGACY_COUNTRY_ID } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { stateMetrics } from "@/lib/seeds/reference/stateMetrics";
import { applyEra1991Adjustments } from "@/lib/seeds/reference/stateMetrics1991";
import { stateMetrics1991 } from "@/lib/seeds/reference/stateMetrics1991";
import { brStateMetrics } from "@/lib/seeds/br/brStateMetrics";
import { cnStateMetrics } from "@/lib/seeds/cn/cnStateMetrics";
import { deStateMetrics } from "@/lib/seeds/de/deStateMetrics";
import { ieStateMetrics } from "@/lib/seeds/ie/ieStateMetrics";
import { jpStateMetrics } from "@/lib/seeds/jp/jpStateMetrics";
import { ngStateMetrics } from "@/lib/seeds/ng/ngStateMetrics";
import { ukStateMetrics } from "@/lib/seeds/uk/ukStateMetrics";

// Seceded nations (SCO/WAL) have no static seed bundle — their metrics are
// fanned out from the UK aggregate at secession — so this is a partial map.
const RAW_BUNDLES: Partial<Record<CountryId, StateMetrics[]>> = {
  US: stateMetrics,
  UK: ukStateMetrics,
  DE: deStateMetrics,
  JP: jpStateMetrics,
  IE: ieStateMetrics,
  BR: brStateMetrics,
  CN: cnStateMetrics,
  NG: ngStateMetrics,
  HU: [], // coming-soon: no state metrics seeded yet
  PL: [],
  RO: [],
  YU: [],
  BG: [],
  BLR: [],
  CS: [],
  BAL: [],
  RU: [],
  FR: [],
  IT: [],
  ES: [],
  SE: [],
  TR: [],
  DD: [],
};

/**
 * Load region metrics as they exist after seeding (era adjustments + preset overlay).
 * Mirrors per-country seedRegionMetrics paths for audits and tests.
 */
export function loadSeededStateMetrics(countryId: CountryId, preset: string): StateMetrics[] {
  const is1991 = preset === "1991-default";
  let bundle: StateMetrics[];

  if (countryId === DEFAULT_LEGACY_COUNTRY_ID) {
    bundle = is1991 ? stateMetrics1991 : stateMetrics;
  } else {
    const raw = RAW_BUNDLES[countryId] ?? [];
    bundle = is1991 ? raw.map((m) => applyEra1991Adjustments(m)) : raw;
  }

  return bundle.map((raw) => {
    const regionId = String(raw._id);
    const overlay = getRegionMetricPresets(countryId, regionId, preset);
    const metrics = overlay ? applyMetricPresetToMetrics(raw, overlay) : raw;
    return { ...metrics, countryId };
  });
}
