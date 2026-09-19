import type { CorporationType } from "@/lib/constants/corporations";
import { uniform } from "@/lib/seeds/reference/uniformUnionName";

/**
 * CS's trade-union names, by era.
 *
 * Moved out of `src/lib/seeds/reference/unionNames.ts`, which now forwards to
 * this. Values unchanged.
 *
 * ⚠️ EACH OLDER ERA SPREADS THIS COUNTRY'S NEWER ONE, so the exports below
 * are ordered newest first and a spread only ever reaches backwards in this
 * file. The registry's own era chain -- an era map spreading the whole previous
 * map -- is a separate thing and stays there.
 */

export const CS_UNION_NAMES_MODERN: Partial<Record<CorporationType, string>> = uniform(
  "Czech-Moravian Confederation of Trade Unions"
);

export const CS_UNION_NAMES_1991: Partial<Record<CorporationType, string>> = uniform(
  "Czech and Slovak Confederation of Trade Unions"
);

export const CS_UNION_NAMES_1979: Partial<Record<CorporationType, string>> = uniform(
  "Revolutionary Trade Union Movement"
);
