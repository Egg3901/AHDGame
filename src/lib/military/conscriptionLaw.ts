import type { Db } from "mongodb";
import { getEnactedLevel } from "@/lib/politicalLegislation/enactedLevels";
import { carriedLawIdFor } from "@/lib/politicalLegislation/carriedLaw";
import type { LawCountryId } from "@/lib/politicalLegislation/types";
import {
  RESERVE_LAW_BY_COUNTRY,
  stanceForReserveLevel,
  resolveConscriptionStance,
  type ConscriptionStance,
} from "./manpower";

/**
 * The stance actually in force: a playable nation's enacted reserve-forces law, else the
 * default stance table.
 *
 * The short-circuit matters. `getEnactedLevel` returns the law's authored `baselineLevel`
 * when a nation simply has not legislated yet (good), but returns 0 for an *unknown* law
 * id — so calling it for a nation that has no such law would read as "No Reserve System"
 * and silently strip its manpower instead of falling back.
 *
 * A nation with no reserve law of its OWN can still have inherited one: a country merge
 * hands the absorbed state's legislation catalogue to the survivor
 * (`rescopeLegislationCatalogue` flips `legislationTypes.countryScope`), so post-
 * reunification Germany holds East Germany's reserve-forces law even though
 * `RESERVE_LAW_BY_COUNTRY` never listed DE. Where both a native and a carried law exist
 * the native entry wins the lookup order here — but the one live pair (DD into DE) has no
 * native DE entry, and the merge rule is that the winner's law governs. The scope check
 * keeps this inert everywhere else: a country that never absorbed anyone scopes none of
 * the known reserve-law ids.
 *
 * Server-only: this reaches the law catalogue. Client surfaces import the pure ladder
 * (`stanceForReserveLevel`) from `manpower.ts` instead.
 */
export async function resolveConscriptionStanceFor(
  db: Db,
  countryId: string
): Promise<ConscriptionStance> {
  const lawId =
    RESERVE_LAW_BY_COUNTRY[countryId] ??
    (await carriedLawIdFor(db, countryId, Object.values(RESERVE_LAW_BY_COUNTRY)));
  if (!lawId) return resolveConscriptionStance(countryId);
  const level = await getEnactedLevel(db, countryId as LawCountryId, lawId);
  return stanceForReserveLevel(level);
}
