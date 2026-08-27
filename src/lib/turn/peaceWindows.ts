import type { Db, Filter } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { resolveConflict } from "@/lib/military/resolveConflict";

/**
 * Resolve every won war whose dictate window has lapsed, as a white peace.
 *
 * A REAL SWEEP, not lazy expiry, and the difference matters. A peace offer can be
 * expired by whoever reads it, and a reader is guaranteed because somebody has to
 * open it to act on it. Nothing forces anyone to open a conflict document: a victor
 * who never logs in would leave a won war sitting in `terms_pending` for ever, with
 * both rosters stood down and no truce written. So this runs every tick whether or
 * not anyone fought.
 *
 * Reads `conflictsEnabled` itself, for the same reason `resolveColdWarHolds` does:
 * every other conflict step is reached from a declaration and inherits that gate
 * upstream, while this one is reached from a stamp on a document.
 *
 * Spec: docs/superpowers/specs/2026-08-27-peace-terms-design.md
 */
export async function resolvePeaceWindows(
  db: Db,
  currentTurn: number
): Promise<{ resolved: number }> {
  const gameState = await getGameStateCollection(db).then((col) =>
    col.findOne({ _id: "current" }, { projection: { conflictsEnabled: 1 } })
  );
  if (!gameState?.conflictsEnabled) return { resolved: 0 };

  const lapsed = await getConflictsCollection(db)
    .find({
      status: "terms_pending",
      "termsWindow.closesTurn": { $lte: currentTurn },
    } as Filter<ConflictDoc>)
    .toArray();

  let resolved = 0;
  for (const conflict of lapsed as ConflictDoc[]) {
    const win = conflict.termsWindow;
    // A window with no victor stamped cannot be resolved for anyone. Leave it and
    // let an admin see it rather than picking a winner arbitrarily. Captured into a
    // local so the checks below narrow the whole object, not just the one field.
    if (!win || (win.victor !== "A" && win.victor !== "B")) continue;
    const victor = win.victor;

    // CLAIM the war before resolving it, exactly as `resolveColdWarHolds` does and
    // for the same reason: the find above and the writes below are not atomic, and
    // this project has had overlapping turn runs from a rolling deploy. Claiming on
    // `status` is what makes the second runner's update match nothing, because it is
    // the same field `resolveConflict` sets.
    const claim = await getConflictsCollection(db).updateOne(
      { _id: conflict._id, status: "terms_pending" } as Filter<ConflictDoc>,
      { $set: { status: "resolved" } }
    );
    if (claim.modifiedCount !== 1) continue;

    // Stamp the settlement as a WHITE PEACE rather than leaving it absent. The war
    // did end in a settlement; that settlement simply took nothing, and a zero
    // indemnity is how the rest of the system already says so ("the same mechanism
    // dialled to nothing"). Leaving it absent would also hide the war from the news
    // wire, which only reports conflicts carrying a settlement.
    await getConflictsCollection(db).updateOne(
      { _id: conflict._id },
      {
        $set: {
          settlement: {
            term: { kind: "indemnity" as const, amount: 0, payer: win.target },
            path: "dictated" as const,
            imposedBy: win.imposer,
            target: win.target,
            turn: currentTurn,
          },
        },
      }
    );

    await resolveConflict(db, conflict, victor, currentTurn);
    resolved++;
  }

  return { resolved };
}
