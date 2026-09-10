import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { seededRoll } from "@/lib/events/substrate/rng";
import {
  EXPOSURE_LENGTH_TURNS,
  HEAT_DETECTION_THRESHOLD,
  decayUndergroundHeat,
  isUnionExposed,
  rollUndergroundDetectionOutcome,
  undergroundDetectionChance,
  undergroundHeat,
} from "@/lib/unions/underground";

export interface UndergroundTurnResult {
  unionsChecked: number;
  newlyExposed: number;
}

/**
 * Illicit unions under ban, per-turn underground step. Runs for suspended
 * unions only (the legal pass skips them entirely):
 *
 * - Heat decays when idle (`lastUndergroundDriveTurn !== currentTurn`), so
 *   steady slow work stays dark and bursts get noticed.
 * - Each union at or above threshold rolls detection once per turn. The
 *   roll comes from the seeded RNG (`seededRoll`), never `Math.random()`,
 *   so turn replay stays deterministic.
 * - A hit exposes the union for `EXPOSURE_LENGTH_TURNS` turns. Exposure
 *   needs no decay write: `isUnionExposed` compares against the turn, so a
 *   union goes dark on its own once the window passes. No permanent flags.
 *
 * Writes only cells that actually changed, so a quiet ban costs no writes.
 */
export async function processUndergroundTurn(
  db: Db,
  currentTurn: number
): Promise<UndergroundTurnResult> {
  const docs = await db
    .collection<Union>("unions")
    .find(
      { suspended: true },
      { projection: { suspended: 1, heat: 1, exposedUntilTurn: 1, lastUndergroundDriveTurn: 1 } }
    )
    .toArray();
  // Filter client-side too: callers that ignore the filter (tests) must not
  // widen this onto legal unions.
  const cells = docs.filter((doc) => doc.suspended === true);
  if (cells.length === 0) {
    return { unionsChecked: 0, newlyExposed: 0 };
  }

  const now = new Date();
  const writes: { filter: object; update: object }[] = [];
  let newlyExposed = 0;

  for (const cell of cells) {
    const heat = undergroundHeat(cell);
    const droveThisTurn = cell.lastUndergroundDriveTurn === currentTurn;
    // Clamp on write: the command `$inc`s heat without clamping (contention
    // safety), so this is what caps runaway heat back to 100.
    const nextHeat = droveThisTurn ? heat : decayUndergroundHeat(heat);
    const set: Record<string, unknown> = {};
    if (nextHeat !== (typeof cell.heat === "number" ? cell.heat : 0)) {
      set.heat = nextHeat;
    }
    if (!isUnionExposed(cell, currentTurn) && nextHeat >= HEAT_DETECTION_THRESHOLD) {
      const chance = undergroundDetectionChance(nextHeat);
      const roll = seededRoll(
        cell._id.toString(),
        currentTurn,
        "underground-detection",
        "illicit-unions-v1"
      );
      if (rollUndergroundDetectionOutcome(chance, roll)) {
        set.exposedUntilTurn = currentTurn + EXPOSURE_LENGTH_TURNS - 1;
        newlyExposed += 1;
      }
    }
    if (Object.keys(set).length > 0) {
      writes.push({ filter: { _id: cell._id }, update: { $set: { ...set, updatedAt: now } } });
    }
  }

  if (writes.length > 0) {
    await db.collection<Union>("unions").bulkWrite(writes.map((write) => ({ updateOne: write })));
  }
  return { unionsChecked: cells.length, newlyExposed };
}
