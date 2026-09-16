import type { Condition } from "@/lib/utils/approvalModifiers";

/**
 * Build one threshold condition for a country modifier patch.
 *
 * ⚠️ LIVES IN ITS OWN MODULE TO BREAK A CYCLE. It was the module-private `c` in
 * `countryPatches.ts`. Japan's patch map moved to
 * `countries/jp/data/jpModifierPatches.ts` and needs it, but `countryPatches.ts`
 * imports that map -- so importing the helper back out of `countryPatches.ts`
 * would be a real runtime import cycle. Both files alias it back to `c` on
 * import, because a table of thirty conditions reads better that way.
 */
export const condition = (
  category: string,
  metric: string,
  op: Condition["op"],
  value: number
): Condition => ({
  category,
  metric,
  op,
  value,
});
