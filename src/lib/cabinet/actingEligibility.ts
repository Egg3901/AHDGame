import {
  getCountryConfig,
  supportsActingAppointments,
  type CountryId,
} from "@/lib/constants/countries";

/**
 * Countries whose cabinet seats are filled by legislative confirmation, and so
 * have a confirmation gap an acting appointment can bridge.
 *
 * `supportsActingAppointments` is true for every presidential country, but BR
 * and FR define no cabinet positions at all, and NG fills its cabinet directly
 * (see the branch it takes in `clearCabinetOnTransition`). Only the US runs
 * confirmation, which `cabinetNominations` reflects by hardcoding its country.
 *
 * Kept here rather than in `countries.ts` because that file is already past the
 * architecture audit's size cap.
 */
const CONFIRMS_CABINET: ReadonlySet<CountryId> = new Set<CountryId>(["US"]);

/**
 * May this country's executive install acting cabinet members?
 *
 * Reads the STATIC country config, matching what the approval penalty did
 * before this existed. The runtime `countryState.governmentType` is the
 * eventual source of truth (hence the unused
 * `supportsActingAppointmentsForGovernmentType`), and this should move to it
 * when that migration lands. Safe until then: the only regime transition that
 * rewrites `governmentType` runs a one-party state towards democracy, never a
 * presidential republic away from it, so the static and runtime values cannot
 * disagree for any country in `CONFIRMS_CABINET`.
 */
export function actingAppointmentsEnabled(countryId: CountryId): boolean {
  return supportsActingAppointments(getCountryConfig(countryId)) && CONFIRMS_CABINET.has(countryId);
}
