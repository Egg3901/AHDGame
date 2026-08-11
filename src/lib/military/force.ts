// Per-country military scale factor for the Combat Command engine. Units and
// formations come from live gameState (the `militaryUnits` / `militaryFormations`
// collections); the synthetic formation scaffold has been retired (WIRE W6).
import type { CountryId } from "@/lib/constants/countries";
import { MILITARY_COUNTRY_SCALE } from "@/lib/constants/military";

/**
 * Per-country military scale for the Combat Command engine (upkeep + supply demand).
 * The single source of truth is `MILITARY_COUNTRY_SCALE`, shared with the defense-budget
 * envelope — the battle engine no longer keeps its own US-only copy.
 */
export function countryScale(country: string): number {
  return MILITARY_COUNTRY_SCALE[country as CountryId] ?? 1;
}
