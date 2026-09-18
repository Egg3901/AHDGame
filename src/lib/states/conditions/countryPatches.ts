import type { CountryId } from "@/lib/constants/countries";
import type { Condition } from "@/lib/utils/approvalModifiers";

import { UK_GEOGRAPHY } from "@/lib/countries/uk/geography";
import { JP_GEOGRAPHY } from "@/lib/countries/jp/geography";
import { DE_GEOGRAPHY } from "@/lib/countries/de/geography";
import { IE_GEOGRAPHY } from "@/lib/countries/ie/geography";
import { BR_GEOGRAPHY } from "@/lib/countries/br/geography";
import { CN_GEOGRAPHY } from "@/lib/countries/cn/geography";
import { NG_GEOGRAPHY } from "@/lib/countries/ng/geography";

export interface CountryModifierPatch {
  suppress?: boolean;
  conditions?: Condition[];
  marginFactor?: number;
}

type CountryPatchMap = Partial<Record<CountryId, Record<string, CountryModifierPatch>>>;

/**
 * Per-country threshold overrides and suppressions. Applied after global (and
 * era1991) defs. Suppress modifiers whose seed inputs are nationally flat —
 * they cannot differentiate regions in that country.
 */
export const COUNTRY_MODIFIER_PATCHES: CountryPatchMap = {
  UK: UK_GEOGRAPHY.modifierPatches,
  JP: JP_GEOGRAPHY.modifierPatches,
  DE: DE_GEOGRAPHY.modifierPatches,
  IE: IE_GEOGRAPHY.modifierPatches,
  BR: BR_GEOGRAPHY.modifierPatches,
  CN: CN_GEOGRAPHY.modifierPatches,
  NG: NG_GEOGRAPHY.modifierPatches,
};
