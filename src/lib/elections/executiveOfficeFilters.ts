import { type CountryId } from "@/lib/constants/countries";
import { officialsCountryScope } from "@/lib/db/electedOfficialScope";

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
  return { officeType, ...officialsCountryScope(countryId) };
}
