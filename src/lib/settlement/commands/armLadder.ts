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
import {
  LADDER_RUNGS,
  LADDER_UNLOCK_TURNS,
  MAX_COERCIVE_RUNG,
  getSeat,
  settlementRulesFor,
} from "@/lib/constants/settlementCrisis";
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

  // Read the rules for the error message; the write below re-states the switch
  // as a filter clause so an admin flipping it mid-request still wins.
  const doc = await crises.findOne({ _id: crisisId }, { projection: { rules: 1, openedTurn: 1 } });
  if (!settlementRulesFor(doc ?? {}).escalationEnabled) {
    return fail(403, "The escalation ladder is switched off for this question.");
  }

  // The four-power channel has to run its course first. Without this the brink
  // is available on turn 4 of a question tuned to take 149 to 257 turns, and
  // one authority seat can end an admin-opened set piece before the other three
  // delegations have logged in. See LADDER_UNLOCK_TURNS.
  const currentTurn = await getCurrentTurn(db);
  const opensAt = (doc?.openedTurn ?? 0) + LADDER_UNLOCK_TURNS;
  if (currentTurn < opensAt) {
    return fail(
      409,
      `The four-power channel is still sitting. The ladder opens on turn ${opensAt}.`
    );
  }

  // Guarded: the filter restates BOTH preconditions — the crisis is still open
  // and the ladder is still exactly at the coercive cap. Two authority seats
  // pressing at once means the second matches nothing rather than double-arming,
  // and a tick that decayed the heat between the read and the write cancels it.
  const armed = await crises.updateOne(
    {
      _id: crisisId,
      status: "open",
      "ladder.heat": MAX_COERCIVE_RUNG,
      // `$ne: false` and not `true`: a crisis written before the rules block
      // existed has no field, and the authored default is on.
      "rules.escalationEnabled": { $ne: false },
    },
    {
      $set: {
        "ladder.heat": ARMED_RUNG,
        // Stamped here, not left for the next tick: this is the turn the brink
        // was reached, and the levy should not get a free turn because the
        // phase had not run yet.
        "ladder.armedTurn": currentTurn,
        // A fresh grace: the bloc that just pressed has not been quiet yet.
        "ladder.quietTurns": 0,
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
