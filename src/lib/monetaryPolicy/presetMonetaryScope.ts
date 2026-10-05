/**
 * Monetary coverage determines which countries have tradable currencies and banks.
 * getPresetMonetaryScope follows the scenario's fiscal books and excludes absent
 * countries or duplicate shared-currency banks.
 */
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
  /** Tradable currencies for this preset; 1991 excludes issuers absent in that era. */
  forexCountries: readonly CountryId[];
  /** Countries with both an active currency and an authored national fiscal model. */
  centralBankCountries: CountryId[];
  /** Country monetary models deliberately excluded from the current preset. */
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
  // The five 2019 transition fiscal books now exist, including RU. Their
  // modern currencies each need a seeded FX row and central bank.
  const exclusions = COLD_WAR_FISCAL_PRESETS.has(preset)
    ? []
    : POST_COLD_WAR_EXCLUSIONS.filter(
        (entry) => !["1991-default", "2019-default"].includes(preset) || entry.countryId !== "RU"
      );
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
  const candidateForexCountries =
    preset === "1991-default"
      ? ([...FOREX_ACTIVE_COUNTRIES, "PL", "HU", "RO", "BG", "CS", "YU"] as CountryId[])
      : preset === "2019-default"
        ? ([...FOREX_ACTIVE_COUNTRIES, "PL", "HU", "RO", "BG"] as CountryId[])
        : preset === "2027-default"
          ? [...FOREX_ACTIVE_COUNTRIES, "BG" as CountryId]
          : FOREX_ACTIVE_COUNTRIES;
  const absentInEra = new Set(
    exclusions.filter((entry) => entry.reason === "absent-in-era").map((entry) => entry.countryId)
  );
  const forexCountries =
    preset === "1991-default"
      ? candidateForexCountries.filter((countryId) => !absentInEra.has(countryId))
      : candidateForexCountries;
  const centralBankCountries = forexCountries.filter((countryId) => !excluded.has(countryId));

  return {
    forexCountries,
    centralBankCountries,
    exclusions,
  };
}
