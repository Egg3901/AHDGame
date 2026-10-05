import type { ResetLawProgramDocument } from "../program";

export interface LawProgramDelivery {
  familyId: string;
  implementationFactor: number;
}

export interface CombinedLawMetricEffect {
  metricId: string;
  favorableNormalizedPoints: number;
  contributingPrograms: string[];
}

/**
 * Portable read model for enacted-law pressure on outcomes. The observed metric
 * remains owned by its source system; this is a transparent modeled influence,
 * scaled by the program's last funded delivery.
 */
export function combineLawProgramEffects(
  programs: readonly Pick<ResetLawProgramDocument, "familyId" | "primaryMetricEffects">[],
  delivery: readonly LawProgramDelivery[]
): CombinedLawMetricEffect[] {
  const deliveryByFamily = new Map(delivery.map((row) => [row.familyId, row.implementationFactor]));
  const combined = new Map<string, CombinedLawMetricEffect>();
  for (const program of programs) {
    const factor = deliveryByFamily.get(program.familyId) ?? 0;
    if (!Number.isFinite(factor) || factor < 0 || factor > 1) {
      throw new Error(`Invalid implementation factor for ${program.familyId}`);
    }
    if (factor === 0) continue;
    for (const effect of program.primaryMetricEffects) {
      if (!/^\d{2}$/.test(effect.metricId) || !Number.isFinite(effect.favorableNormalizedPoints)) {
        throw new Error(`Invalid metric effect for ${program.familyId}`);
      }
      const current = combined.get(effect.metricId) ?? {
        metricId: effect.metricId,
        favorableNormalizedPoints: 0,
        contributingPrograms: [],
      };
      current.favorableNormalizedPoints += effect.favorableNormalizedPoints * factor;
      if (!current.contributingPrograms.includes(program.familyId)) {
        current.contributingPrograms.push(program.familyId);
      }
      combined.set(effect.metricId, current);
    }
  }
  return [...combined.values()]
    .map((effect) => ({
      ...effect,
      favorableNormalizedPoints: Math.max(
        -1,
        Math.min(1, Number(effect.favorableNormalizedPoints.toFixed(4)))
      ),
      contributingPrograms: [...effect.contributingPrograms].sort(),
    }))
    .sort((a, b) => a.metricId.localeCompare(b.metricId));
}
