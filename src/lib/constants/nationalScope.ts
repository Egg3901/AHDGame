import type { CountryId } from "./countries";

/**
 * Maps national-scope stateMetrics document IDs to their country ID.
 * These docs are precomputed each turn by computeNationalMetrics().
 * Adding a new country = one line here.
 */
export const NATIONAL_SCOPE: Record<string, CountryId> = {
  federal: "US",
  uk_national: "UK",
  jp_national: "JP",
  de_national: "DE",
  br_national: "BR",
  ie_national: "IE",
  cn_national: "CN",
  ng_national: "NG",
  // RU became playable with the political-legislation 1953 reset. The Soviet
  // pseudo-state id is su_national (the seeds' + NATIONAL_POLICY_STATE_IDS
  // convention) — NOT ru_national, which nothing else reads.
  su_national: "RU",
  // DD became playable with #3488 but was never registered here, unlike RU
  // above. The omission is quiet and total: `getNationalDocId` resolves through
  // this map, so East Germany got no national metrics document at all, and the
  // economy collector in gameHealthSnapshot iterates NATIONAL_SCOPE directly —
  // so a country running a full 50B economy with its own budget, parties and
  // elections produced no `economy.byCountry` row and was invisible to every
  // economic chart and check. `dd_national` is the id the rest of the codebase
  // already uses for it (see basePolicies / basePolicies1953 / basePolicies1979).
  dd_national: "DD",
};

/** Set of national-scope doc IDs for fast membership checks. */
export const NATIONAL_SCOPE_IDS = new Set(Object.keys(NATIONAL_SCOPE));

/** Given a countryId, return its national-scope stateMetrics doc ID. */
export function getNationalDocId(countryId: CountryId): string | undefined {
  return Object.entries(NATIONAL_SCOPE).find(([, c]) => c === countryId)?.[0];
}
