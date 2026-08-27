import type { Db } from "mongodb";
import { runTensionTurn, type ColdWarTensionState } from "@/lib/coldwar/tension";
import { readStandingPressureSnapshot } from "@/lib/coldwar/standingPressure";

/**
 * Turn phase for global cold-war tension: read the world's standing pressure
 * and relax the shared tension value toward the floor it implies.
 *
 * The pressures mirror what the dials layer reads. The Vietnam rung comes off
 * the same legacy/living-conflict selection `getColdWarDials` makes, so the
 * phase and the console can never disagree about which ladder is live. Active
 * crises, the world's total stockpile, and the wars on the Conflicts board
 * round out the floor: an armed, embroiled world never reads calm, however
 * long nobody tests anything. A war between nuclear-armed coalitions reads
 * CRISIS at minimum, not "elevated".
 *
 * Gated on `gameState.coldWarEnabled`; a world with the subsystem off skips
 * without touching the tension document at all.
 */
export async function processColdWarTensionTurn(
  db: Db,
  turn: number,
  gameState: { coldWarEnabled?: boolean; livingConflictsEnabled?: boolean }
): Promise<ColdWarTensionState | null> {
  if (gameState.coldWarEnabled !== true) return null;

  const snapshot = await readStandingPressureSnapshot(db, gameState, turn);
  return runTensionTurn(db, turn, snapshot.pressures);
}
