import type { CountryId } from "@/lib/constants/countries";

/** Resolve the country used by corporation-turn country-scoped market books. */
export function sectorCountryForClearing(
  sector: { stateId: string; countryId?: string | null },
  countryByStateId: ReadonlyMap<string, string>
): CountryId {
  // The commodity ledger derives national supply from the host state's
  // country. Clearing must use that same authority. Persisted sector.countryId
  // can be stale after cross-border moves or old seed/migration paths; trusting
  // it first places real output in a different country book from its ledger.
  return (countryByStateId.get(sector.stateId) ?? sector.countryId ?? "US") as CountryId;
}
