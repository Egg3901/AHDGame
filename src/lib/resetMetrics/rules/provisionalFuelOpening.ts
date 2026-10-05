/** Provisional reset opening risk, never a substitute for a physical fuel ledger. */
import { primaryMetricById } from "../catalog";
import type { OpeningMetricObservation } from "./openingObservation";

export interface ProvisionalFuelOpeningInput {
  /** Game-calibrated net exposure to imported fuels, 0-100. */
  importExposurePercent: number;
  /** Modeled usable emergency buffer, in days. Not a verified stock count. */
  emergencyBufferDays: number;
  /** Game-calibrated source diversity, 0-100. */
  sourceDiversity: number;
}

export function provisionalFuelOpening(
  input: ProvisionalFuelOpeningInput
): OpeningMetricObservation {
  const metric = primaryMetricById("58");
  if (!metric) throw new Error("missing energy-security metric");
  const valid =
    Number.isFinite(input.importExposurePercent) &&
    input.importExposurePercent >= 0 &&
    input.importExposurePercent <= 100 &&
    Number.isFinite(input.emergencyBufferDays) &&
    input.emergencyBufferDays >= 0 &&
    Number.isFinite(input.sourceDiversity) &&
    input.sourceDiversity >= 0 &&
    input.sourceDiversity <= 100;
  // The 12-point floor represents domestic distribution/operational risk.
  // Emergency cover only reduces import-related exposure up to 90 days.
  const uncoveredDays = Math.max(0, 90 - input.emergencyBufferDays);
  const risk = valid
    ? Math.min(
        100,
        12 +
          0.62 * input.importExposurePercent +
          0.24 * (100 - input.sourceDiversity) +
          0.14 * (uncoveredDays / 90) * 100
      )
    : null;
  return {
    metricId: metric.id,
    path: metric.path,
    value: risk,
    status: risk === null ? "unavailable" : "proxy",
    source: risk === null ? "none" : "provisional 1991 game fuel-exposure fixture",
    owner: metric.owner,
    note:
      risk === null
        ? "Valid import exposure, emergency buffer, and source diversity inputs are required."
        : `Opening risk band only. Assumed import exposure ${input.importExposurePercent}%, usable buffer ${input.emergencyBufferDays} days, source diversity ${input.sourceDiversity}/100. These are game-calibrated assumptions, not a verified 1991 physical fuel ledger. The energy owner must replace this with measured stocks and flows before turn updates.`,
  };
}
