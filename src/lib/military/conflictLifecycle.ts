import type { ConflictStatus } from "@/lib/db/types/conflict";

/**
 * Is the FIGHTING over at this conflict?
 *
 * True for a resolved war and for one sitting in `terms_pending`, which is a war
 * whose front has reached a pole: every belligerent has already stood down and only
 * the victor's choice of term is outstanding.
 *
 * WHY THIS EXISTS. `terms_pending` is deliberately not `"resolved"`, so that the
 * readers asking "is this war still on the books" keep counting it: the wartime
 * banner still shows, no second war can be declared between the same pair, and the
 * record still reads as live. But the readers asking "can this war still be acted
 * on" must say no, and before this helper each of them tested `status === "resolved"`
 * directly. Three of them were wrong the moment the new status existed:
 *
 *   - `resolveBattleDeclarations` would have fought an offensive queued at a front
 *     whose roster had already gone home.
 *   - `validatePeaceOffer` would have accepted a settlement for a war already won.
 *   - The international organizations phase would have let a country join it.
 *
 * The two questions look identical and are not, which is exactly why the second one
 * is named here rather than spelled out at each call site.
 */
export function isConflictConcluded(status: ConflictStatus | undefined): boolean {
  return status === "resolved" || status === "terms_pending";
}
