/**
 * Monetary calibration moves between authored reference points as time advances.
 * interpolateMonetaryCalibration preserves exact anchors and modern fallbacks;
 * it does not enact policy or change actual inflation and interest rates.
 */
export interface MonetaryCalibration {
  targetInflation: number;
  neutralPrimeRate: number;
  trendGdpGrowth?: number;
}

export function interpolateMonetaryCalibration(
  left: MonetaryCalibration,
  right: MonetaryCalibration,
  fraction: number
): MonetaryCalibration {
  const weight = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (weight === 0) return { ...left };
  if (weight === 1) return { ...right };
  const blend = (a: number, b: number) => a * (1 - weight) + b * weight;
  return {
    targetInflation: blend(left.targetInflation, right.targetInflation),
    neutralPrimeRate: blend(left.neutralPrimeRate, right.neutralPrimeRate),
    ...(left.trendGdpGrowth != null || right.trendGdpGrowth != null
      ? { trendGdpGrowth: blend(left.trendGdpGrowth ?? 2.5, right.trendGdpGrowth ?? 2.5) }
      : {}),
  };
}
