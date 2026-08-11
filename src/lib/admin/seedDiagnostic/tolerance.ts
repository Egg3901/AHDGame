/**
 * Seed-diagnostic tolerance model (Mode B drift + shared helpers).
 *
 * All tuning constants live here. Conformance (Mode A) uses tight fixed
 * epsilons from this module; drift (Mode B) uses the turn-scaled curve.
 */

export type MetricClass =
  "population" | "gdp" | "debt" | "interest" | "inflation" | "forex" | "commodity" | "sector";

/** Calendar turns over which warn tolerance ramps from floor to ceiling. */
export const RAMP_TURNS = 480; // 10 game-years

/** Absolute magnitude-break ratio: actual > 3× or < 1/3 of expected → critical. */
export const MAGNITUDE_BREAK_RATIO = 3;

/** Conformance Mode A relative tolerance (1%). */
export const CONFORMANCE_REL_TOL = 0.01;

/**
 * Population-sum soft tolerance (3%). Region authored populations often round
 * differently from the national budget seed config — drift within this band is ok;
 * above it (but below the structural break) is WARN only.
 */
export const CONFORMANCE_POP_TOL = 0.03;

/**
 * Population-sum structural break (25%). Larger gaps (or zero/empty sums) indicate
 * missing regions, not ordinary dual-source authorship noise.
 */
export const CONFORMANCE_POP_STRUCTURAL_BREAK = 0.25;

/** Sector share conformance tolerance (2%) — used when comparing to era weights. */
export const CONFORMANCE_SECTOR_SHARE_TOL = 0.02;

/** Sanity ceiling for a single sector's revenue share at turn 1. */
export const CONFORMANCE_SECTOR_MAX_SHARE = 0.6;

const CLASS_MULT: Record<MetricClass, number> = {
  population: 0.25,
  gdp: 1.0,
  debt: 1.25,
  interest: 1.0, // unused for rates (absolute-point bands)
  inflation: 1.0, // unused for rates (absolute-point bands)
  forex: 1.5,
  commodity: 1.5,
  sector: 1.25,
};

/** Rate classes use absolute percentage-point bands instead of relative %. */
const RATE_CLASSES = new Set<MetricClass>(["interest", "inflation"]);

/** Warn band floor/ceiling at t=0 / t=RAMP (relative fraction, before classMult). */
const WARN_FLOOR = 0.15;
const WARN_CEILING = 0.4;

/** Base absolute-point warn band for interest/inflation (±3pts at t=0). */
const RATE_WARN_PTS_BASE = 3;

/**
 * Linear interpolate between a and b by t in [0,1].
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rampProgress(calendarTurn: number): number {
  const t = Math.max(0, calendarTurn);
  return Math.min(t, RAMP_TURNS) / RAMP_TURNS;
}

export function classMult(cls: MetricClass): number {
  return CLASS_MULT[cls];
}

/**
 * Relative warn tolerance (fraction of expected), e.g. 0.15 → 15%.
 * Not used for interest/inflation — see {@link rateWarnPts}.
 */
export function warnTol(calendarTurn: number, cls: MetricClass): number {
  if (RATE_CLASSES.has(cls)) {
    return rateWarnPts(calendarTurn) / 100;
  }
  return classMult(cls) * lerp(WARN_FLOOR, WARN_CEILING, rampProgress(calendarTurn));
}

export function criticalTol(calendarTurn: number, cls: MetricClass): number {
  return 2 * warnTol(calendarTurn, cls);
}

/**
 * Absolute percentage-point warn band for interest/inflation.
 * Base ±3pts at t=0, scaled by the same lerp(0.15, 0.40) ratio as relative
 * tolerances so later turns permit more drift. Critical is 2× (base ±6pts).
 */
export function rateWarnPts(calendarTurn: number): number {
  const scale = lerp(WARN_FLOOR, WARN_CEILING, rampProgress(calendarTurn)) / WARN_FLOOR;
  return RATE_WARN_PTS_BASE * scale;
}

export function rateCriticalPts(calendarTurn: number): number {
  return 2 * rateWarnPts(calendarTurn);
}

export interface DriftSeverityInput {
  actual: number;
  expected: number;
  calendarTurn: number;
  cls: MetricClass;
  /** Relative epsilon to avoid /0. */
  epsilon?: number;
}

export interface DriftSeverityResult {
  severity: "ok" | "warn" | "critical";
  driftPct: number;
  tolerancePct: number;
  note?: string;
}

/**
 * Classify drift of `actual` vs trajectory-adjusted `expected`.
 * Magnitude break (×3 / ÷3) always critical regardless of turn/class.
 */
export function classifyDrift(input: DriftSeverityInput): DriftSeverityResult {
  const { actual, expected, calendarTurn, cls } = input;
  const epsilon = input.epsilon ?? 1e-9;

  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    return {
      severity: "critical",
      driftPct: Number.POSITIVE_INFINITY,
      tolerancePct: 0,
      note: "non-finite actual or expected",
    };
  }

  const absExpected = Math.max(Math.abs(expected), epsilon);
  const driftPct = Math.abs(actual - expected) / absExpected;

  // Magnitude break — any turn, any class.
  if (Math.abs(expected) > epsilon) {
    const ratio = Math.abs(actual) / absExpected;
    if (ratio > MAGNITUDE_BREAK_RATIO || ratio < 1 / MAGNITUDE_BREAK_RATIO) {
      return {
        severity: "critical",
        driftPct,
        tolerancePct: criticalTol(calendarTurn, cls),
        note: "magnitude break",
      };
    }
  }

  if (RATE_CLASSES.has(cls)) {
    const absDriftPts = Math.abs(actual - expected);
    const warnPts = rateWarnPts(calendarTurn);
    const critPts = rateCriticalPts(calendarTurn);
    const severity = absDriftPts > critPts ? "critical" : absDriftPts > warnPts ? "warn" : "ok";
    return {
      severity,
      driftPct,
      tolerancePct: warnPts / 100,
    };
  }

  const warn = warnTol(calendarTurn, cls);
  const crit = criticalTol(calendarTurn, cls);
  const severity = driftPct > crit ? "critical" : driftPct > warn ? "warn" : "ok";
  return {
    severity,
    driftPct,
    tolerancePct: warn,
  };
}

/**
 * Compound a baseline value over `years` at an annual growth rate expressed as
 * a **percent** (e.g. 2.5 for 2.5%/yr, 0.8 for 0.8%/yr). Always divides by 100 —
 * do not pass a fraction.
 */
export function compoundAnnual(baseline: number, annualRatePercent: number, years: number): number {
  if (!Number.isFinite(baseline) || !Number.isFinite(years) || years <= 0) {
    return baseline;
  }
  if (!Number.isFinite(annualRatePercent)) return baseline;
  return baseline * Math.pow(1 + annualRatePercent / 100, years);
}

/** Calendar years from calendarTurn (48 turns / year). */
export function yearsFromCalendarTurn(calendarTurn: number, turnsPerYear = 48): number {
  return Math.max(0, calendarTurn) / turnsPerYear;
}

export function withinRelTol(
  actual: number,
  expected: number,
  tol: number = CONFORMANCE_REL_TOL,
  epsilon = 1e-9
): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const denom = Math.max(Math.abs(expected), epsilon);
  return Math.abs(actual - expected) / denom <= tol;
}
