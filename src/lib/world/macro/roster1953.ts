import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import {
  AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS,
  getAfricaAmericas1953MacroCountry,
  getAfricaAmericas1953MacroSpec,
} from "./africaAmericas1953";
import {
  ASIA_ME_1953_MACRO_ENTITY_IDS,
  getAsiaMiddleEast1953MacroCountry,
  getAsiaMiddleEast1953MacroSpec,
} from "./asiaMiddleEast1953";
import {
  EUROPE_1953_MACRO_ENTITY_IDS,
  getEurope1953MacroCountry,
  getEurope1953MacroSpec,
} from "./europe1953";
import type { MacroCountryState } from "./types";

/** Full authored 1953 Tier-2 roster (Europe #3719 + Asia/ME #3720 + Africa/Americas #3721). */
export const ALL_1953_MACRO_ENTITY_IDS: readonly WorldEntityId[] = [
  ...EUROPE_1953_MACRO_ENTITY_IDS,
  ...ASIA_ME_1953_MACRO_ENTITY_IDS,
  ...AFRICA_AMERICAS_1953_MACRO_ENTITY_IDS,
];

/**
 * Resolve an authored 1953 sphere-macro seed. Never falls back to another era.
 */
export function getAuthored1953MacroCountry(
  entityId: WorldEntityId,
  now = new Date()
): MacroCountryState {
  if (getEurope1953MacroSpec(entityId)) {
    return getEurope1953MacroCountry(entityId, now);
  }
  if (getAsiaMiddleEast1953MacroSpec(entityId)) {
    return getAsiaMiddleEast1953MacroCountry(entityId, now);
  }
  if (getAfricaAmericas1953MacroSpec(entityId)) {
    return getAfricaAmericas1953MacroCountry(entityId, now);
  }
  throw new Error(`No authored 1953 macro seed for ${entityId}; refusing modern-preset fallback.`);
}

export function listAll1953MacroCountries(now = new Date()): MacroCountryState[] {
  return ALL_1953_MACRO_ENTITY_IDS.map((entityId) => getAuthored1953MacroCountry(entityId, now));
}
