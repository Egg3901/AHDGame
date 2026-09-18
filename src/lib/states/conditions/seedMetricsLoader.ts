import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_LEGACY_COUNTRY_ID } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import { applyMetricPresetToMetrics, getRegionMetricPresets } from "@/lib/seeds/metricPresets";
import { stateMetrics } from "@/lib/seeds/reference/stateMetrics";
import { applyEra1991Adjustments } from "@/lib/seeds/reference/stateMetrics1991";
import { stateMetrics1991 } from "@/lib/seeds/reference/stateMetrics1991";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { RU_GEOGRAPHY } from "@/lib/countries/ru/geography";
import { DD_GEOGRAPHY } from "@/lib/countries/dd/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";
import { FR_GEOGRAPHY } from "@/lib/countries/fr/geography";
import { IT_GEOGRAPHY } from "@/lib/countries/it/geography";
import { ES_GEOGRAPHY } from "@/lib/countries/es/geography";
import { SE_GEOGRAPHY } from "@/lib/countries/se/geography";
import { TR_GEOGRAPHY } from "@/lib/countries/tr/geography";
import { PL_GEOGRAPHY } from "@/lib/countries/pl/geography";
import { HU_GEOGRAPHY } from "@/lib/countries/hu/geography";
import { RO_GEOGRAPHY } from "@/lib/countries/ro/geography";
import { YU_GEOGRAPHY } from "@/lib/countries/yu/geography";
import { BG_GEOGRAPHY } from "@/lib/countries/bg/geography";
import { CS_GEOGRAPHY } from "@/lib/countries/cs/geography";
import { BLR_GEOGRAPHY } from "@/lib/countries/blr/geography";
import { BAL_GEOGRAPHY } from "@/lib/countries/bal/geography";
import { GR_GEOGRAPHY } from "@/lib/countries/gr/geography";
import { AT_GEOGRAPHY } from "@/lib/countries/at/geography";
import { FI_GEOGRAPHY } from "@/lib/countries/fi/geography";

// Seceded nations (SCO/WAL) have no static seed bundle — their metrics are
// fanned out from the UK aggregate at secession — and UKR's regions are a
// deferred build, so this is a partial map.
export const RAW_BUNDLES: Partial<Record<CountryId, StateMetrics[]>> = {
  US: US_GEOGRAPHY.rawMetrics,
  UK: UK_GEOGRAPHY.rawMetrics,
  DE: DE_GEOGRAPHY.rawMetrics,
  JP: JP_GEOGRAPHY.rawMetrics,
  IE: IE_GEOGRAPHY.rawMetrics,
  BR: BR_GEOGRAPHY.rawMetrics,
  CN: CN_GEOGRAPHY.rawMetrics,
  NG: NG_GEOGRAPHY.rawMetrics,
  HU: HU_GEOGRAPHY.rawMetrics, // coming-soon: no state metrics seeded yet
  PL: PL_GEOGRAPHY.rawMetrics,
  RO: RO_GEOGRAPHY.rawMetrics,
  YU: YU_GEOGRAPHY.rawMetrics,
  BG: BG_GEOGRAPHY.rawMetrics,
  BLR: BLR_GEOGRAPHY.rawMetrics,
  CS: CS_GEOGRAPHY.rawMetrics,
  BAL: BAL_GEOGRAPHY.rawMetrics,
  RU: RU_GEOGRAPHY.rawMetrics,
  FR: FR_GEOGRAPHY.rawMetrics,
  IT: IT_GEOGRAPHY.rawMetrics,
  ES: ES_GEOGRAPHY.rawMetrics,
  SE: SE_GEOGRAPHY.rawMetrics,
  TR: TR_GEOGRAPHY.rawMetrics,
  DD: DD_GEOGRAPHY.rawMetrics,
  GR: GR_GEOGRAPHY.rawMetrics,
  AT: AT_GEOGRAPHY.rawMetrics,
  FI: FI_GEOGRAPHY.rawMetrics,
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
