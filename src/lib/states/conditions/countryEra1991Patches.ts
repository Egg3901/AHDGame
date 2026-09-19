import type { CountryId } from "@/lib/constants/countries";
import type { Condition } from "@/lib/utils/approvalModifiers";
import type { CountryModifierPatch } from "@/lib/states/conditions/countryPatches";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { US_GEOGRAPHY } from "@/lib/countries/us/geography";
import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";

/**
 * Additional per-country overrides applied only in 1991-default worlds, after
 * global ERA1991 patches and country modern patches.
 */
export const COUNTRY_ERA1991_PATCHES: Partial<
  Record<CountryId, Record<string, CountryModifierPatch>>
> = {
  UK: UK_GEOGRAPHY.era1991Patches,

  JP: JP_GEOGRAPHY.era1991Patches,

  DE: DE_GEOGRAPHY.era1991Patches,

  IE: IE_GEOGRAPHY.era1991Patches,

  BR: BR_GEOGRAPHY.era1991Patches,

  CN: CN_GEOGRAPHY.era1991Patches,

  US: US_GEOGRAPHY.era1991Patches,
};
