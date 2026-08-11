import { metricCategories } from "@/lib/constants/metricDefinitions";
import { getEraBand, getIncomeAnchor, isMetricActive } from "@/lib/era/metricCatalog";
import { toUsd } from "./fxNormalize";

/**
 * Absolute metric scoring — converts a raw metric value to a 0–100 score
 * based on real-world benchmarks, independent of what other states/regions
 * are doing. Used for:
 *   1. National approval (so it isn't always ~50%)
 *   2. Per-metric quality badges shown in the UI
 *
 * Each threshold defines:
 *   best  — value that earns a score of 100 (excellent real-world performance)
 *   worst — value that earns a score of 0   (very poor real-world performance)
 *
 * Currency-valued metrics (medianIncome) are normalized to USD via base
 * exchange rates before scoring, so countries with weaker currencies aren't
 * unfairly inflated and strong-currency countries aren't penalized.
 */

interface ScoreThreshold {
  best: number;
  worst: number;
}

export const THRESHOLDS: Record<string, ScoreThreshold> = {
  // ── Economic ───────────────────────────────────────────────────────────────
  unemploymentRate: { best: 2, worst: 15 },
  medianIncome: { best: 90000, worst: 15000 },
  gdpGrowth: { best: 5, worst: -3 },
  wageGrowth: { best: 6, worst: -2 },
  tradeGrowth: { best: 5, worst: -5 },
  povertyRate: { best: 4, worst: 25 },
  costOfLiving: { best: 70, worst: 165 },
  smallBusinessFormation: { best: 8, worst: 1 },
  tradeBalance: { best: 8, worst: -8 },
  productivityGrowth: { best: 4, worst: -2 },
  rdIntensity: { best: 4.5, worst: 0.5 },
  exportDependency: { best: 30, worst: 55 },
  manufacturingCompetitiveness: { best: 90, worst: 40 },

  // ── Education ──────────────────────────────────────────────────────────────
  highSchoolGradRate: { best: 97, worst: 60 },
  universityEnrollment: { best: 85, worst: 25 },
  testPerformance: { best: 125, worst: 75 },
  educationSpending: { best: 15000, worst: 3000 },
  literacyRate: { best: 99, worst: 82 },
  workforceSkill: { best: 90, worst: 30 },
  apprenticeshipRate: { best: 6, worst: 1 },

  // ── Healthcare ─────────────────────────────────────────────────────────────
  uninsuredRate: { best: 0, worst: 22 },
  affordabilityIndex: { best: 90, worst: 30 },
  physicianRate: { best: 5, worst: 1 },
  lifeExpectancy: { best: 85, worst: 70 },
  preventableMortality: { best: 120, worst: 500 },
  publicHealthPreparedness: { best: 90, worst: 30 },

  // ── Infrastructure ─────────────────────────────────────────────────────────
  roadCondition: { best: 90, worst: 40 },
  broadbandAccess: { best: 99, worst: 50 },
  publicTransit: { best: 90, worst: 15 },
  waterQuality: { best: 99, worst: 70 },
  powerGridReliability: { best: 99.9, worst: 97 },
  infrastructureInvestmentGap: { best: 5, worst: 45 },

  // ── Public Safety ──────────────────────────────────────────────────────────
  crimeRate: { best: 1500, worst: 11000 },
  violentCrimeRate: { best: 80, worst: 700 },
  policePerCapita: { best: 5, worst: 1 },
  incarcerationRate: { best: 50, worst: 800 },
  recidivismRate: { best: 15, worst: 70 },
  publicSafetyConfidence: { best: 85, worst: 30 },
  firearmRights: { best: 90, worst: 10 }, // axis metric (P6d pattern)

  // ── Environment ────────────────────────────────────────────────────────────
  airQuality: { best: 8, worst: 80 },
  renewableEnergy: { best: 80, worst: 5 },
  carbonEmissions: { best: 3, worst: 25 },
  recyclingRate: { best: 70, worst: 10 },
  climateResilience: { best: 90, worst: 30 },
  protectedLand: { best: 50, worst: 3 },
  energyTransitionProgress: { best: 90, worst: 20 },

  // ── Social ─────────────────────────────────────────────────────────────────
  economicFreedom: { best: 85, worst: 25 }, // P6a
  regulatoryBurden: { best: 20, worst: 80 }, // P6a
  socialMobility: { best: 80, worst: 20 },
  incomeInequality: { best: 24, worst: 55 }, // Gini-100 (P3a unit unification)
  homelessnessRate: { best: 2, worst: 55 },
  housingAffordability: { best: 15, worst: 70 }, // pressure index (P3d unit repair), lower better
  foodInsecurity: { best: 4, worst: 22 },
  civicParticipation: { best: 80, worst: 30 },
  socialCohesion: { best: 85, worst: 30 },
  housingSupplyGrowth: { best: 5, worst: -1 },

  // ── Governance ─────────────────────────────────────────────────────────────
  governmentTransparency: { best: 90, worst: 30 },
  budgetBalance: { best: 3, worst: -8 },
  debtToGdp: { best: 20, worst: 140 },
  corruptionIndex: { best: 10, worst: 70 },
  voterTurnout: { best: 85, worst: 30 },
  publicTrust: { best: 80, worst: 20 },
  // P6a axis metrics (approval-excluded until the P6d cutover).
  civilLiberties: { best: 85, worst: 25 },
  nationalPride: { best: 80, worst: 30 },
  militaryReadiness: { best: 85, worst: 25 },
  borderSecurity: { best: 85, worst: 20 }, // axis metric (P6d pattern)
  coDeterminationQuality: { best: 85, worst: 30 },

  // ── Population ─────────────────────────────────────────────────────────────
  // These thresholds drive per-metric UI quality badges only. populationGrowth and
  // medianAge are engine-derived stocks EXCLUDED from approval scoring in
  // governmentApproval.APPROVAL_EXCLUDED_METRICS (§4.7 audit-P2 — their economic
  // consequences already reach approval via the economic metrics; medianAge's
  // exclusion also neutralizes secular-aging approval drift). migrationRate keeps
  // its approval term (policy lever / coexistence wedge). NOTE: the negative
  // `worst` values become reachable once the §8.1 bounds floor is fixed — run a
  // balance pass on these ranges then (newly-activated, never balanced).
  populationGrowth: { best: 2, worst: -1 },
  urbanizationRate: { best: 92, worst: 25 },
  medianAge: { best: 30, worst: 52 },
  migrationRate: { best: 2, worst: -1.5 },

  // ── Media & Information ────────────────────────────────────────────────────
  mediaPolarization: { best: 10, worst: 80 },
  stateMediaControl: { best: 10, worst: 85 }, // P6a (libertarian-flavored default direction)
  disinformationRisk: { best: 10, worst: 70 },
  pressFreedom: { best: 92, worst: 25 },
  socialMediaSentiment: { best: 15, worst: -15 },
  newsTrust: { best: 80, worst: 20 },
};

/**
 * Direction map derived from the metricDefinitions SSOT (P6a). The previous
 * hand-maintained literal silently OMITTED ~63 metrics — and approval's
 * `?? true` fallback then scored 24 lower-is-better metrics INVERTED
 * (childPoverty, knifeCrimeRate, floodRisk, nhsWaitingTime,
 * housingAffordability, roughSleeping, independenceDesire, …): approval was
 * rewarding child poverty and knife crime wherever those metrics were stored.
 * Deriving from the definitions makes omission impossible.
 */
export const IS_HIGHER_BETTER: Record<string, boolean> = Object.fromEntries(
  metricCategories.flatMap((category) =>
    category.metrics.map((metric) => [metric.id, metric.isHigherBetter])
  )
);

/**
 * Metrics whose raw values are in local currency and (when no more specific
 * scheme applies) need USD normalization. `medianIncome` is handled by the
 * per-country scheme below, so it is intentionally NOT here.
 */
const CURRENCY_METRICS = new Set<string>();

/**
 * Per-country median-income best/worst, in **local currency**, calibrated to
 * each country's realistic in-game income scale (modern preset). Median income
 * is scored against its own country's range rather than a single USD standard,
 * so a country near its national median reads ~"Good" regardless of currency.
 * Derived from the seed median-income scales (best ≈ median ×1.25, worst ≈
 * ×0.45). Unknown countries fall back to the global `THRESHOLDS.medianIncome`.
 */
export const MEDIAN_INCOME_THRESHOLDS: Record<string, ScoreThreshold> = {
  US: { best: 90_000, worst: 32_000 },
  UK: { best: 44_000, worst: 16_000 },
  DE: { best: 62_000, worst: 22_000 },
  IE: { best: 52_000, worst: 19_000 },
  JP: { best: 5_500_000, worst: 2_000_000 },
  BR: { best: 35_000, worst: 13_000 },
  CN: { best: 125_000, worst: 45_000 },
  NG: { best: 1_500_000, worst: 540_000 },
};

/**
 * LEGACY (flag-off) 1991 income scaling: 1991-preset nominal incomes run well
 * below modern levels, so the band scales down for 1991 games. Kept verbatim
 * for flag-off parity ONLY — with the era system on, the band comes from
 * INCOME_ANCHORS × incomeBandIndex (getMetricThreshold) and no preset-string
 * logic runs. Seeds now derive their income LEVEL from INCOME_ANCHORS too.
 */
const ERA_1991_INCOME_RATIO = 0.4;

function medianIncomeThreshold(
  countryId: string | undefined,
  preset: string | undefined
): ScoreThreshold {
  const base = (countryId && MEDIAN_INCOME_THRESHOLDS[countryId]) || THRESHOLDS.medianIncome;
  if (preset?.startsWith("1991")) {
    return { best: base.best * ERA_1991_INCOME_RATIO, worst: base.worst * ERA_1991_INCOME_RATIO };
  }
  return base;
}

/**
 * Income-band shape: best/worst as multiples of the era income anchor.
 * Mirrors the derivation of MEDIAN_INCOME_THRESHOLDS (best ≈ median ×1.25,
 * worst ≈ ×0.45), so flag-on and flag-off bands share one geometry.
 */
const INCOME_BAND_SHAPE = { best: 1.25, worst: 0.45 };

/**
 * Effective best/worst band for a metric. Use this (not `THRESHOLDS` directly)
 * wherever the band is displayed, so the shown target/worst matches what
 * scoring actually uses. Returns null when no band is defined.
 *
 * Flag ON (`year` set): the era catalog's absolute per-country curves win
 * (country anchors → global anchors → static band). medianIncome composes
 * anchor(country, startingYear) × INCOME_BAND_SHAPE × incomeBandIndex — the
 * band follows the economy the players built, never the calendar; when the
 * index or anchor is unavailable it falls back to the FULL legacy band (never
 * a half-era band).
 *
 * Flag OFF (`year` null/undefined): byte-identical legacy behavior, including
 * the per-country medianIncome band and its preset ×0.4 scaling.
 */
export function getMetricThreshold(
  metricId: string,
  countryId?: string,
  preset?: string,
  year?: number | null,
  incomeIndex?: number | null,
  startingYear?: number | null
): ScoreThreshold | null {
  if (metricId === "medianIncome") {
    if (year != null && incomeIndex != null && Number.isFinite(incomeIndex) && incomeIndex > 0) {
      const anchor = getIncomeAnchor(countryId, startingYear ?? null);
      if (anchor != null) {
        return {
          best: anchor * INCOME_BAND_SHAPE.best * incomeIndex,
          worst: anchor * INCOME_BAND_SHAPE.worst * incomeIndex,
        };
      }
    }
    return medianIncomeThreshold(countryId, preset);
  }
  const era = getEraBand(metricId, countryId, year ?? null);
  if (era) return era;
  return THRESHOLDS[metricId] ?? null;
}

function applyThreshold(value: number, t: ScoreThreshold, higherBetter: boolean): number {
  const range = t.best - t.worst;
  if (Math.abs(range) < 1e-9) return 50;
  const raw = higherBetter
    ? ((value - t.worst) / range) * 100
    : ((t.worst - value) / (t.worst - t.best)) * 100;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Score a single metric value on an absolute 0–100 scale.
 * Returns null if no threshold is defined for the metric.
 *
 * `countryId` selects the per-country median-income band (and USD-normalizes any
 * other currency metric); `preset` ("1991-default" / "2019-default") scales the
 * median-income band to the era.
 */
export function scoreMetric(
  metricId: string,
  value: number,
  countryId?: string,
  preset?: string,
  year?: number | null,
  incomeIndex?: number | null,
  startingYear?: number | null
): number | null {
  // Era existence gate: an inactive metric scores null everywhere (callers
  // already skip null scores). year null (flag off) ⇒ always active.
  if (!isMetricActive(metricId, countryId, year ?? null)) return null;
  const t = getMetricThreshold(metricId, countryId, preset, year, incomeIndex, startingYear);
  if (!t) return null;

  const higherBetter = IS_HIGHER_BETTER[metricId] ?? true;

  // medianIncome is scored in local currency against its per-country band;
  // any other (future) currency metric normalizes to USD first.
  const v =
    metricId !== "medianIncome" && countryId && CURRENCY_METRICS.has(metricId)
      ? toUsd(value, countryId)
      : value;
  return applyThreshold(v, t, higherBetter);
}

export type BadgeTier = "Excellent" | "Very Good" | "Good" | "Fair" | "Bad" | "Very Bad";

export interface MetricBadge {
  label: BadgeTier;
  /** Tailwind bg + text classes */
  className: string;
}

export function getMetricBadge(score: number): MetricBadge {
  if (score >= 90)
    return { label: "Excellent", className: "bg-teal-500/20 text-teal-400 border-teal-500/30" };
  if (score >= 75)
    return { label: "Very Good", className: "bg-green-500/20 text-green-400 border-green-500/30" };
  if (score >= 55)
    return { label: "Good", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
  if (score >= 40)
    return { label: "Fair", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25" };
  if (score >= 20)
    return { label: "Bad", className: "bg-orange-500/15 text-orange-400 border-orange-500/25" };
  return { label: "Very Bad", className: "bg-red-500/20 text-red-400 border-red-500/30" };
}

/**
 * Score all metrics in a category map and return the average 0–100.
 * Skips metrics with no defined threshold.
 */
export function scoreMetricMap(categoryMap: Record<string, Record<string, number>>): number {
  let sum = 0;
  let count = 0;
  for (const [, metrics] of Object.entries(categoryMap)) {
    for (const [metricId, value] of Object.entries(metrics)) {
      const s = scoreMetric(metricId, value);
      if (s !== null) {
        sum += s;
        count++;
      }
    }
  }
  return count === 0 ? 50 : sum / count;
}
