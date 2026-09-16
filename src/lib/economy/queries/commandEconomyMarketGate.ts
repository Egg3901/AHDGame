/**
 * Command Economy (market-visibility gate) - which countries' corporate markets
 * (unowned pools especially) should NOT be offered to a PRIVATE corporation
 * right now, because the state owns production there.
 *
 * ONE signal feeds this: the marketization DIAL
 * (`marketizationLevel` in `@/lib/constants/commandEconomy`), read live from
 * `FederalBudget.economicFactors.marketizationLevel` with the era schedule as
 * fallback. Below `COMMAND_CEILING` the market is state-controlled.
 *
 * This used to carry a second, STRUCTURAL signal -
 * `COUNTRY_CONFIGS[id].disallowPrivateCorporationFounding`. That field was
 * redundant with `MARKETIZATION_SCHEDULE` (every flagged country was already
 * scheduled) and could only ever DIVERGE from it, which it did four ways:
 * BLR/BAL/UKR and CN were scheduled but unflagged, so a flag-first gate silently
 * treated command-era China and the union republics as open markets; and the
 * flag was unconditional, so it claimed the USSR could never marketize even
 * though its own schedule terminates in 1991. The field is gone; the dial is the
 * only authority, and a country converting in either direction is honoured with
 * no code change.
 *
 * NOTE ON `commandEconomyEnabled`: this gate deliberately does NOT consult it.
 * That flag gates the planned-economy SIMULATION subsystems (forex, administered
 * CPI, monobank, second economy). Whether the USSR is a planned economy is world
 * data, not a feature toggle - and honouring it meant switching the flag off
 * re-opened Soviet markets to private expansion. Flag-off worlds are therefore
 * no longer byte-identical here: a command economy's market is closed to private
 * entry whether or not the planned subsystems are simulating, which is the
 * correct reading of the regime.
 *
 * Fails OPEN: a DB hiccup here degrades to "not blocked" rather than
 * false-blocking a live game's markets. The CREATION-side gate in
 * `privateEnterpriseGate` makes the opposite trade and fails closed, because a
 * hiccup must not mint a private corporation inside a planned economy.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { loadPrivateEnterpriseBlockedCountries } from "./privateEnterpriseGate";

/**
 * Resolve the set of `countryIds` (out of the ones passed in) whose corporate
 * market is currently state-controlled and should not be offered to private
 * corporations. Only returns countries actually passed in, so it stays cheap to
 * call with a handful of candidates from a suggestions/expansion query.
 */
export async function loadCommandEconomyBlockedCountries(
  db: Db,
  countryIds: Iterable<string | null | undefined>
): Promise<Set<CountryId>> {
  const requested = new Set<string>();
  for (const raw of countryIds) {
    if (raw) requested.add(raw);
  }
  if (requested.size === 0) return new Set<CountryId>();

  let blockedEverywhere: Set<CountryId>;
  try {
    blockedEverywhere = await loadPrivateEnterpriseBlockedCountries(db);
  } catch {
    // Fail-open: see the file docblock.
    return new Set<CountryId>();
  }

  const blocked = new Set<CountryId>();
  for (const id of requested) {
    if (blockedEverywhere.has(id as CountryId)) blocked.add(id as CountryId);
  }
  return blocked;
}
