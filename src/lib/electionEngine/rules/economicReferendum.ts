/**
 * Inflation's economic referendum penalty. The country target centers a fixed-width
 * neutral band; missing targets retain the legacy band. See calculateInflationPenalty.
 */

export const INFLATION_BAND_PCT: readonly [number, number] = [1, 4];
export const INFLATION_SLOPE = 0.4;
export const INFLATION_CAP = 3;

export interface InflationPenalty {
  excessPct: number;
  contributionPts: number;
}

/** Calculate the portable inflation component from plain values. */
export function calculateInflationPenalty(
  inflationRatePct: number,
  inflationTargetPct?: number
): InflationPenalty {
  const targetIsValid =
    typeof inflationTargetPct === "number" && Number.isFinite(inflationTargetPct);
  const band: readonly [number, number] = targetIsValid
    ? [
        inflationTargetPct - (INFLATION_BAND_PCT[1] - INFLATION_BAND_PCT[0]) / 2,
        inflationTargetPct + (INFLATION_BAND_PCT[1] - INFLATION_BAND_PCT[0]) / 2,
      ]
    : INFLATION_BAND_PCT;
  const excessPct =
    inflationRatePct > band[1]
      ? inflationRatePct - band[1]
      : inflationRatePct < band[0]
        ? band[0] - inflationRatePct
        : 0;

  return {
    excessPct,
    contributionPts:
      excessPct === 0
        ? 0
        : Math.max(-INFLATION_CAP, Math.min(INFLATION_CAP, -INFLATION_SLOPE * excessPct)),
  };
}
