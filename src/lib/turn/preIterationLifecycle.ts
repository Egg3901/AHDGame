import type { Db } from "mongodb";
import type { Election, GameState } from "@/lib/db/types";
import { invalidateGameTimeCache } from "@/lib/time/gameTime";

/**
 * Detect when the live pre-iteration "founding" phase is complete and end it.
 *
 * The founding election spawns one cycle-0 race per in-scope seat at bootstrap
 * (see the founding branch in `pickNextCanonicalCycle`). Every political nation
 * therefore has cycle-0 races; economy-only / coming-soon nations spawn none.
 * The phase is complete once every founding race has resolved — i.e. there are
 * NO active/upcoming cycle-0 races left AND at least one has resolved (the
 * latter guards against firing on turn 1 before the races exist).
 *
 * On completion we:
 *   - flip `preIteration.active` off and stamp `completedTurn`;
 *   - stamp `preIterationTurns = newTurn − 1` so the calendar resumes at the era
 *     start (turn 1) next turn and every canonical anchor shifts forward by the
 *     same amount (see `getCycleAnchors`), preserving the historical mapping;
 *   - invalidate the game-time cache so the pin lifts immediately.
 *
 * The `preIteration.active` flip is written to the DB here, but the current
 * turn's in-memory `gameState` snapshot still reads `active: true` — so the
 * canonical spawners guarded on it stay suppressed for the rest of THIS turn and
 * only resume (with the offset applied) next turn. That one-turn lag avoids a
 * half-applied tick where cycle-1 spawns before the offset lands.
 *
 * Runs AFTER election resolution + government formation each turn, and is a
 * no-op unless a pre-iteration is active.
 */
export async function detectPreIterationComplete(
  db: Db,
  newTurn: number
): Promise<{ completed: boolean }> {
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preIteration: 1 } });
  if (!gameState?.preIteration?.active) return { completed: false };

  const elections = db.collection<Election>("elections");
  const [pending, resolved] = await Promise.all([
    elections.countDocuments({ cycle: 0, status: { $in: ["active", "upcoming"] } }),
    elections.countDocuments({ cycle: 0, status: { $in: ["completed", "resolved"] } }),
  ]);

  // Still campaigning, or founding races not spawned yet — keep the pin.
  if (pending > 0 || resolved === 0) return { completed: false };

  await db.collection<GameState>("gameState").updateOne(
    { _id: "current" },
    {
      $set: {
        "preIteration.active": false,
        "preIteration.completedTurn": newTurn,
        preIterationTurns: Math.max(0, newTurn - 1),
        updatedAt: new Date(),
      },
    }
  );
  invalidateGameTimeCache();
  return { completed: true };
}
