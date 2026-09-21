/** Portable consequences of a country's 0..100 Democratic Health score. */

export const DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD = 60;
export const DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX = 0.2;
export const DEMOCRATIC_HEALTH_CURRENT_RULER_EXTRA_MAX = 0.1;
export const DEMOCRATIC_HEALTH_RELIEF_CAP_PCT = 75;
export const DEMOCRATIC_HEALTH_GDP_DRAG_MAX = 4;
export const DEMOCRATIC_HEALTH_SOVEREIGN_SPREAD_MAX = 2;
const DEMOCRATIC_HEALTH_SEVERITY_EXPONENT = 1.2;

export interface DemocraticHealthPressure {
  value: number;
  /** 0 at the threshold, 1 at zero health. */
  severity: number;
  /** Base multiplier reduction for every candidate in the ruling party. */
  partyPenalty: number;
  /** Total multiplier reduction for the current ruler. */
  currentRulerPenalty: number;
  /** Annual GDP-growth percentage points lost to institutional failure. */
  gdpGrowthDrag: number;
  /** Percentage points added to newly issued sovereign bond coupons. */
  sovereignSpread: number;
  /** Relief after clamping to the supported temporary-relief range. */
  reliefPct: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function democraticHealthPressure(value: number, reliefPct = 0): DemocraticHealthPressure {
  const safeValue = clamp(Number.isFinite(value) ? value : 50, 0, 100);
  const safeReliefPct = clamp(
    Number.isFinite(reliefPct) ? reliefPct : 0,
    0,
    DEMOCRATIC_HEALTH_RELIEF_CAP_PCT
  );
  const shortfall = clamp(
    (DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD - safeValue) / DEMOCRATIC_HEALTH_FALLOUT_THRESHOLD,
    0,
    1
  );
  const severity = Math.pow(shortfall, DEMOCRATIC_HEALTH_SEVERITY_EXPONENT);
  const partyPenalty = DEMOCRATIC_HEALTH_PARTY_PENALTY_MAX * severity;
  const currentRulerPenalty =
    partyPenalty + DEMOCRATIC_HEALTH_CURRENT_RULER_EXTRA_MAX * severity * (1 - safeReliefPct / 100);

  return {
    value: safeValue,
    severity,
    partyPenalty,
    currentRulerPenalty,
    gdpGrowthDrag: DEMOCRATIC_HEALTH_GDP_DRAG_MAX * severity,
    sovereignSpread: DEMOCRATIC_HEALTH_SOVEREIGN_SPREAD_MAX * severity,
    reliefPct: safeReliefPct,
  };
}

export function democraticHealthEconomicDrag(value: number): number {
  return democraticHealthPressure(value).gdpGrowthDrag;
}

export function democraticHealthSovereignSpread(value: number): number {
  return democraticHealthPressure(value).sovereignSpread;
}
