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
  const [pending, resolvedElections] = await Promise.all([
    elections.countDocuments({ cycle: 0, status: { $in: ["active", "upcoming"] } }),
    elections
      .find({ cycle: 0, status: { $in: ["completed", "resolved"] } }, { projection: { _id: 1 } })
      .toArray(),
  ]);

  // Still campaigning, or founding races not spawned yet — keep the pin.
  if (pending > 0 || resolvedElections.length === 0) return { completed: false };

  // A resolver can defensively close an election with no candidates or votes.
  // That must not make a vacant founding world look complete. Check coverage in
  // two batched queries only when every race has otherwise finished.
  const resolvedIds = resolvedElections.map((election) => election._id);
  const [candidateCoverage, tallyCoverage] = await Promise.all([
    db
      .collection("electionCandidates")
      .aggregate([
        { $match: { electionId: { $in: resolvedIds } } },
        { $group: { _id: "$electionId" } },
        { $count: "count" },
      ])
      .toArray(),
    db
      .collection("electionVoteTallies")
      .aggregate([
        {
          $match: {
            electionId: { $in: resolvedIds },
            $expr: {
              $gt: [
                {
                  $sum: {
                    $map: {
                      input: { $objectToArray: { $ifNull: ["$totalVotes", {}] } },
                      in: "$$this.v",
                    },
                  },
                },
                0,
              ],
            },
          },
        },
        { $group: { _id: "$electionId" } },
        { $count: "count" },
      ])
      .toArray(),
  ]);
  const candidatesCovered = (candidateCoverage[0] as { count?: number } | undefined)?.count ?? 0;
  const talliesCovered = (tallyCoverage[0] as { count?: number } | undefined)?.count ?? 0;
  if (candidatesCovered !== resolvedIds.length || talliesCovered !== resolvedIds.length) {
    return { completed: false };
  }

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
