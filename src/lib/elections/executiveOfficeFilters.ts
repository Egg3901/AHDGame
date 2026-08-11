import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

export type ExecutiveOfficeType = "president" | "vicePresident";

/**
 * US executive office records predate country-scoped electedOfficials rows.
 * Keep matching those legacy documents until every environment has been
 * rewritten with an explicit countryId by normal turn processing.
 */
export function getExecutiveOfficialFilter(
  countryId: CountryId,
  officeType: ExecutiveOfficeType
): Record<string, unknown> {
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return {
      officeType,
      $or: [{ countryId }, { countryId: { $exists: false } }],
    };
  }

  return { officeType, countryId };
}
