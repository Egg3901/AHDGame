/**
 * Declare the war the ladder has been arming.
 *
 * The second of the two presses. Arming puts the bloc at the brink and starts
 * the levy; this is the one that ends the influence contest and opens a real
 * NATO–Warsaw Pact conflict on the Conflicts board.
 *
 * The crisis FREEZES rather than resolving: no plays, no drift, the meter held
 * exactly where it stood. Whoever wins the war takes the settlement outright,
 * regardless of where the index was when the shooting started.
 *
 * ORDER: claim the freeze FIRST, then build the war. Two authority seats
 * pressing at once must not produce two wars, and the guarded claim is what
 * makes the loser match nothing. The cost of that ordering is that a failure
 * inside `createConflict` leaves the crisis frozen with a null `conflictId` —
 * recoverable by an admin, and strictly better than an orphan war on the board
 * that no crisis points at.
 */
import { ObjectId, type Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { LADDER_RUNGS, getSeat, settlementRulesFor } from "@/lib/constants/settlementCrisis";
import { getSettlementCrisesCollection } from "@/lib/db/collections";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import { loadBlocMembership } from "@/lib/world/blocMembership";
import { createConflict } from "@/lib/military/createConflict";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { loadSettlementActorContext } from "../actorContext";

export type DeclareWarResult =
  | { ok: true; conflictId: string; conflictNumber: number }
  | { ok: false; status: number; error: string };

const ARMED_RUNG = LADDER_RUNGS.length;
const fail = (status: number, error: string): DeclareWarResult => ({ ok: false, status, error });

/** Playable members of one bloc, as real CountryIds the conflict engine accepts. */
function coalitionFor(membership: Record<string, string>, bloc: "west" | "east"): CountryId[] {
  return Object.entries(membership)
    .filter(([entityId, side]) => side === bloc && entityId in COUNTRY_CONFIGS)
    .map(([entityId]) => entityId as CountryId)
    .sort();
}

export async function declareSettlementWar(
  db: Db,
  characterId: ObjectId
): Promise<DeclareWarResult> {
  const ctx = await loadSettlementActorContext(db, characterId);
  if (!ctx) return fail(404, "The German Question is not running.");
  if (!ctx.crisisId) return fail(404, "No settlement crisis is open.");

  const seat = ctx.seat;
  if (!seat) return fail(403, "You hold no delegation on this question.");
  if (!getSeat(seat.id)?.authority) {
    return fail(403, "Only Washington and Moscow may declare.");
  }

  const preset = await getGameStatePresetOrDefault(db);
  const membership = await loadBlocMembership(db, preset);
  const west = coalitionFor(membership, "west");
  const east = coalitionFor(membership, "east");
  // A war needs two sides. Without this a collapsed bloc produces a conflict
  // with an empty coalition, which the battle engine reads as a walkover.
  if (west.length === 0 || east.length === 0) {
    return fail(409, "One of the two alliances has no members left to fight.");
  }

  const crises = await getSettlementCrisesCollection(db);
  const crisisId = new ObjectId(ctx.crisisId);
  const currentTurn = await getCurrentTurn(db);

  const rules = settlementRulesFor(
    (await crises.findOne({ _id: crisisId }, { projection: { rules: 1 } })) ?? {}
  );
  if (!rules.escalationEnabled) {
    return fail(403, "The escalation ladder is switched off for this question.");
  }

  // Guarded claim. Restates BOTH preconditions: still open, still armed. A tick
  // that decayed the heat between the read and the write cancels the
  // declaration, which is the point of decay.
  const claimed = await crises.updateOne(
    {
      _id: crisisId,
      status: "open",
      "ladder.heat": ARMED_RUNG,
      // Restated as a filter clause as well as read above: the tick zeroes heat
      // while the ladder is off, but an admin can switch it off between a
      // still-armed tick and this press.
      "rules.escalationEnabled": { $ne: false },
    },
    { $set: { status: "frozen", updatedAt: new Date() } }
  );
  if (claimed.matchedCount !== 1) {
    return fail(409, "The ladder is no longer at the brink. Force the issue again first.");
  }

  const conflict = await createConflict(db, {
    id: `gq_de_${currentTurn}`,
    name: "The War for Germany",
    hostCountry: "DE",
    // Both Germanies are what the war is fought over, so both change hands with
    // it — the map anchor alone would leave the GDR out of its own war.
    hostEntities: ["DE", "DD"],
    type: "interstate",
    // `bloc` is not an input: `buildConflict` derives it from the two backers,
    // and west-vs-east already resolves to "contested".
    sideA: { label: "NATO", countries: west, kind: "coalition", backer: "west" },
    sideB: { label: "Warsaw Pact", countries: east, kind: "coalition", backer: "east" },
    createdBy: "event",
    startTurn: currentTurn,
  });

  await crises.updateOne(
    { _id: crisisId },
    { $set: { conflictId: conflict._id, updatedAt: new Date() } }
  );

  return { ok: true, conflictId: conflict._id, conflictNumber: conflict.conflictId };
}
