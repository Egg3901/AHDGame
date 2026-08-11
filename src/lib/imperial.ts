import { COUNTRY_CONFIGS, isImperialCountry, type CountryId } from "./constants/countries";
import type { Db } from "mongodb";

export interface ImperialConfig {
  titles: { male: string; female: string; nonbinary: string };
  corporation: { name: string; sector: string };
  /** If this country shares another's imperial character, the source country */
  sharedWith?: CountryId;
}

/**
 * Get the gender-aware imperial title for a country.
 * Returns null if the country has no imperial role.
 */
export function getImperialTitle(
  countryId: CountryId,
  gender: "male" | "female" | "nonbinary"
): string | null {
  const config = COUNTRY_CONFIGS[countryId];

  // If this country shares another's imperial character, resolve from source
  if (config.imperialSharedWith) {
    const sourceConfig = COUNTRY_CONFIGS[config.imperialSharedWith];
    return sourceConfig.imperialTitles?.[gender] ?? null;
  }

  return config.imperialTitles?.[gender] ?? null;
}

/**
 * Get the full imperial configuration for a country.
 * Returns null if the country has no imperial role.
 * For countries that share (e.g., CA), returns the source config with sharedWith set.
 */
export function getImperialConfig(countryId: CountryId): ImperialConfig | null {
  const config = COUNTRY_CONFIGS[countryId];

  if (config.imperialSharedWith) {
    const sourceConfig = COUNTRY_CONFIGS[config.imperialSharedWith];
    if (
      !isImperialCountry(sourceConfig) ||
      !sourceConfig.imperialTitles ||
      !sourceConfig.imperialCorporation
    ) {
      return null;
    }
    return {
      titles: sourceConfig.imperialTitles,
      corporation: sourceConfig.imperialCorporation,
      sharedWith: config.imperialSharedWith,
    };
  }

  if (!isImperialCountry(config) || !config.imperialTitles || !config.imperialCorporation) {
    return null;
  }

  return {
    titles: config.imperialTitles,
    corporation: config.imperialCorporation,
  };
}

/**
 * Get the list of country IDs that are eligible for imperial character creation
 * (have their own imperial role, not shared).
 */
export function getImperialEligibleCountries(): CountryId[] {
  return (Object.keys(COUNTRY_CONFIGS) as CountryId[]).filter(
    (id) => isImperialCountry(COUNTRY_CONFIGS[id]) && !COUNTRY_CONFIGS[id].imperialSharedWith
  );
}

/**
 * Get the gender-aware possessive prefix for a country's government labels.
 * UK male: "His Majesty's", UK female: "Her Majesty's", UK nonbinary: "The Monarch's"
 * Returns null if the country has no imperial possessives configured.
 * For shared countries (e.g., CA), resolves from the source country.
 */
export function getImperialPossessive(
  countryId: CountryId,
  gender: "male" | "female" | "nonbinary"
): string | null {
  const config = COUNTRY_CONFIGS[countryId];

  if (config.imperialSharedWith) {
    const sourceConfig = COUNTRY_CONFIGS[config.imperialSharedWith];
    return sourceConfig.imperialPossessives?.[gender] ?? null;
  }

  return config.imperialPossessives?.[gender] ?? null;
}

/**
 * Fetch the imperial possessive for a country from the database.
 * Server-side helper for components that have DB access.
 * Returns the possessive string (e.g., "His Majesty's") or the fallback.
 */
export async function fetchImperialPossessive(
  db: Db,
  countryId: CountryId,
  fallback: string = "His Majesty's"
): Promise<string> {
  const config = COUNTRY_CONFIGS[countryId];
  const resolvedCountryId = config?.imperialSharedWith ?? countryId;

  const imperial = await db
    .collection("imperialCharacters")
    .findOne({ countryId: resolvedCountryId }, { projection: { gender: 1 } });

  if (!imperial?.gender) return fallback;

  return (
    getImperialPossessive(
      resolvedCountryId as CountryId,
      imperial.gender as "male" | "female" | "nonbinary"
    ) ?? fallback
  );
}
