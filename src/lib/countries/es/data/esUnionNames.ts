import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * ES's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const ES_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = {
  manufacturing: "CCOO Industry Federation",
  automobiles: "CCOO Industry Federation",
  chemical_industries: "CCOO Industry Federation",
  construction: "CCOO Construction Federation",
  energy: "CCOO Energy Federation",
  extraction: "CCOO Mining Federation",
  healthcare: "CCOO Health Federation",
  retail: "CCOO Commerce Federation",
  media_entertainment: "CCOO Culture Federation",
  logistics: "CCOO Transport Federation",
  technology: "CCOO Industry Federation",
  financial: "CCOO Finance Federation",
  telecommunications: "CCOO Communications Federation",
  defense: "CCOO Industry Federation",
  agriculture: "CCOO Agriculture Federation",
  real_estate: "CCOO Construction Federation",
};

export const ES_UNION_NAMES_1953: Partial<Record<CorporationType, string>> = uniform(
  "Organización Sindical Española"
);
