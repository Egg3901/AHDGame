import { getCountryDisplayName, type CountryId } from "@/lib/constants/countries";

/** Discord caps autocomplete responses at 25 choices. */
const DISCORD_CHOICE_LIMIT = 25;

export interface CountryResult {
  id: CountryId;
  name: string;
}

/**
 * Shape enabled country ids into autocomplete choices, filtered by the user's
 * typed prefix. Names honour the active preset, so RU reads "Soviet Union" in a
 * 1953 game and "Russia" in a modern one. Pure so it is testable without a Db.
 */
export function filterCountryResults(
  enabled: string[],
  query: string,
  preset: string | undefined,
  limit: number = DISCORD_CHOICE_LIMIT
): CountryResult[] {
  // Honour the caller's limit like the characters/states branches do, but never
  // exceed Discord's hard ceiling regardless of what was asked for.
  const cap = Math.max(0, Math.min(limit, DISCORD_CHOICE_LIMIT));
  const q = query.trim().toLowerCase();
  const results: CountryResult[] = [];
  for (const id of enabled as CountryId[]) {
    const name = getCountryDisplayName(id, preset);
    if (q && !name.toLowerCase().includes(q) && !id.toLowerCase().startsWith(q)) continue;
    results.push({ id, name });
    if (results.length >= cap) break;
  }
  return results;
}
