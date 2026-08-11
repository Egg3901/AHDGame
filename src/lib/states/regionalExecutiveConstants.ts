import type { RegionalExecutiveSign } from "./regionalExecutive";

/**
 * Tenure thresholds (in turns) that promote a regional executive's modifier
 * band. Turn length is config-tunable (`gameConfig.turnLengthMinutes`), so
 * durations are expressed in turns, not hours. Defaults assume hourly turns:
 * Moderate ≈ 1 week, Strong ≈ 1 month. Tune-later — see the design doc §7.
 */
export const REGIONAL_EXEC_MODERATE_TURNS = 168 as const;
export const REGIONAL_EXEC_STRONG_TURNS = 720 as const;

/**
 * Map continuous tenure (in turns) to the discrete modifier band.
 * Light (1) when freshly elected, Moderate (2) after the moderate threshold,
 * Strong (3) after the strong threshold. Non-finite / negative input → Light.
 */
export function regionalExecutiveSignForTenure(tenureTurns: number): RegionalExecutiveSign {
  if (!Number.isFinite(tenureTurns) || tenureTurns < REGIONAL_EXEC_MODERATE_TURNS) return 1;
  if (tenureTurns < REGIONAL_EXEC_STRONG_TURNS) return 2;
  return 3;
}
