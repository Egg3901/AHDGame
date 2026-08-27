import type { Db } from "mongodb";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import { livingVietnamAsLegacyState } from "@/lib/livingConflict/vietnamCompat";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import {
  nuclearArmedCountryIds,
  runTensionTurn,
  warPressures,
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

  const [vietnam, activeCrises, programs, conflicts] = await Promise.all([
    gameState.livingConflictsEnabled ? livingVietnamAsLegacyState(db) : getVietnamEscalation(db),
    db.collection("crises").countDocuments({ status: "active", globalResponse: { $exists: true } }),
    listNuclearPrograms(db),
    listActiveConflicts(db),
  ]);

  const warSummary = warPressures(
    conflicts.map((conflict) => ({
      sideACountries: conflict.sideA?.countries ?? [],
      sideBCountries: conflict.sideB?.countries ?? [],
      intensity: conflict.intensity ?? 0,
    })),
    nuclearArmedCountryIds(programs)
  );
  const pressures: TensionPressures = {
    escalationLevel: vietnam.level,
    activeCrises,
    totalWarheads: programs.reduce((sum, p) => sum + Math.max(0, p.warheads ?? 0), 0),
    nuclearWarIntensity: warSummary.nuclearWarIntensity,
    otherWarIntensity: warSummary.otherWarIntensity,
  };
  return runTensionTurn(db, turn, pressures);
}
