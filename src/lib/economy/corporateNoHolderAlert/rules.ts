import type { EconomicVitalSigns } from "@/lib/db/types/economicVitalSigns";

/**
 * Observation-only corporate bond-holder alert for issue #968.
 *
 * Consumes the rolling median produced upstream
 * (`securitiesRecent12.corporateNoHolderBondShareMedian`) and checks it
 * against the issue's explicit target. This module derives a warning only:
 * it performs no reads, stores nothing, and triggers no gameplay effect or
 * automated intervention. Deleting it leaves no trace in the data.
 */

/** Issue #968 target: active bond issues with no holder below 35%. */
export const CORPORATE_NO_HOLDER_BOND_SHARE_TARGET = 0.35;

/**
 * Minimum rolling-median observations before the alert trusts the series.
 * With 3+ turns a single-turn spike cannot dictate the median: it stays
 * within the range of the genuine turns, while a 1-observation median IS the
 * spike and a 2-observation median splits the difference. Anything thinner
 * reports insufficient data instead of warning or clearing.
 */
export const CORPORATE_NO_HOLDER_MEDIAN_MIN_OBSERVATIONS = 3;

export type CorporateNoHolderAlertStatus = "within-target" | "above-target" | "insufficient-data";

export interface CorporateNoHolderAlert {
  status: CorporateNoHolderAlertStatus;
  /** True only when the rolling median misses the target. Never triggers action. */
  warn: boolean;
  threshold: typeof CORPORATE_NO_HOLDER_BOND_SHARE_TARGET;
  median: number | null;
  observations: number;
  basis: string;
  reasons: string[];
}

/**
 * The snapshot slice the alert reads. The median is optional on purpose:
 * snapshots persisted before the corporate leg existed carry no such field,
 * and those older snapshots must fail closed, not read as dispersed holders.
 */
export interface CorporateNoHolderAlertInput {
  turn: number;
  securitiesRecent12?: {
    corporateNoHolderBondShareMedian?:
      EconomicVitalSigns["securitiesRecent12"]["corporateNoHolderBondShareMedian"] | null;
  } | null;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function insufficient(observations: number, basis: string, reason: string): CorporateNoHolderAlert {
  return {
    status: "insufficient-data",
    warn: false,
    threshold: CORPORATE_NO_HOLDER_BOND_SHARE_TARGET,
    median: null,
    observations,
    basis,
    reasons: [reason],
  };
}

/**
 * Evaluate the corporate no-holder warning from an already-loaded snapshot.
 * Fail-closed: null, non-finite, thin, or absent medians report
 * insufficient data with warn false, never a warning and never a clear.
 * The target is strictly below 35%, so a median exactly at the threshold
 * still warns.
 */
export function evaluateCorporateNoHolderAlert(
  snapshot: CorporateNoHolderAlertInput | null | undefined
): CorporateNoHolderAlert {
  const median = snapshot?.securitiesRecent12?.corporateNoHolderBondShareMedian ?? null;
  if (median == null) {
    return insufficient(
      0,
      "corporate_no_holder_rolling_median_unavailable",
      snapshot == null ? "snapshot_unavailable" : "corporate_no_holder_median_unavailable"
    );
  }
  const observations = median.observations ?? 0;
  if (!finite(median.value)) {
    return insufficient(observations, median.basis, "corporate_no_holder_median_null");
  }
  if (observations < CORPORATE_NO_HOLDER_MEDIAN_MIN_OBSERVATIONS) {
    return insufficient(
      observations,
      median.basis,
      "corporate_no_holder_median_insufficient_history"
    );
  }
  if (median.value >= CORPORATE_NO_HOLDER_BOND_SHARE_TARGET) {
    return {
      status: "above-target",
      warn: true,
      threshold: CORPORATE_NO_HOLDER_BOND_SHARE_TARGET,
      median: median.value,
      observations,
      basis: median.basis,
      reasons: ["corporate_no_holder_median_at_or_above_target"],
    };
  }
  return {
    status: "within-target",
    warn: false,
    threshold: CORPORATE_NO_HOLDER_BOND_SHARE_TARGET,
    median: median.value,
    observations,
    basis: median.basis,
    reasons: ["corporate_no_holder_median_within_target"],
  };
}

/**
 * One-line reporting projection for admin and sim consumers. Pure string
 * formatting over the evaluated alert; it adds no metric and reads nothing.
 */
export function summarizeCorporateNoHolderAlert(alert: CorporateNoHolderAlert): string {
  const targetPct = (alert.threshold * 100).toFixed(0);
  if (alert.status === "insufficient-data") {
    return (
      `corporate no-holder median unavailable ` +
      `(${alert.reasons.join(", ")}, ${alert.observations} obs) against ${targetPct}% target`
    );
  }
  const medianPct = alert.median == null ? "null" : `${(alert.median * 100).toFixed(1)}%`;
  return (
    `corporate no-holder median ${medianPct} (${alert.observations} obs) ` +
    `${alert.status === "above-target" ? "at or above" : "below"} ${targetPct}% target`
  );
}
