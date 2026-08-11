import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

type StateMetricCategoryId = Exclude<keyof StateMetrics, "_id" | "countryId" | "lastUpdated">;

const STATE_METRIC_CATEGORY_IDS: readonly StateMetricCategoryId[] = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "population",
  "mediaInformation",
];

function mv(value: number): StateMetricValue {
  return { value };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export const UNIFORM_METRIC_PATHS = [
  "economic.laborParticipation",
  "economic.matchingFriction",
  "economic.tradeBalance",
  "economic.productivityGrowth",
  "economic.rdIntensity",
  "economic.propertyValueIndex",
  "economic.commercialValueIndex",
  "economic.ruralRevitalization",
  "economic.foodSecurity",
  "economic.exportDependency",
  "economic.manufacturingCompetitiveness",
  // Dynamic fiscal-growth factors (seed so the engine's persist gate writes them
  // and computeNationalMetrics aggregates them). The engine recomputes both from
  // turn 1; these are cold-start values only.
  "economic.wageGrowth",
  "economic.tradeGrowth",
  "education.highSchoolGradRate",
  "education.gcseAttainment",
  "education.universityEnrollment",
  "education.apprenticeshipRate",
  "education.academicPressure",
  "healthcare.uninsuredRate",
  "healthcare.affordabilityIndex",
  "healthcare.nhsWaitingTime",
  "healthcare.mentalHealthAccess",
  "healthcare.socialCareQuality",
  "healthcare.elderCareQuality",
  "infrastructure.transportEfficiency",
  "publicSafety.antiSocialBehaviourRate",
  "publicSafety.knifeCrimeRate",
  "environment.floodRisk",
  "environment.naturalDisasterPreparedness",
  "environment.nuclearSafety",
  "environment.energyTransitionProgress",
  "social.childPoverty",
  "social.housingAffordability",
  "social.roughSleeping",
  "social.workLifeBalance",
  "social.foreignWorkerIntegration",
  "social.genderEquality",
  "social.housingSupplyGrowth",
  "governance.debtToGdp",
  "governance.devolutionSatisfaction",
  "governance.roboticsAdoption",
  "governance.coDeterminationQuality",
  "population.demographicDecline",
  "population.birthRate",
  "mediaInformation.bbcTrust",
  // P6a axis metrics (approval-excluded until the P6d cutover). Roots first —
  // the derived ones read them through finite() fallbacks.
  "mediaInformation.stateMediaControl",
  "economic.regulatoryBurden",
  "governance.militaryReadiness",
  "economic.economicFreedom",
  "governance.nationalPride",
  "governance.civilLiberties",
  // Right-lane axis metrics (P6d pattern) — policy-driven roots.
  "publicSafety.firearmRights",
  "governance.borderSecurity",
] as const;

export type UniformMetricPath = (typeof UNIFORM_METRIC_PATHS)[number];

export function uniformMetricDefault(metrics: StateMetrics, path: UniformMetricPath): number {
  const econ = metrics.economic;
  const education = metrics.education;
  const healthcare = metrics.healthcare;
  const infrastructure = metrics.infrastructure;
  const publicSafety = metrics.publicSafety;
  const environment = metrics.environment;
  const social = metrics.social;
  const governance = metrics.governance;
  const population = metrics.population;
  const media = metrics.mediaInformation;

  switch (path) {
    case "economic.laborParticipation":
      return 63;
    case "economic.matchingFriction":
      return 5;
    case "economic.tradeBalance":
      return 0;
    case "economic.productivityGrowth":
      return finite(econ.gdpGrowth?.value, 2) * 0.55;
    case "economic.rdIntensity":
      return 1.4 + finite(education.workforceSkill?.value, 60) / 100;
    case "economic.propertyValueIndex":
    case "economic.commercialValueIndex":
      return 100 + (finite(econ.medianIncome?.value, 50_000) > 60_000 ? 10 : 0);
    case "economic.ruralRevitalization":
      return Math.max(25, 85 - finite(population.urbanizationRate?.value, 70) * 0.45);
    case "economic.foodSecurity":
      return 55;
    case "economic.exportDependency":
      return 35;
    case "economic.manufacturingCompetitiveness":
      return Math.max(35, Math.min(90, finite(education.workforceSkill?.value, 65)));
    case "economic.wageGrowth":
      // Cold-start ≈ a real wage gain tied to growth plus a modest nominal slice
      // (~3% at trend GDP). The engine replaces this from medianIncome Δ + lagged
      // inflation on turn 1.
      return Math.max(-10, Math.min(600, finite(econ.gdpGrowth?.value, 2.5) * 0.6 + 1.5));
    case "economic.tradeGrowth":
      // Cold-start ≈ the world trade baseline (2.5), nudged by manufacturing
      // competitiveness. The engine replaces this from the trade inputs on turn 1.
      return Math.max(
        -30,
        Math.min(30, 2.5 + (finite(econ.manufacturingCompetitiveness?.value, 60) - 60) * 0.02)
      );
    case "education.highSchoolGradRate":
      return 88;
    case "education.gcseAttainment":
      return Math.max(20, Math.min(95, finite(education.testPerformance?.value, 95) * 0.65));
    case "education.universityEnrollment":
      // #909: merged higher-ed metric. Flat 55 default (the former
      // collegeEnrollment equilibrium); country seeds/engine drive the rest.
      return 55;
    case "education.apprenticeshipRate":
      return 2.5;
    case "education.academicPressure":
      return 50;
    case "healthcare.uninsuredRate":
      return 8;
    case "healthcare.affordabilityIndex":
      return 65;
    case "healthcare.nhsWaitingTime":
      return 18;
    case "healthcare.mentalHealthAccess":
      return 50;
    case "healthcare.socialCareQuality":
      return 55;
    case "healthcare.elderCareQuality":
      return Math.max(40, Math.min(85, finite(healthcare.lifeExpectancy?.value, 80) - 20));
    case "infrastructure.transportEfficiency":
      return Math.max(20, Math.min(95, finite(infrastructure.publicTransit?.value, 55)));
    case "publicSafety.antiSocialBehaviourRate":
      return Math.max(1, Math.min(25, finite(publicSafety.crimeRate?.value, 5_000) / 800));
    case "publicSafety.knifeCrimeRate":
      return Math.max(0.5, Math.min(10, finite(publicSafety.violentCrimeRate?.value, 250) / 100));
    case "environment.floodRisk":
      return Math.max(
        2,
        Math.min(30, 18 - finite(environment.climateResilience?.value, 60) * 0.12)
      );
    case "environment.naturalDisasterPreparedness":
      return Math.max(30, Math.min(90, finite(environment.climateResilience?.value, 60)));
    case "environment.nuclearSafety":
      return 65;
    case "environment.energyTransitionProgress":
      return Math.max(25, Math.min(90, finite(environment.renewableEnergy?.value, 35) + 10));
    case "social.childPoverty":
      return Math.max(5, Math.min(50, finite(econ.povertyRate?.value, 14) * 1.15));
    case "social.housingAffordability":
      // Pressure INDEX, lower is better (P3d unit repair) — aligned with the
      // engine node's anchor form.
      return Math.max(0, Math.min(100, 30 + (finite(econ.costOfLiving?.value, 100) - 100) * 0.9));
    case "social.roughSleeping":
      return Math.max(0.1, Math.min(10, finite(social.homelessnessRate?.value, 5) / 5));
    case "social.workLifeBalance":
      return Math.max(25, Math.min(90, 95 - finite(econ.unemploymentRate?.value, 5) * 4));
    case "social.foreignWorkerIntegration":
      return Math.max(20, Math.min(85, 50 + finite(population.migrationRate?.value, 0) * 3));
    case "social.genderEquality":
      return Math.max(25, Math.min(90, finite(social.socialMobility?.value, 55) + 10));
    case "social.housingSupplyGrowth":
      return 1;
    case "governance.debtToGdp":
      return 75;
    case "governance.devolutionSatisfaction":
      return Math.max(20, Math.min(90, finite(governance.publicTrust?.value, 50)));
    case "governance.roboticsAdoption":
      return Math.max(20, Math.min(90, finite(econ.manufacturingCompetitiveness?.value, 60)));
    case "governance.coDeterminationQuality":
      return Math.max(25, Math.min(90, finite(governance.publicTrust?.value, 50) + 10));
    case "population.demographicDecline":
      return Math.max(10, Math.min(90, finite(population.medianAge?.value, 40) * 1.1));
    case "population.birthRate":
      return Math.max(15, Math.min(85, 65 - finite(population.medianAge?.value, 40) * 0.5));
    case "mediaInformation.bbcTrust":
      return Math.max(20, Math.min(90, finite(media.newsTrust?.value, 50)));
    // ── P6a axis metrics ──
    case "mediaInformation.stateMediaControl":
      // Control mirrors how un-free the press is.
      return Math.max(0, Math.min(100, (100 - finite(media.pressFreedom?.value, 69)) * 0.9));
    case "economic.regulatoryBurden":
      return 50;
    case "governance.militaryReadiness":
      return 50; // budgets aren't visible here; the defense channel governs the response
    case "economic.economicFreedom":
      // The engine node's anchor form on doc values.
      return Math.max(
        0,
        Math.min(
          100,
          50 -
            (finite(econ.regulatoryBurden?.value, 50) - 50) * 0.5 +
            (finite(econ.smallBusinessFormation?.value, 8) - 8) * 1.5
        )
      );
    case "governance.nationalPride":
      return Math.max(
        0,
        Math.min(
          100,
          52 +
            (finite(governance.militaryReadiness?.value, 50) - 50) * 0.25 +
            (finite(econ.gdpGrowth?.value, 2.5) - 2.5) * 2
        )
      );
    case "governance.civilLiberties":
      return Math.max(
        0,
        Math.min(
          100,
          50 +
            (finite(media.pressFreedom?.value, 69) - 69) * 0.35 -
            (finite(media.stateMediaControl?.value, 30) - 30) * 0.3 -
            (finite(publicSafety.incarcerationRate?.value, 450) - 450) * 0.015 -
            (finite(governance.socialCreditCoverage?.value, 10) - 10) * 0.1
        )
      );
    // ── Right-lane axis metrics (P6d pattern) ──
    case "publicSafety.firearmRights":
      // Most countries license civilian ownership narrowly; the US overrides
      // this via its authored presets (usMetricPresets*.ts).
      return 30;
    case "governance.borderSecurity":
      // Neutral modern baseline; era/country presets and immigration or
      // enforcement legislation move it from here.
      return 55;
  }
}

export function withUniformMetricSet(metrics: StateMetrics): StateMetrics {
  const defaults: StateMetrics = {
    ...metrics,
    economic: { ...metrics.economic },
    education: { ...metrics.education },
    healthcare: { ...metrics.healthcare },
    infrastructure: { ...metrics.infrastructure },
    publicSafety: { ...metrics.publicSafety },
    environment: { ...metrics.environment },
    social: { ...metrics.social },
    governance: { ...metrics.governance },
    population: { ...metrics.population },
    mediaInformation: { ...metrics.mediaInformation },
  };

  for (const path of UNIFORM_METRIC_PATHS) {
    const [category, metricId] = path.split(".") as [keyof StateMetrics, string];
    const categoryDoc = defaults[category] as Record<string, StateMetricValue | undefined>;
    categoryDoc[metricId] ??= mv(uniformMetricDefault(defaults, path));
  }

  return defaults;
}

function metricLikeFromBaselines(baseline: StateMetricBaseline): StateMetrics {
  const doc: Record<string, unknown> = {
    _id: baseline._id,
    lastUpdated: new Date(0),
  };

  for (const category of STATE_METRIC_CATEGORY_IDS) {
    const values = baseline.baselines[category] ?? {};
    doc[category] = Object.fromEntries(
      Object.entries(values).map(([metricId, value]) => [metricId, mv(value)])
    );
  }

  return doc as unknown as StateMetrics;
}

export function withUniformMetricBaselines(baseline: StateMetricBaseline): StateMetricBaseline {
  const categories = { ...baseline.baselines };
  const baselineMetricLike = metricLikeFromBaselines({ ...baseline, baselines: categories });

  for (const path of UNIFORM_METRIC_PATHS) {
    const [category, metricId] = path.split(".") as [string, string];
    categories[category] = { ...(categories[category] ?? {}) };
    if (categories[category][metricId] == null) {
      const value = uniformMetricDefault(baselineMetricLike, path);
      categories[category][metricId] = value;
      const categoryDoc = baselineMetricLike[category as StateMetricCategoryId] as Record<
        string,
        StateMetricValue
      >;
      categoryDoc[metricId] = mv(value);
    }
  }
  return { ...baseline, baselines: categories };
}
