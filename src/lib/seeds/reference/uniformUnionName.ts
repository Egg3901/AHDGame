import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * One national labour body covering every sector.
 *
 * Used for state-directed single-federation systems (Soviet bloc, Franco Spain,
 * ACFTU) and for countries where only the national confederation is safely
 * attestable for an era. Sectors deliberately omitted from a country's map fall
 * back to `genericUnionName` at lookup time; that generic fallback is preferred
 * over inventing a plausible-sounding but fake historical union.
 *
 * ⚠️ THIS LIVES IN ITS OWN MODULE TO BREAK A CYCLE. It was module-private in
 * `unionNames.ts`. Japan's era maps moved to `countries/jp/data/jpUnionNames.ts`
 * and 1953 needs it, but `unionNames.ts` imports those maps -- so importing the
 * helper back out of `unionNames.ts` would be a genuine runtime import cycle,
 * not the harmless type-only kind. Duplicating four lines instead would leave
 * two copies to drift. A third module both can import is neither.
 */
export function uniform(name: string): Partial<Record<CorporationType, string>> {
  const map: Partial<Record<CorporationType, string>> = {};
  for (const type of CORPORATION_TYPES) map[type] = name;
  return map;
}
