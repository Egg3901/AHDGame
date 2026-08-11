import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/**
 * Resolve the country a /api/whitehouse* request is scoped to from its
 * ?country= query param (default US — the original, pre-parameterization
 * behavior). Returns null for an unknown country code.
 */
export function resolvePresidentialCountry(request: Request): CountryId | null {
  const raw = new URL(request.url).searchParams.get("country");
  const countryId = (raw ?? "US").toUpperCase() as CountryId;
  return COUNTRY_CONFIGS[countryId] ? countryId : null;
}
