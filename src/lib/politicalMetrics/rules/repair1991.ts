import type { PoliticalMetricId, PoliticalMetricsCountryId } from "../types";
import { NATIONAL_BASELINES_1979 } from "../seeds/nationalBaselines1979";
import { NATIONAL_BASELINES_1991 } from "../seeds/nationalBaselines1991";
import { REGIONAL_TEXTURE_1991 } from "../seeds/regionalTexture1991";

export const POLITICAL_OPENING_1991_VERSION = "1991-v1-2026-10-05";
export const RESET_RUNTIME_FIELDS = [
  "cabinetResiduals",
  "cabinetResidualsBySource",
  "labourResiduals",
  "livingConflictResiduals",
  "appliedEventEffects",
] as const;
export interface RepairPoliticalBoard {
  _id: string;
  countryId: string;
  values: Record<PoliticalMetricId, number>;
  residuals?: Record<PoliticalMetricId, number>;
  politicalOpeningVersion?: string;
}

/** Shift the opening, preserving the region's existing changes and structural target gap. */
export function planPoliticalOpening1991(doc: RepairPoliticalBoard): {
  values: Record<PoliticalMetricId, number>;
  residuals?: Record<PoliticalMetricId, number>;
  politicalOpeningVersion: string;
} | null {
  if (doc.politicalOpeningVersion === POLITICAL_OPENING_1991_VERSION) return null;
  if (!["US", "UK", "RU"].includes(doc.countryId)) return null;
  const cc = doc.countryId as PoliticalMetricsCountryId;
  const values = {} as Record<PoliticalMetricId, number>;
  const residuals = doc.residuals ? { ...doc.residuals } : undefined;
  const texture = REGIONAL_TEXTURE_1991[cc]?.[doc._id] ?? {};
  for (const [key, baseline] of Object.entries(NATIONAL_BASELINES_1991[cc])) {
    const id = key as PoliticalMetricId;
    const before = doc.values[id];
    if (!Number.isFinite(before)) throw new Error(`Invalid political value ${cc}:${doc._id}:${id}`);
    const change = baseline + (texture[id] ?? 0) - NATIONAL_BASELINES_1979[cc][id];
    values[id] = Math.max(0, Math.min(100, before + change));
    // Include any boundary clipping in the residual change, so the repaired
    // score retains exactly its previous distance from the structural target.
    if (residuals) {
      if (!Number.isFinite(residuals[id]))
        throw new Error(`Invalid residual ${cc}:${doc._id}:${id}`);
      residuals[id] += values[id] - before;
    }
  }
  return {
    values,
    ...(residuals ? { residuals } : {}),
    politicalOpeningVersion: POLITICAL_OPENING_1991_VERSION,
  };
}
