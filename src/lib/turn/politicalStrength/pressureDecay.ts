import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { PartyStrengthPressure } from "@/lib/db/types";
import { PRESSURE_DECAY_PER_TURN } from "./strengthConstants";

/**
 * Per-geography PS pressure decay phase.
 *
 * Subtracts `PRESSURE_DECAY_PER_TURN` from every `partyStrengthPressure.value`,
 * floored at `0`. Rows that decay to `0` could be deleted, but keeping them
 * around is cheaper than re-inserting on the next spend in that geography
 * — pressure rows are thin (one number + a turn stamp) and the volume is
 * bounded by `(parties × states-they've-acted-in)`.
 *
 * See plan §"Phase 3 — Recommended" #4 (escalating PS action cost) and the
 * Phase 0.5 turn-order contract — this phase runs in the
 * `demographicsAndPartySetup` group AFTER `partyOrgTurn` and `regDriftDecay`.
 */
export interface PressureDecayResult {
  rowsScanned: number;
  rowsDecayed: number;
  rowsAtFloor: number;
}

export async function processPressureDecay(
  currentTurn: number,
  now: Date = new Date(),
  injectedDb?: Db
): Promise<PressureDecayResult> {
  const db = injectedDb ?? (await getDb());
  const col = db.collection<PartyStrengthPressure>("partyStrengthPressure");

  const result: PressureDecayResult = {
    rowsScanned: 0,
    rowsDecayed: 0,
    rowsAtFloor: 0,
  };

  // Only rows with positive value need work; rows already at 0 stay at 0.
  const rows = await col.find({ value: { $gt: 0 } }).toArray();
  result.rowsScanned = rows.length;
  if (rows.length === 0) return result;

  const ops = rows.map((row) => {
    const decayed = Math.max(0, row.value - PRESSURE_DECAY_PER_TURN);
    if (decayed === 0) result.rowsAtFloor += 1;
    return {
      updateOne: {
        filter: { _id: row._id },
        update: {
          $set: { value: decayed, lastUpdatedTurn: currentTurn, updatedAt: now },
        },
      },
    };
  });

  await col.bulkWrite(ops);
  result.rowsDecayed = ops.length;
  return result;
}
