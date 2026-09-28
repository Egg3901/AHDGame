import type { CountryId } from "@/lib/constants/countries";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";

export type MonetaryCoverageExclusionReason =
  "absent-in-era" | "fiscal-model-unauthored" | "shared-currency-bank";

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
  // The 2027 Bulgarian fiscal row is EUR. Its exchange-rate row remains
  // country-addressable, while DE's existing EUR bank represents the shared
  // policy rate. Creating a second BG bank would double-count the ECB.
  if (preset === "2027-default") {
    exclusions.push({
      countryId: "BG",
      reason: "shared-currency-bank",
      detail: "BG uses EUR and the existing DE-anchored ECB in 2027",
    });
  }
  const excluded = new Set(exclusions.map(({ countryId }) => countryId));
  const forexCountries =
    preset === "2027-default"
      ? [...FOREX_ACTIVE_COUNTRIES, "BG" as CountryId]
      : FOREX_ACTIVE_COUNTRIES;
  const centralBankCountries = forexCountries.filter((countryId) => !excluded.has(countryId));

  return {
    forexCountries,
    centralBankCountries,
    exclusions,
  };
}
