import type { Election } from "@/lib/db/types";

/**
 * The end time a snap election lends to the NEXT regular race, or null when it
 * lends none.
 *
 * THE SNAP-SHIFT RULE, in one place. Four spawn sites need it (Commons and
 * Shugiin and Bundestag in `perpetualElections`, plus Commons again in
 * `electionSpawning`), and before this helper each carried its own copy of the
 * condition. A rule with four copies is a rule that drifts.
 *
 * Two things return null, for different reasons:
 *
 *   - A REGULAR prior election. Only a snap anchors the next cycle; an
 *     admin-accelerated regular must not drag the LARP calendar. This is the
 *     original rule and is unchanged.
 *   - An IMPOSED snap. A peace settlement's regime change dissolves the chamber,
 *     and that is the whole of its business. Rescheduling every future election
 *     in the country would be a second, unannounced penalty riding along with the
 *     first. The next regular therefore lands on its canonical date, and
 *     `pickNextCanonicalCycle`'s existing window guard walks forward to the
 *     following cycle when that date no longer leaves room for a primary.
 *
 * Takes the expected snap type from the caller rather than testing a `snap_`
 * prefix: each spawn site is responsible for one chamber, and a Commons spawner
 * must not inherit an anchor from a Shugiin snap.
 */
export function snapAnchorEndTime(
  prev: Pick<Election, "electionType" | "endTime" | "imposedSnap"> | null | undefined,
  snapType: string
): Date | null {
  if (!prev || prev.electionType !== snapType) return null;
  if (!prev.endTime) return null;
  if (prev.imposedSnap === true) return null;
  return prev.endTime;
}
