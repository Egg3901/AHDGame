/**
 * Era-authored region bundles, and the count derived from them.
 *
 * Split out of `seedDiagnostic/expectations.ts` to break an import cycle. That
 * module also hosts `seededCountryIdsForPreset`, which needs the enablement
 * accessors in `seedCountryGameStates`, which in turn imports the readiness
 * contract — so a readiness module reaching in here for a region count closed
 * the loop:
 *
 *   countryReadinessContract -> readinessExpectations
 *     -> seedDiagnostic/expectations -> seedCountryGameStates
 *       -> countryReadinessContract
 *
 * Nothing here needs any of that. The map is pure data and the accessor is pure
 * arithmetic over it, so both sides can depend on this module without either
 * depending on the other.
 */
import type { CountryId } from "@/lib/constants/countries";
import { DEFAULT_LEGACY_COUNTRY_ID } from "@/lib/constants/countries";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import type { ResetPresetId } from "@/lib/seeds/presetSelector";
import { selectStatesBundleForPreset } from "@/lib/admin/seed/seedStates";
import type { State } from "@/lib/db/types";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";
import { YU_GEOGRAPHY } from "@/lib/countries/yu/geography";
import { BG_GEOGRAPHY } from "@/lib/countries/bg/geography";
import { RO_GEOGRAPHY } from "@/lib/countries/ro/geography";
import { HU_GEOGRAPHY } from "@/lib/countries/hu/geography";
import { CS_GEOGRAPHY } from "@/lib/countries/cs/geography";
import { PL_GEOGRAPHY } from "@/lib/countries/pl/geography";
import { RU_GEOGRAPHY } from "@/lib/countries/ru/geography";
import {
  MODERN_2019_NATIONALS,
  modernRegions2019,
  type Modern2019CountryId,
} from "@/lib/seeds/reference/modernRegions2019";

export const FULL_ERA_REGION_BUNDLES: Partial<
  Record<CountryId, Partial<Record<ResetPresetId, State[]>>>
> = {
  DE: DE_GEOGRAPHY.regionBundles,
  JP: JP_GEOGRAPHY.regionBundles,
  BR: BR_GEOGRAPHY.regionBundles,
  UK: UK_GEOGRAPHY.regionBundles,
  CN: CN_GEOGRAPHY.regionBundles,
  IE: IE_GEOGRAPHY.regionBundles,
  NG: NG_GEOGRAPHY.regionBundles,
  RU: RU_GEOGRAPHY.regionBundles,
  PL: PL_GEOGRAPHY.regionBundles,
  CS: CS_GEOGRAPHY.regionBundles,
  HU: HU_GEOGRAPHY.regionBundles,
  RO: RO_GEOGRAPHY.regionBundles,
  BG: BG_GEOGRAPHY.regionBundles,
  YU: YU_GEOGRAPHY.regionBundles,
};

/**
 * Era-authored region count for a country, or null when no dedicated region
 * bundle is registered (caller should use a presence/sanity check).
 */
/**
 * The era region bundle a country seeds for a preset, or null when it has none.
 *
 * Exposed so callers that need the region ROWS (S4 sums `houseDistricts`, the
 * third authority on chamber size) do not have to re-import all seven era
 * modules and re-derive the preset mapping.
 */
export function regionBundleFor(countryId: CountryId, preset: string): State[] | null {
  if (preset === "2019-default" && countryId in MODERN_2019_NATIONALS)
    return modernRegions2019(countryId as Modern2019CountryId);
  const maps = FULL_ERA_REGION_BUNDLES[countryId];
  if (!maps) return null;
  const resolvedPreset =
    preset === "empty" || preset === "2019-no-parties" ? "2019-default" : preset;
  return maps[resolvedPreset as ResetPresetId] ?? maps["2019-default"] ?? null;
}

export function expectedRegionCount(countryId: CountryId, preset: string): number | null {
  if (preset === "2019-default" && countryId in MODERN_2019_NATIONALS)
    return modernRegions2019(countryId as Modern2019CountryId).length;
  if (countryId === DEFAULT_LEGACY_COUNTRY_ID) {
    const bundle = selectStatesBundleForPreset(preset);
    return bundle.filter(
      (s) => s.countryId === DEFAULT_LEGACY_COUNTRY_ID && !NATIONAL_SCOPE_IDS.has(String(s._id))
    ).length;
  }
  const maps = FULL_ERA_REGION_BUNDLES[countryId];
  if (!maps) return null;
  const resolvedPreset =
    preset === "empty" || preset === "2019-no-parties" ? "2019-default" : preset;
  const bundle = maps[resolvedPreset as ResetPresetId] ?? maps["2019-default"];
  if (!bundle) return null;
  return bundle.filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id))).length;
}
