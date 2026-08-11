import type { SphereBounds } from "./types";

/**
 * Default transfer/market caps for sphere benefits.
 * Secondary market share defaults to 0 so only the primary receives market
 * contribution unless a preset explicitly raises the bound.
 */
export const DEFAULT_SPHERE_BOUNDS: Readonly<SphereBounds> = Object.freeze({
  secondaryMarketShare: 0,
  maxTotalSecondaryMarketShare: 0.25,
  maxAidPerTurn: 50,
  maxTributePerTurn: 40,
  maxSupportPerTurn: 30,
  maxTotalFlowsPerEntityPerTurn: 100,
});

export function clampShare(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clampNonNegative(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}
