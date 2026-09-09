/**
 * Market liquidity follows economic money growth without repricing an existing
 * pool when the accounting method changes. Calibrate once, then scale only
 * between observations measured on the same basis.
 */
export function calibratedPoolTarget(input: {
  previousLiquidityTarget: number;
  previousM2?: number;
  previousVersion?: number;
  latestM2?: number;
  latestVersion?: number;
  share: number;
}): { liquidityTargetLocal: number; m2Local?: number; poolAccountingVersion?: number } {
  const previousTarget = Number.isFinite(input.previousLiquidityTarget)
    ? Math.max(0, input.previousLiquidityTarget)
    : 0;
  if (!(
    typeof input.latestM2 === "number" &&
    Number.isFinite(input.latestM2) &&
    input.latestM2 > 0
  )) {
    return { liquidityTargetLocal: previousTarget };
  }
  const version = input.latestVersion ?? 1;
  const previousVersion = input.previousVersion ?? 1;
  const comparable = version === previousVersion;
  const uncalibrated =
    input.previousVersion === undefined && input.previousM2 === undefined && previousTarget === 0;
  const target = uncalibrated
    ? input.latestM2 * input.share
    : !comparable
      ? previousTarget
      : version === 1
        ? input.latestM2 * input.share
        : typeof input.previousM2 === "number" &&
            Number.isFinite(input.previousM2) &&
            input.previousM2 > 0
          ? previousTarget * (input.latestM2 / input.previousM2)
          : previousTarget;
  return {
    liquidityTargetLocal: Math.round(target * 100) / 100,
    m2Local: input.latestM2,
    poolAccountingVersion: version,
  };
}

/** Legacy fallback for quotes; a stored calibrated allocation takes precedence. */
export function poolLiquidityAllocation(input: {
  calibratedTarget?: number;
  m2Local?: number;
  share: number;
  fallback: number;
}): number {
  if (typeof input.calibratedTarget === "number" && Number.isFinite(input.calibratedTarget))
    return Math.max(0, input.calibratedTarget);
  if (typeof input.m2Local === "number" && Number.isFinite(input.m2Local) && input.m2Local > 0)
    return input.m2Local * input.share;
  return Math.max(0, Number.isFinite(input.fallback) ? input.fallback : 0);
}
