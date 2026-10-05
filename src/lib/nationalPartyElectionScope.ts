import { DEFAULT_LEGACY_COUNTRY_ID, type CountryId } from "@/lib/constants/countries";

export function applyOptionalCountryScope(
  baseQuery: Record<string, unknown>,
  countryId?: CountryId
): Record<string, unknown> {
  if (!countryId) return baseQuery;

  const countryQuery: Record<string, unknown> =
    countryId === DEFAULT_LEGACY_COUNTRY_ID
      ? {
          $or: [{ countryId: DEFAULT_LEGACY_COUNTRY_ID }, { countryId: { $exists: false } }],
        }
      : { countryId };

  if (Object.keys(baseQuery).length === 0) {
    return countryQuery;
  }

  return { $and: [baseQuery, countryQuery] };
}
