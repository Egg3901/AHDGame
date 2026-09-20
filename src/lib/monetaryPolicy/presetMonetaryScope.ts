import type { CountryId } from "@/lib/constants/countries";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";

export type MonetaryCoverageExclusionReason = "absent-in-era" | "fiscal-model-unauthored";

export interface MonetaryCoverageExclusion {
  countryId: CountryId;
  reason: MonetaryCoverageExclusionReason;
  detail: string;
}

export interface PresetMonetaryScope {
  /** Currencies remain tradable even when their issuing country's fiscal model is unavailable. */
  forexCountries: readonly CountryId[];
  /** Countries with both an active currency and an authored national fiscal model. */
  centralBankCountries: CountryId[];
  /** Active currencies deliberately kept out of central-bank/fiscal processing. */
  exclusions: MonetaryCoverageExclusion[];
}

const COLD_WAR_FISCAL_PRESETS = new Set(["1953-default", "1979-default"]);

const POST_COLD_WAR_EXCLUSIONS: readonly MonetaryCoverageExclusion[] = [
  {
    countryId: "RU",
    reason: "fiscal-model-unauthored",
    detail: "RU has currency support but no authored post-Soviet national fiscal model",
  },
  {
    countryId: "DD",
    reason: "absent-in-era",
    detail: "DD is absent after German reunification",
  },
];

/**
 * Resolve the explicit monetary coverage contract instead of assuming that
 * every tradable currency represents a fully modelled sovereign economy. The
 * preset-matrix test cross-checks this lightweight runtime manifest against the
 * authored national-budget configs.
 */
export function getPresetMonetaryScope(preset: string): PresetMonetaryScope {
  const exclusions = COLD_WAR_FISCAL_PRESETS.has(preset) ? [] : [...POST_COLD_WAR_EXCLUSIONS];
  const excluded = new Set(exclusions.map(({ countryId }) => countryId));
  const centralBankCountries = FOREX_ACTIVE_COUNTRIES.filter(
    (countryId) => !excluded.has(countryId)
  );

  return {
    forexCountries: FOREX_ACTIVE_COUNTRIES,
    centralBankCountries,
    exclusions,
  };
}
