export function computeStrengthVsReferencePercent(
  currentRate: number | null | undefined,
  referenceRate: number | null | undefined
): number {
  if (
    typeof currentRate !== "number" ||
    !Number.isFinite(currentRate) ||
    currentRate <= 0 ||
    typeof referenceRate !== "number" ||
    !Number.isFinite(referenceRate) ||
    referenceRate <= 0
  ) {
    return 0;
  }

  return (referenceRate / currentRate - 1) * 100;
}

export function computeRawRateVsReferencePercent(
  currentRate: number | null | undefined,
  referenceRate: number | null | undefined
): number {
  if (
    typeof currentRate !== "number" ||
    !Number.isFinite(currentRate) ||
    typeof referenceRate !== "number" ||
    !Number.isFinite(referenceRate) ||
    referenceRate === 0
  ) {
    return 0;
  }

  return ((currentRate - referenceRate) / referenceRate) * 100;
}
