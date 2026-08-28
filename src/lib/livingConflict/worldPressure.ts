import type { ConflictDoc, ConflictSide } from "@/lib/db/types/conflict";
import type { CountryId } from "@/lib/constants/countries";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";

export type ActiveWarSnapshot = Pick<
  ConflictDoc,
  "status" | "intensity" | "hostCountry" | "hostEntities"
> & {
  sideA: Pick<ConflictSide, "countries">;
  sideB: Pick<ConflictSide, "countries">;
};

function containsAny(countries: CountryId[], targets: ReadonlySet<CountryId>): boolean {
  return countries.some((countryId) => targets.has(countryId));
}

const WESTERN_SUPERPOWERS = new Set<CountryId>(["US"]);
const EASTERN_SUPERPOWERS = new Set<CountryId>(["RU"]);
const GERMAN_THEATER = new Set<WorldEntityId>(["DE", "DD"]);

function isOpposedSuperpowerWar(conflict: ActiveWarSnapshot): boolean {
  if (conflict.status !== "active" || conflict.intensity < 50) return false;
  const aWest = containsAny(conflict.sideA.countries, WESTERN_SUPERPOWERS);
  const aEast = containsAny(conflict.sideA.countries, EASTERN_SUPERPOWERS);
  const bWest = containsAny(conflict.sideB.countries, WESTERN_SUPERPOWERS);
  const bEast = containsAny(conflict.sideB.countries, EASTERN_SUPERPOWERS);
  return (aWest && bEast) || (aEast && bWest);
}

function isGermanTheater(conflict: ActiveWarSnapshot): boolean {
  return (
    (conflict.hostCountry != null && GERMAN_THEATER.has(conflict.hostCountry)) ||
    (conflict.hostEntities ?? []).some((countryId) => GERMAN_THEATER.has(countryId))
  );
}

/**
 * Spillover pressure from an open US-Soviet war into Vietnam's escalation
 * ladder. The calendar gates still cap the historical rung, so a hotter world
 * reaches the current ceiling faster without unlocking Tonkin before 1964.
 */
export function vietnamWorldPressure(
  globalTension: number,
  conflicts: ActiveWarSnapshot[]
): number {
  if (globalTension < 75) return 0;
  const superpowerWars = conflicts.filter(isOpposedSuperpowerWar);
  if (superpowerWars.length === 0) return 0;
  if (globalTension >= 90 && superpowerWars.some(isGermanTheater)) return 4;
  return globalTension >= 90 ? 3 : 2;
}
