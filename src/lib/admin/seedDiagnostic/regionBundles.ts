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
import { deRegions } from "@/lib/seeds/de/deRegions";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { deRegions1979 } from "@/lib/seeds/de/deRegions1979";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { deRegions1999 } from "@/lib/seeds/de/deRegions1999";
import { deRegions2007 } from "@/lib/seeds/de/deRegions2007";
import { deRegions2023 } from "@/lib/seeds/de/deRegions2023";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { brRegions1979 } from "@/lib/seeds/br/brRegions1979";
import { brRegions1991 } from "@/lib/seeds/br/brRegions1991";
import { brRegions1999 } from "@/lib/seeds/br/brRegions1999";
import { brRegions2007 } from "@/lib/seeds/br/brRegions2007";
import { brRegions2023 } from "@/lib/seeds/br/brRegions2023";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { ukRegions1979 } from "@/lib/seeds/uk/ukRegions1979";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { ukRegions1999 } from "@/lib/seeds/uk/ukRegions1999";
import { ukRegions2007 } from "@/lib/seeds/uk/ukRegions2007";
import { ukRegions2023 } from "@/lib/seeds/uk/ukRegions2023";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { cnRegions1979 } from "@/lib/seeds/cn/cnRegions1979";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { cnRegions1999 } from "@/lib/seeds/cn/cnRegions1999";
import { cnRegions2007 } from "@/lib/seeds/cn/cnRegions2007";
import { cnRegions2023 } from "@/lib/seeds/cn/cnRegions2023";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { ieRegions1979 } from "@/lib/seeds/ie/ieRegions1979";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
import { ieRegions1999 } from "@/lib/seeds/ie/ieRegions1999";
import { ieRegions2007 } from "@/lib/seeds/ie/ieRegions2007";
import { ieRegions2023 } from "@/lib/seeds/ie/ieRegions2023";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { ngRegions1979 } from "@/lib/seeds/ng/ngRegions1979";
import { ngRegions1991 } from "@/lib/seeds/ng/ngRegions1991";
import { ngRegions1999 } from "@/lib/seeds/ng/ngRegions1999";
import { ngRegions2007 } from "@/lib/seeds/ng/ngRegions2007";
import { ngRegions2023 } from "@/lib/seeds/ng/ngRegions2023";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";

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
  const maps = FULL_ERA_REGION_BUNDLES[countryId];
  if (!maps) return null;
  const resolvedPreset =
    preset === "empty" || preset === "2019-no-parties" ? "2019-default" : preset;
  return maps[resolvedPreset as ResetPresetId] ?? maps["2019-default"] ?? null;
}

export function expectedRegionCount(countryId: CountryId, preset: string): number | null {
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
