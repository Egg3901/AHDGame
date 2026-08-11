// src/lib/constants/cabinetMetrics.ts

import type { MetricCategoryId } from "@/lib/db/types";
import { getCabinetMechanics } from "./cabinetMechanics";
import { COUNTRY_CONFIGS } from "./countries";
import { getMetricDefinition } from "./metricDefinitions";
import { THRESHOLDS } from "@/lib/utils/metricScoring";

export type MetricFormat = "percent" | "index" | "rate" | "years" | "number" | "currency" | "score";

export interface CabinetMetricEntry {
  category: string;
  metricId: string;
  label: string;
  higherIsBetter: boolean;
  format: MetricFormat;
  range: { min: number; max: number };
}

interface CabinetMetricMapping {
  countryId: string;
  positionId: string;
  metrics: CabinetMetricEntry[];
}

function getFallbackMetricRange(
  countryId: string,
  format: MetricFormat
): { min: number; max: number } {
  switch (format) {
    case "percent":
      return { min: 0, max: 100 };
    case "years":
      return { min: 50, max: 100 };
    case "currency":
      return countryId === COUNTRY_CONFIGS.JP.id
        ? { min: 0, max: 10_000_000 }
        : { min: 0, max: 100_000 };
    case "rate":
      return { min: 0, max: 100 };
    case "score":
    case "index":
    case "number":
    default:
      return { min: 0, max: 100 };
  }
}

function getEntryFormat(explicitFormat: string, category: string, metricId: string): MetricFormat {
  if (explicitFormat === "currency") return "currency";
  if (
    explicitFormat === "percent" ||
    explicitFormat === "index" ||
    explicitFormat === "rate" ||
    explicitFormat === "years" ||
    explicitFormat === "number" ||
    explicitFormat === "score"
  ) {
    return explicitFormat;
  }

  const definition = getMetricDefinition(category as MetricCategoryId, metricId);
  switch (definition?.unit) {
    case "currency":
      return "currency";
    case "percent":
      return "percent";
    case "rate":
      return "rate";
    case "years":
      return "years";
    case "score":
      return "score";
    case "index":
    default:
      return "index";
  }
}

function buildMetricsFromMechanics(countryId: string, positionId: string): CabinetMetricEntry[] {
  const mechanics = getCabinetMechanics(countryId, positionId);
  if (!mechanics) return [];

  return mechanics.nationalMetrics.map((metric) => {
    const definition = getMetricDefinition(metric.category as MetricCategoryId, metric.metricId);
    const format = getEntryFormat(metric.format, metric.category, metric.metricId);
    const fallbackRange = getFallbackMetricRange(countryId, format);
    // The briefing bar normalizes the value over this range, so it must be the
    // metric's REALISTIC span (THRESHOLDS best/worst), not its safety bounds —
    // S1 widened several bounds to headroom ceilings (e.g. educationSpending
    // [0, 10M]) that would pin the bar to ~0%. Fall back to bounds when a metric
    // has no threshold. Direction is handled by `higherIsBetter` downstream.
    const threshold = THRESHOLDS[metric.metricId];
    const range = threshold
      ? {
          min: Math.min(threshold.best, threshold.worst),
          max: Math.max(threshold.best, threshold.worst),
        }
      : {
          min: definition?.minValue ?? fallbackRange.min,
          max: definition?.maxValue ?? fallbackRange.max,
        };
    return {
      category: metric.category,
      metricId: metric.metricId,
      label: metric.label,
      higherIsBetter: metric.higherIsBetter,
      format,
      range,
    };
  });
}

export const CABINET_METRIC_MAPPINGS: CabinetMetricMapping[] = [
  {
    countryId: "US",
    positionId: "secretary_of_state",
    metrics: [
      {
        category: "governance",
        metricId: "governmentTransparency",
        label: "Government Transparency",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "mediaInformation",
        metricId: "pressFreedom",
        label: "Press Freedom",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "social",
        metricId: "civicParticipation",
        label: "Civic Participation",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "mediaInformation",
        metricId: "mediaPolarization",
        label: "Media Polarization",
        higherIsBetter: false,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_treasury",
    metrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        higherIsBetter: true,
        format: "percent",
        range: { min: -5, max: 10 },
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Household Income",
        higherIsBetter: true,
        format: "number",
        range: { min: 30000, max: 100000 },
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "governance",
        metricId: "budgetBalance",
        label: "Budget Balance",
        higherIsBetter: true,
        format: "index",
        range: { min: -50, max: 50 },
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        higherIsBetter: false,
        format: "index",
        range: { min: 50, max: 150 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_defense",
    metrics: [
      {
        category: "governance",
        metricId: "budgetBalance",
        label: "Budget Balance",
        higherIsBetter: true,
        format: "index",
        range: { min: -50, max: 50 },
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Public Safety Confidence",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "social",
        metricId: "socialCohesion",
        label: "Social Cohesion",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "attorney_general",
    metrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 100 },
      },
      {
        category: "publicSafety",
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 50 },
      },
      {
        category: "publicSafety",
        metricId: "incarcerationRate",
        label: "Incarceration Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 100 },
      },
      {
        category: "publicSafety",
        metricId: "recidivismRate",
        label: "Recidivism Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 100 },
      },
      {
        category: "governance",
        metricId: "corruptionIndex",
        label: "Corruption Index",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_interior",
    metrics: [
      {
        category: "environment",
        metricId: "protectedLand",
        label: "Protected Land",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 50 },
      },
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "climateResilience",
        label: "Climate Resilience",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "recyclingRate",
        label: "Recycling Rate",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy Share",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_agriculture",
    metrics: [
      {
        category: "social",
        metricId: "foodInsecurity",
        label: "Food Insecurity Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "protectedLand",
        label: "Protected Land",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 50 },
      },
      {
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_commerce",
    metrics: [
      {
        category: "economic",
        metricId: "gdpGrowth",
        label: "GDP Growth",
        higherIsBetter: true,
        format: "percent",
        range: { min: -5, max: 10 },
      },
      {
        category: "economic",
        metricId: "smallBusinessFormation",
        label: "Small Business Formation",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Income",
        higherIsBetter: true,
        format: "number",
        range: { min: 30000, max: 100000 },
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        higherIsBetter: false,
        format: "index",
        range: { min: 50, max: 150 },
      },
      {
        category: "population",
        metricId: "populationGrowth",
        label: "Population Growth",
        higherIsBetter: true,
        format: "percent",
        range: { min: -2, max: 5 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_labor",
    metrics: [
      {
        category: "economic",
        metricId: "unemploymentRate",
        label: "Unemployment Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 20 },
      },
      {
        category: "economic",
        metricId: "medianIncome",
        label: "Median Household Income",
        higherIsBetter: true,
        format: "number",
        range: { min: 30000, max: 100000 },
      },
      {
        category: "social",
        metricId: "incomeInequality",
        label: "Income Inequality",
        higherIsBetter: false,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "publicSafety",
        metricId: "publicSafetyConfidence",
        label: "Workplace Safety Confidence",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_health",
    metrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "healthcare",
        metricId: "lifeExpectancy",
        label: "Life Expectancy",
        higherIsBetter: true,
        format: "years",
        range: { min: 60, max: 90 },
      },
      {
        category: "healthcare",
        metricId: "affordabilityIndex",
        label: "Healthcare Affordability",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "healthcare",
        metricId: "preventableMortality",
        label: "Preventable Mortality",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 100 },
      },
      {
        category: "healthcare",
        metricId: "publicHealthPreparedness",
        label: "Public Health Preparedness",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_hud",
    metrics: [
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 10 },
      },
      {
        category: "economic",
        metricId: "costOfLiving",
        label: "Cost of Living Index",
        higherIsBetter: false,
        format: "index",
        range: { min: 50, max: 150 },
      },
      {
        category: "economic",
        metricId: "povertyRate",
        label: "Poverty Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "social",
        metricId: "socialMobility",
        label: "Social Mobility",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "broadbandAccess",
        label: "Broadband Access",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_transportation",
    metrics: [
      {
        category: "infrastructure",
        metricId: "roadCondition",
        label: "Road Condition",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "publicTransit",
        label: "Public Transit Quality",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Infrastructure Investment Gap",
        higherIsBetter: false,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "broadbandAccess",
        label: "Broadband Access",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_energy",
    metrics: [
      {
        category: "environment",
        metricId: "renewableEnergy",
        label: "Renewable Energy Share",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "carbonEmissions",
        label: "Carbon Emissions",
        higherIsBetter: false,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "powerGridReliability",
        label: "Power Grid Reliability",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "environment",
        metricId: "airQuality",
        label: "Air Quality",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "infrastructure",
        metricId: "infrastructureInvestmentGap",
        label: "Infrastructure Investment Gap",
        higherIsBetter: false,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_education",
    metrics: [
      {
        category: "education",
        metricId: "highSchoolGradRate",
        label: "High School Graduation Rate",
        higherIsBetter: true,
        format: "percent",
        range: { min: 50, max: 100 },
      },
      {
        category: "education",
        metricId: "universityEnrollment",
        label: "University Enrollment Rate",
        higherIsBetter: true,
        format: "percent",
        range: { min: 0, max: 100 },
      },
      {
        category: "education",
        metricId: "testPerformance",
        label: "Academic Test Performance",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "education",
        metricId: "educationSpending",
        label: "Education Spending",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "education",
        metricId: "workforceSkill",
        label: "Workforce Skill Level",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_veterans",
    metrics: [
      {
        category: "healthcare",
        metricId: "uninsuredRate",
        label: "Uninsured Rate",
        higherIsBetter: false,
        format: "percent",
        range: { min: 0, max: 30 },
      },
      {
        category: "healthcare",
        metricId: "affordabilityIndex",
        label: "Healthcare Affordability",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "healthcare",
        metricId: "physicianRate",
        label: "Physician Access Rate",
        higherIsBetter: true,
        format: "rate",
        range: { min: 0, max: 100 },
      },
      {
        category: "social",
        metricId: "homelessnessRate",
        label: "Homelessness Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 10 },
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
    ],
  },
  {
    countryId: "US",
    positionId: "secretary_of_homeland",
    metrics: [
      {
        category: "publicSafety",
        metricId: "crimeRate",
        label: "Crime Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 100 },
      },
      {
        category: "publicSafety",
        metricId: "violentCrimeRate",
        label: "Violent Crime Rate",
        higherIsBetter: false,
        format: "rate",
        range: { min: 0, max: 50 },
      },
      {
        category: "governance",
        metricId: "publicTrust",
        label: "Public Trust",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "governance",
        metricId: "corruptionIndex",
        label: "Corruption Index",
        higherIsBetter: true,
        format: "index",
        range: { min: 0, max: 100 },
      },
      {
        category: "population",
        metricId: "migrationRate",
        label: "Migration Rate",
        higherIsBetter: true,
        format: "rate",
        range: { min: -5, max: 20 },
      },
    ],
  },
];

export function getCabinetMetrics(countryId: string, positionId: string): CabinetMetricEntry[] {
  const explicit =
    CABINET_METRIC_MAPPINGS.find((m) => m.countryId === countryId && m.positionId === positionId)
      ?.metrics ?? [];
  if (explicit.length > 0) return explicit;
  return buildMetricsFromMechanics(countryId, positionId);
}
