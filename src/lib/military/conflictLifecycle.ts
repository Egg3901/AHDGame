import type { ConflictDoc, ConflictStatus } from "@/lib/db/types/conflict";

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

/**
 * How long after a war resolves its fog of war stays down.
 *
 * Ten game years at 48 turns a year. A resolved war is a historical record, but
 * the day it ends its order of battle is still a live intelligence picture of a
 * nation that may fight again next season. The delay lets the record open for
 * history once nothing in it could still be acted on.
 */
export const CONFLICT_ARCHIVE_DELAY_TURNS = 480;

/**
 * The turn a resolved war's full record opens to everyone, or null when it has no
 * such turn: the war has not resolved, or it resolved before `endTurn` was stamped.
 *
 * The legacy case is deliberately null rather than "never": a resolved war with no
 * `endTurn` has been an open record since it ended, and `isArchiveOpen` keeps it so.
 * Dating its fog from nothing would take back what was already public.
 */
export function archiveOpensTurn(
  c: Pick<ConflictDoc, "status"> & { endTurn?: number }
): number | null {
  if (c.status !== "resolved" || c.endTurn == null) return null;
  return c.endTurn + CONFLICT_ARCHIVE_DELAY_TURNS;
}

/** Whether a resolved war's record has opened to everyone as of `currentTurn`. */
export function isArchiveOpen(
  c: Pick<ConflictDoc, "status"> & { endTurn?: number },
  currentTurn: number
): boolean {
  if (c.status !== "resolved") return false;
  const opens = archiveOpensTurn(c);
  return opens === null || currentTurn >= opens;
}
