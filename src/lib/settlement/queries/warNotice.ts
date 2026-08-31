/**
 * What to tell a player who opens the board while the question is frozen.
 *
 * The dossier serves an OPEN crisis only, and rightly so: every value on it is
 * about a board somebody can still act on. A frozen crisis has no board. It does
 * have an answer to "what happened to it", though, and before this the page
 * said "no settlement crisis is open" in the one case a player most wants
 * explained.
 *
 * Deliberately NOT part of `DossierView`. Widening that interface to carry a
 * frozen variant would put an optional-everything shape in front of every
 * consumer of a board that is normally live; this is a separate, small read for
 * a separate, small state.
 */
import type { Db } from "mongodb";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { isSettlementCrisisEnabled } from "../featureFlag";

export interface SettlementWarNotice {
  /** The war's public number, for `/world/conflicts/<n>`. Null if it has none. */
  conflictNumber: number | null;
  /** The war's name as the Conflicts board shows it. */
  name: string;
  /**
   * True when the crisis ATTACHED itself to a war it did not declare, which is
   * a different story to tell: nobody climbed the ladder, somebody just shot.
   */
  attached: boolean;
}

export async function loadGermanQuestionWarNotice(db: Db): Promise<SettlementWarNotice | null> {
  // Gated like every other read in the feature. With the flag off the turn phase
  // does not tick, so a frozen crisis is inert — and a page still narrating a war
  // that can never resolve the question is worse than saying nothing. Checked
  // first so the common "feature is off" case costs one query, not two.
  if (!(await isSettlementCrisisEnabled())) return null;

  const crises = await getSettlementCrisesCollection(db);
  const crisis = await crises.findOne({ status: "frozen" });
  if (!crisis?.conflictId) return null;

  const conflict = await getConflictsCollection(db).findOne({ _id: crisis.conflictId });
  // A frozen crisis whose war has gone missing is an admin problem, and the same
  // one `settleFromConflict` leaves frozen rather than guessing. Say the question
  // is being settled by war without inventing a link to a record that is not there.
  return {
    conflictNumber: conflict?.conflictId ?? null,
    name: conflict?.name ?? "the war",
    attached: !!crisis.conflictAttachment,
  };
}
