import type { Db } from "mongodb";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import { livingVietnamAsLegacyState } from "@/lib/livingConflict/vietnamCompat";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import {
  runTensionTurn,
  type ColdWarTensionState,
  type TensionPressures,
} from "@/lib/coldwar/tension";

/**
 * Turn phase for global cold-war tension: read the world's standing pressure
 * and relax the shared tension value toward the floor it implies.
 *
 * The pressures mirror what the dials layer reads. The Vietnam rung comes off
 * the same legacy/living-conflict selection `getColdWarDials` makes, so the
 * phase and the console can never disagree about which ladder is live. Active
 * crises and the world's total stockpile round out the floor: an armed,
 * embroiled world never reads calm, however long nobody tests anything.
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

  const [vietnam, activeCrises, programs] = await Promise.all([
    gameState.livingConflictsEnabled ? livingVietnamAsLegacyState(db) : getVietnamEscalation(db),
    db.collection("crises").countDocuments({ status: "active" }),
    listNuclearPrograms(db),
  ]);

  const pressures: TensionPressures = {
    escalationLevel: vietnam.level,
    activeCrises,
    totalWarheads: programs.reduce((sum, p) => sum + Math.max(0, p.warheads ?? 0), 0),
  };
  return runTensionTurn(db, turn, pressures);
}
