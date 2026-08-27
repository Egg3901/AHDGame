import type { Db } from "mongodb";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import { livingVietnamAsLegacyState } from "@/lib/livingConflict/vietnamCompat";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import {
  nuclearArmedCountryIds,
  warPressures,
  type NuclearProgramPressureInput,
  type TensionPressures,
  type WarPressureInput,
  type WarPressureSummary,
} from "./tension";

export interface StandingPressureInputs {
  escalationLevel: number;
  activeCrises: number;
  programs: NuclearProgramPressureInput[];
  conflicts: WarPressureInput[];
}

export interface StandingPressureSnapshot {
  pressures: TensionPressures;
  warSummary: WarPressureSummary;
  totalWarheads: number;
}

/** Adapt the canonical conflict document to the pressure model in one place. */
export function conflictWarPressureInput(
  conflict: Pick<ConflictDoc, "sideA" | "sideB" | "intensity">
): WarPressureInput {
  return {
    sideACountries: conflict.sideA?.countries ?? [],
    sideBCountries: conflict.sideB?.countries ?? [],
    intensity: conflict.intensity ?? 0,
  };
}

/** Build the one strategic-pressure snapshot shared by the turn, UI, and seeds. */
export function buildStandingPressureSnapshot(
  input: StandingPressureInputs
): StandingPressureSnapshot {
  const totalWarheads = input.programs.reduce(
    (sum, program) => sum + Math.max(0, program.warheads),
    0
  );
  const warSummary = warPressures(input.conflicts, nuclearArmedCountryIds(input.programs));
  return {
    totalWarheads,
    warSummary,
    pressures: {
      escalationLevel: input.escalationLevel,
      activeCrises: input.activeCrises,
      totalWarheads,
      nuclearWarIntensity: warSummary.nuclearWarIntensity,
      nuclearWarCount: warSummary.nuclearWarCount,
      otherWarIntensity: warSummary.otherWarIntensity,
    },
  };
}

/** Read current standing pressure, including all active crises and conflicts. */
export async function readStandingPressureSnapshot(
  db: Db,
  gameState: { livingConflictsEnabled?: boolean }
): Promise<StandingPressureSnapshot> {
  const [vietnam, activeCrises, programs, conflicts] = await Promise.all([
    gameState.livingConflictsEnabled ? livingVietnamAsLegacyState(db) : getVietnamEscalation(db),
    db.collection("crises").countDocuments({ status: "active" }),
    listNuclearPrograms(db),
    listActiveConflicts(db),
  ]);
  return buildStandingPressureSnapshot({
    escalationLevel: vietnam.level,
    activeCrises,
    programs,
    conflicts: conflicts.map(conflictWarPressureInput),
  });
}
