/** Portable, game-calibrated health access proxies until service ledgers exist. */
export interface LiveHealthProxyInput {
  countryId: "US" | "UK" | "JP" | "IE" | "SCO" | "WAL";
  uninsuredPercent: number | null;
  physicianRate: number | null;
  preparedness: number | null;
  openingPhysicianReference: number;
  openingPreparednessReference: number;
}

export interface LiveHealthProxyResult {
  effectiveCoverage: number;
  treatmentDelayIndex: number;
}

function valid(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * The 1991 service-reach proxy is held to a fixed country opening reference.
 * Recomputing a new country mean each turn would cancel nationwide progress.
 */
export function liveHealthProxies(input: LiveHealthProxyInput): LiveHealthProxyResult | null {
  if (
    !valid(input.physicianRate) ||
    input.physicianRate <= 0 ||
    !valid(input.preparedness) ||
    input.preparedness <= 0 ||
    !Number.isFinite(input.openingPhysicianReference) ||
    input.openingPhysicianReference <= 0 ||
    !Number.isFinite(input.openingPreparednessReference) ||
    input.openingPreparednessReference <= 0
  ) {
    return null;
  }
  if (
    input.countryId === "US" &&
    (!valid(input.uninsuredPercent) || input.uninsuredPercent < 0 || input.uninsuredPercent > 100)
  ) {
    return null;
  }
  const physicianRatio = input.physicianRate / input.openingPhysicianReference;
  const preparednessRatio = input.preparedness / input.openingPreparednessReference;
  const serviceReach = clamp(
    94 + 20 * (0.6 * physicianRatio + 0.4 * preparednessRatio - 1),
    75,
    100
  );
  const eligibility = input.countryId === "US" ? clamp(100 - input.uninsuredPercent!, 0, 100) : 100;
  return {
    effectiveCoverage: Math.min(eligibility, serviceReach),
    treatmentDelayIndex: clamp(
      20 / Math.pow(physicianRatio, 0.6) / Math.pow(preparednessRatio, 0.4),
      5,
      60
    ),
  };
}
