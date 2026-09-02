/**
 * Country scoping for `electedOfficials` queries.
 *
 * Two facts make an unscoped officials query wrong:
 *
 * 1. Party sequentialIds collide across countries ("3" is Reform in the US and
 *    a Brazilian party in BR) and office types like "house" and "senate" are
 *    shared between countries, so a query filtered only by party and office
 *    matches foreign members (bug #0699).
 * 2. US officials predate the explicit `countryId` field, so a plain
 *    `{ countryId: "US" }` filter drops legitimate rows that simply never got
 *    stamped. Absence has to count as US until every environment has been
 *    rewritten by normal turn processing.
 *
 * Both rules used to be restated at each call site, which is how some queries
 * ended up with one and not the other. This module states them once.
 *
 * Scoped to `electedOfficials` on purpose. Other collections carry their own
 * legacy story (party elections key off `DEFAULT_LEGACY_COUNTRY_ID`, and the
 * `states` / `elections` / `politicalParties` filters answer a different
 * question), so folding them in here would assert an equivalence that does not
 * hold.
 */
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

/** Countries whose `electedOfficials` rows predate the explicit countryId. */
const LEGACY_UNTAGGED_COUNTRIES: ReadonlySet<CountryId> = new Set([COUNTRY_CONFIGS.US.id]);

/**
 * Country scope for an `electedOfficials` query, matching legacy untagged rows
 * where the country has them.
 *
 * Returns a disjunction for such countries, so it cannot be combined with
 * another top-level `$or` in the same filter. Where a caller already has one,
 * join both under `$and` rather than letting one overwrite the other.
 */
export function officialsCountryScope(countryId: CountryId): Record<string, unknown> {
  if (LEGACY_UNTAGGED_COUNTRIES.has(countryId)) {
    return { $or: [{ countryId }, { countryId: { $exists: false } }] };
  }
  return { countryId };
}

/**
 * Country-scoped filter for a state's governor row. Shared by the impeachment
 * filing, trial and removal paths and the by-election watcher, which each
 * carried a byte-identical copy of this.
 */
export function governorOfficialFilter(
  countryId: CountryId,
  state: string
): Record<string, unknown> {
  return { officeType: "governor", state, ...officialsCountryScope(countryId) };
}
