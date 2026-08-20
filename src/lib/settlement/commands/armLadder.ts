/**
 * Force the Issue — take the ladder to its top rung.
 *
 * The one act on this board that coercive plays cannot accumulate into.
 * Coercive plays cap at rung 4 by design; crossing to 5 is DEFCON 1 and has to
 * be a decision somebody made, by a seat that holds the authority to make it.
 *
 * Arming is NOT declaring. It unlocks a declaration and starts the mobilisation
 * levy; the war itself is a second, separate act. That is the whole shape of the
 * brink — a bloc can stand at it, pay for standing there, and step back.
 */
import { ObjectId, type Db } from "mongodb";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { LADDER_RUNGS, MAX_COERCIVE_RUNG, getSeat } from "@/lib/constants/settlementCrisis";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadSettlementActorContext } from "../actorContext";

export type ArmLadderResult =
  { ok: true; heat: number } | { ok: false; status: number; error: string };

const ARMED_RUNG = LADDER_RUNGS.length;
const fail = (status: number, error: string): ArmLadderResult => ({ ok: false, status, error });

export async function armSettlementLadder(db: Db, characterId: ObjectId): Promise<ArmLadderResult> {
  const ctx = await loadSettlementActorContext(db, characterId);
  if (!ctx) return fail(404, "The German Question is not running.");
  if (!ctx.crisisId) return fail(404, "No settlement crisis is open.");

  const seat = ctx.seat;
  if (!seat) return fail(403, "You hold no delegation on this question.");

  const def = getSeat(seat.id);
  if (!def?.authority) {
    return fail(403, "Only Washington and Moscow may take the bloc to the ladder.");
  }
  if (seat.direction === null) {
    return fail(409, "Your country belongs to neither bloc, so it has no alliance to mobilise.");
  }

  const crises = await getSettlementCrisesCollection(db);
  const crisisId = new ObjectId(ctx.crisisId);

  // Guarded: the filter restates BOTH preconditions — the crisis is still open
  // and the ladder is still exactly at the coercive cap. Two authority seats
  // pressing at once means the second matches nothing rather than double-arming,
  // and a tick that decayed the heat between the read and the write cancels it.
  const armed = await crises.updateOne(
    {
      _id: crisisId,
      status: "open",
      "ladder.heat": MAX_COERCIVE_RUNG,
    },
    {
      $set: {
        "ladder.heat": ARMED_RUNG,
        // Stamped here, not left for the next tick: this is the turn the brink
        // was reached, and the levy should not get a free turn because the
        // phase had not run yet.
        "ladder.armedTurn": await getCurrentTurn(db),
        updatedAt: new Date(),
      },
    }
  );

  if (armed.matchedCount !== 1) {
    return fail(
      409,
      `The ladder has to be at rung ${MAX_COERCIVE_RUNG} before it can be forced to ${ARMED_RUNG}.`
    );
  }

  return { ok: true, heat: ARMED_RUNG };
}
