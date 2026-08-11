import type { Db } from "mongodb";
import type { Crisis } from "@/lib/db/types/crisis";
import type { State } from "@/lib/db/types/state";
import { COUNTRY_CONFIGS, COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";

const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  COUNTRY_ORDER.map((id) => [id, COUNTRY_CONFIGS[id].name])
);

/** Country code → full display name ("US" → "United States"), code if unknown. */
export function countryName(id: string): string {
  return COUNTRY_NAMES[id] ?? id;
}

/** Join names naturally: ["A"]→"A", ["A","B"]→"A and B", ["A","B","C"]→"A, B and C". */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Replace the `{location}` placeholder in crisis flavor/wire text with a real
 * place name. Idempotent — text without the token is returned unchanged, so it is
 * safe to run again at display time over text already baked at creation.
 */
export function interpolateLocation(text: string, locationName: string): string {
  if (!text) return text;
  return text.replace(/\{location\}/g, locationName);
}

/**
 * Resolve the best human-readable name for a crisis's affected area:
 *   - region scope  → the affected state/region name(s) (e.g. "California")
 *   - country scope → the country full name(s) (e.g. "the United States")
 *   - global scope  → "communities around the world"
 * `stateNames` lets callers that already hold the affected states skip the DB hit.
 */
export async function resolveCrisisLocationName(
  db: Db,
  crisis: Pick<Crisis, "scope" | "countryIds" | "regionIds">,
  stateNames?: string[]
): Promise<string> {
  if (crisis.scope === "region" && crisis.regionIds.length > 0) {
    let names = stateNames;
    if (!names) {
      const states = await db
        .collection<State>("states")
        .find({ _id: { $in: crisis.regionIds } })
        .project({ name: 1 })
        .toArray();
      names = states.map((s) => s.name as string).filter(Boolean);
    }
    return names.length > 0 ? joinNames(names) : "the affected region";
  }
  if (crisis.scope === "country" && crisis.countryIds.length > 0) {
    return joinNames(crisis.countryIds.map((c) => countryName(c)));
  }
  return "communities around the world";
}

/** Country-scope helper for the synchronous create paths (no state lookup needed). */
export function locationNameForCountries(countryIds: CountryId[] | string[]): string {
  return joinNames(countryIds.map((c) => countryName(c)));
}
