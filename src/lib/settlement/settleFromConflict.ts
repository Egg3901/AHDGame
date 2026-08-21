/**
 * Settle a frozen crisis once the war it started has been fought.
 *
 * A SWEEP, not a hook inside `resolveConflict`. That function is shared with
 * the proxy-war path and is called from several places; reaching into it to
 * special-case one crisis would put settlement logic inside the military engine
 * and couple two systems that otherwise only meet through a document id. This
 * reads the conflict the crisis already points at, every tick, and needs the
 * military side to know nothing about it.
 *
 * The war decides the settlement OUTRIGHT — the index is not consulted. A bloc
 * that was losing 20-80 on the board and wins the war takes Germany anyway,
 * which is the whole reason the ladder is worth climbing.
 */
import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { SettlementCrisisDoc, SettlementOutcome } from "@/lib/db/types/settlementCrisis";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { getSettlementCrisesCollection } from "@/lib/db/collections";

export interface SettleFromConflictResult {
  settled: boolean;
  outcome: SettlementOutcome | null;
}

const NOT_SETTLED: SettleFromConflictResult = { settled: false, outcome: null };

/**
 * `sideA` is NATO and `sideB` is the Warsaw Pact — set that way by
 * `declareSettlementWar` and asserted here rather than assumed, because reading
 * the winner off the wrong side would hand Germany to the loser.
 */
function outcomeForWinner(conflict: ConflictDoc, winner: "A" | "B"): SettlementOutcome | null {
  const backer = winner === "A" ? conflict.sideA.backer : conflict.sideB.backer;
  if (backer === "west") return "incumbent";
  if (backer === "east") return "challenger";
  return null;
}

export async function settleFrozenCrisisFromConflict(
  db: Db,
  crisis: SettlementCrisisDoc,
  currentTurn: number
): Promise<SettleFromConflictResult> {
  if (crisis.status !== "frozen" || !crisis.conflictId) return NOT_SETTLED;

  const conflict = await getConflictsCollection(db).findOne({ _id: crisis.conflictId });
  // A frozen crisis whose conflict has vanished stays frozen rather than
  // resolving arbitrarily. That is an admin problem, not a settlement outcome.
  if (!conflict || conflict.status !== "resolved") return NOT_SETTLED;

  const winner = conflict.outcome?.winner;
  if (winner !== "A" && winner !== "B") return NOT_SETTLED;

  const outcome = outcomeForWinner(conflict, winner);
  // A conflict whose winning side carries no backer cannot decide a bloc
  // question. Leave it frozen and visible rather than guessing.
  if (!outcome) return NOT_SETTLED;

  const crises = await getSettlementCrisesCollection(db);
  // Guarded on `frozen` so a second turn runner cannot settle it twice — the
  // actuation this unlocks in the next phase is not replayable.
  const claimed = await crises.updateOne(
    { _id: crisis._id, status: "frozen" },
    {
      $set: {
        status: "resolved",
        outcome,
        resolvedTurn: currentTurn,
        updatedAt: new Date(),
      },
    }
  );
  if (claimed.matchedCount !== 1) return NOT_SETTLED;

  return { settled: true, outcome };
}
