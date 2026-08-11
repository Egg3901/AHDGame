import type { MetricCategoryId } from "@/lib/db/types";

export type MetricCountryCode = "us" | "uk" | "de" | "jp" | "ie" | "br" | "cn" | "ng";
export type MetricCountryScope = MetricCountryCode | "all";
export type MetricCountryScopeSetting = MetricCountryScope | MetricCountryScope[];

export interface MetricDefinition {
  id: string;
  name: string;
  /** Abbreviated display name for compact UIs (falls back to `name`). */
  shortName?: string;
  unit: "percent" | "currency" | "index" | "rate" | "years" | "score";
  description: string;
  /**
   * Longer description including a directional hint (e.g. "% of labor force
   * without jobs. Lower = stronger job market."). Used by tooltips on the
   * national metrics dashboard. Falls back to `description`.
   */
  detailedDescription?: string;
  isHigherBetter: boolean;
  formatPrefix?: string; // e.g., "$"
  formatSuffix?: string; // e.g., "%", " per 100k"
  decimals?: number; // Number of decimal places to show
  minValue?: number; // Floor value (default: 0)
  maxValue?: number; // Ceiling value (default: 100)
  /** @deprecated Metric definitions are now country-neutral. */
  countryScope?: MetricCountryScopeSetting;
  /**
   * Per-region display-name overrides. Used by metrics where the same numeric
   * field needs a different label in specific regions — e.g. UK's
   * `independenceDesire` reads "Reunification Desire" in NIR but "Independence
   * Desire" in SCO/WAL. Consumer passes the stateId when known.
   */
  regionDisplayNames?: Record<string, string>;
}

/** Resolve the human-readable name for a metric, honouring per-region overrides
 *  when a stateId is supplied. Falls back to `definition.name`. */
export function getMetricDisplayName(definition: MetricDefinition, stateId?: string): string {
  if (stateId && definition.regionDisplayNames) {
    const override = definition.regionDisplayNames[stateId.toUpperCase()];
    if (override) return override;
  }
  return definition.name;
}

export interface MetricCategory {
  id: MetricCategoryId;
  name: string;
  description: string;
  icon: string; // SVG path or icon identifier
  metrics: MetricDefinition[];
}

export const metricCategories: MetricCategory[] = [
  {
    id: "economic",
    name: "Economic",
    description: "Economic health and prosperity indicators",
    icon: "currency-dollar",
    metrics: [
      {
        id: "unemploymentRate",
        name: "Unemployment Rate",
        unit: "percent",
        description: "Percentage of the labor force that is unemployed",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        // Floor must span every ERA. "Natural rate" 2% was a modern Western
        // assumption — FR Île-de-France authors 1.5 in 1953 (near-full
        // reconstruction employment). Registry still also reads UNEMPLOYMENT_MIN
        // from gdpGrowth.ts (out of this bound's reach); keep defs honest.
        minValue: 1,
        maxValue: 25, // Depression-level ceiling
      },
      {
        id: "medianIncome",
        name: "Median Household Income",
        shortName: "Median Income",
        unit: "currency",
        description: "Median annual household income",
        isHigherBetter: true,
        formatPrefix: "$",
        decimals: 0,
        // Values are nominal local-currency amounts that vary widely by country
        // AND era (UK GBP 24k-42k modern, US $40k-$90k, JP JPY 3.6M-5.8M, but
        // also NG 1953 ~100–220 and CN 1953 ~320–480 on the USD-anchored seed
        // scale). Floor at 1000 was a modern-USD assumption that snapped every
        // low-income 1953 region up on turn 1 (NG NORTH_EAST 100). 0 still
        // bounds nonsense while leaving every historical value the eras author.
        minValue: 0,
        maxValue: 10_000_000,
      },
      {
        id: "gdpGrowth",
        name: "GDP Growth",
        unit: "percent",
        description: "Annual GDP growth rate",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Realistic range — without these bounds, the default 0-100 ceiling
        // lets cabinet-order $inc loops compound into double-digit growth
        // (bug #0571: DE at 26%). A real-economy ceiling of ~15% leaves room
        // for genuine booms while preventing runaway feedback loops.
        minValue: -10,
        maxValue: 15,
      },
      {
        id: "wageGrowth",
        name: "Wage Growth",
        unit: "percent",
        description:
          "Annual wage-growth rate that compounds the income-tax base: real income gains plus a slice of inflation. Applied per turn.",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Wide ceiling: the nominal inflation pass-through must accommodate
        // hyperinflation (e.g. BR-1991) without clamping the income-tax base.
        minValue: -10,
        maxValue: 600,
      },
      {
        id: "tradeGrowth",
        name: "Trade Growth",
        unit: "percent",
        description:
          "Annual growth of the trade/import tax base: tariffs and a punitive foreign-corporate tax suppress it (a trade-Laffer wedge); FTAs, a common market, a weak currency, and manufacturing strength lift it. Applied per turn.",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: -30,
        maxValue: 30,
      },
      {
        id: "povertyRate",
        name: "Poverty Rate",
        unit: "percent",
        description: "Percentage of population below poverty line",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        // Ceiling must span every ERA. 35 was a "developed state" ceiling —
        // TR_SEA authors 68 and GR rural regions 40–48 (absolute rural poverty,
        // 1953). Floor 3 unchanged (SE sits at 8).
        minValue: 3, // Some poverty always exists
        maxValue: 80,
      },
      {
        id: "costOfLiving",
        // Index centered at 100 (national avg), so it exceeds 100 — THRESHOLDS
        // span [70,165], seeds up to 145. (S1 wrongly set [0,100] and clamped it.)
        minValue: 40,
        maxValue: 200,
        name: "Cost of Living Index",
        shortName: "Cost of Living",
        unit: "index",
        description: "Cost of living index (100 = national average)",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "smallBusinessFormation",
        minValue: 0,
        maxValue: 30,
        name: "Small Business Formation Rate",
        shortName: "Small Business Formation",
        unit: "rate",
        description: "New small businesses per 1,000 residents annually",
        isHigherBetter: true,
        formatSuffix: " per 1k",
        decimals: 1,
      },
      // ── P6a axis metrics (EXCLUDED from approval until the P6d cutover) ──
      {
        id: "economicFreedom",
        minValue: 0,
        maxValue: 100,
        name: "Economic Freedom",
        unit: "index",
        description: "Ease of private enterprise: light regulation, low burdens (0-100)",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "regulatoryBurden",
        minValue: 0,
        maxValue: 100,
        name: "Regulatory Burden",
        unit: "index",
        description: "Compliance and licensing load on business (0-100, lower is lighter)",
        isHigherBetter: false,
        decimals: 1,
      },
      {
        id: "consumerConfidence",
        minValue: 0,
        maxValue: 100,
        name: "Consumer Confidence",
        unit: "index",
        description:
          "Household demand-side sentiment (0-100, neutral ~60). Falls in downturns and crises; drives local sector profit margins.",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "investorConfidence",
        minValue: 0,
        maxValue: 100,
        name: "Investor Confidence",
        unit: "index",
        description:
          "Investment-side market sentiment (0-100, neutral ~60). Falls in downturns and crises; lifts or depresses the share price of corporations headquartered here.",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "laborParticipation",
        name: "Labor Force Participation",
        unit: "percent",
        description:
          "Percentage of working-age population in the labor force - affected by education, childcare, retirement, and disability policies",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Floor/ceiling must span every ERA. [50,75] was a modern OECD band —
        // ES authors 48 (low female formal participation, 1953) and RU 80
        // (command-economy labour mobilisation).
        minValue: 40,
        maxValue: 85,
      },
      {
        id: "matchingFriction",
        name: "Structural Unemployment",
        unit: "percent",
        description:
          "Irreducible unemployment from skills mismatch, geographic immobility, and institutional barriers - lowered by education, infrastructure, and labor market policies",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        minValue: 1,
        maxValue: 15,
      },
      {
        id: "tradeBalance",
        name: "Trade Balance",
        unit: "percent",
        description: "Net exports as share of GDP; positive values indicate a trade surplus",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: -10,
        maxValue: 15,
      },
      {
        id: "productivityGrowth",
        name: "Labor Productivity Growth",
        shortName: "Productivity Growth",
        unit: "percent",
        description: "GDP per worker-hour growth rate; a long-run living standards driver",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Ceiling must span every ERA. 6% capped JP's authored 1953 recovery
        // productivity at 6 (Hokkaido/national overlays reach 8.0 during the
        // postwar miracle ramp). Floor −3 unchanged — no era value approaches it.
        minValue: -3,
        maxValue: 12,
      },
      {
        id: "rdIntensity",
        name: "R&D Intensity",
        unit: "percent",
        description: "Research and development spending as share of GDP",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: 0,
        maxValue: 6,
      },
      {
        id: "propertyValueIndex",
        name: "Property Value Index",
        unit: "index",
        description:
          "Average residential property value relative to baseline - reflects regional economic health and investment attractiveness",
        isHigherBetter: true,
        decimals: 1,
        // Floor must span every ERA. 25 was a developed-market assumption —
        // CN 1953 authors 5 (private property abolished) and NG/BR sit in the
        // single digits. Ceiling 300 unchanged.
        minValue: 0,
        maxValue: 300,
      },
      {
        id: "commercialValueIndex",
        name: "Commercial Value Index",
        unit: "index",
        description:
          "Average commercial property value relative to baseline - reflects business environment and regional competitiveness",
        isHigherBetter: true,
        decimals: 1,
        // Same era-blind floor class as propertyValueIndex — CN/NG 1953 at 5.
        minValue: 0,
        maxValue: 300,
      },
      {
        id: "ruralRevitalization",
        minValue: 0,
        maxValue: 100,
        name: "Rural Revitalization",
        unit: "index",
        description: "Urban-rural divide health and regional economic vitality (0-100)",
        detailedDescription:
          "Rural economic vitality and depopulation countermeasures (0-100). Higher = healthier regions.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "foodSecurity",
        minValue: 0,
        maxValue: 100,
        name: "Food Security",
        unit: "index",
        description: "Agricultural self-sufficiency and supply resilience (0-100)",
        detailedDescription:
          "Agricultural self-sufficiency ratio and import dependency (0-100). Higher = more resilient.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "exportDependency",
        name: "Export Dependency",
        unit: "percent",
        description:
          "Exports as share of GDP; higher values increase exposure to global trade shocks",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        // Floor must span every ERA. 10% was a mid-century trade-state floor —
        // RU CEN authors 6 and CN ~8 (minimal trade / Soviet barter). Ceiling
        // 65 unchanged (IE DUB peaks at 45 in 1953).
        minValue: 0,
        maxValue: 65,
      },
      {
        id: "manufacturingCompetitiveness",
        name: "Manufacturing Competitiveness",
        shortName: "Mfg. Competitiveness",
        unit: "index",
        description: "Industrial export competitiveness index (0-100)",
        isHigherBetter: true,
        decimals: 0,
        // Floor must span every ERA. 20 was an industrialised-economy floor —
        // NG NORTH_WEST authors 5 (virtually no industry, 1953).
        minValue: 0,
        maxValue: 100,
      },
      // ── DE-specific ──────────────────────────────────────────────────────
      {
        id: "eastWestConvergence",
        name: "East-West Convergence",
        shortName: "E-W Convergence",
        unit: "index",
        description: "East-West GDP/wages/productivity gap: Aufbau Ost progress (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      {
        id: "mittelstandHealth",
        name: "Mittelstand Health",
        unit: "index",
        description: "Family-owned industrial SME ecosystem health (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      // ── CN-specific ──────────────────────────────────────────────────────
      {
        id: "commonProsperityIndex",
        name: "Common Prosperity Index",
        shortName: "Common Prosperity",
        unit: "index",
        description: "共同富裕 program coverage + inequality + rural-urban convergence (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      {
        id: "industrialPolicyExecution",
        name: "Industrial Policy Execution",
        shortName: "Industrial Policy",
        unit: "index",
        description: "Five-Year Plan + Made in China flagship initiative achievement (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      {
        id: "eastWestRegionalGap",
        name: "East-West Regional Gap",
        shortName: "E-W Gap",
        unit: "index",
        description: "Coastal-interior economic divergence (lower = more balanced)",
        isHigherBetter: false,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      // ── IE-specific ──────────────────────────────────────────────────────
      {
        id: "mncDependency",
        name: "MNC Dependency",
        unit: "percent",
        description:
          "% of corporation-tax receipts from top-10 multinationals (concentration risk)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "gniStarGap",
        name: "GNI* Gap",
        unit: "percent",
        description: "% gap between headline GDP and Modified GNI* (CSO's MNC-stripped measure)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: -20,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "fdiPipelineStrength",
        name: "FDI Pipeline Strength",
        shortName: "FDI Pipeline",
        unit: "index",
        description: "IDA Ireland attractiveness score (job announcements, investment flows)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "capDependency",
        name: "CAP Dependency",
        unit: "percent",
        description: "% of average family-farm income from CAP direct payments",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
    ],
  },
  {
    id: "education",
    name: "Education",
    description: "Educational attainment and quality indicators",
    icon: "academic-cap",
    metrics: [
      {
        id: "highSchoolGradRate",
        name: "High School Graduation Rate",
        shortName: "HS Graduation Rate",
        unit: "percent",
        description: "Percentage of students graduating high school",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Floor must span every ERA. 55 (widened from 70 for modern struggling
        // regions) was still a Western secondary-school assumption — evalNode +
        // processStateMetrics snapped every low-attainment 1953 region up to 55
        // on turn 1 (NG NORTH_EAST 1, GR rural 6, IE west 20, JP 45). 0 still
        // bounds nonsense while leaving every historical value the eras author.
        // Ceiling 98 unchanged (can't reach 100%).
        minValue: 0,
        maxValue: 98,
      },
      {
        id: "testPerformance",
        // Index centered at 100 (national avg), so it exceeds 100 — THRESHOLDS
        // span [75,125], seeds up to 116. (S1 wrongly set [0,100] and clamped it.)
        minValue: 50,
        maxValue: 150,
        name: "Standardized Test Performance",
        shortName: "Test Performance",
        unit: "index",
        description: "Average standardized test score index (100 = national average)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "educationSpending",
        minValue: 0,
        maxValue: 10000000,
        name: "Education Spending",
        unit: "currency",
        description: "Per-pupil education spending",
        isHigherBetter: true,
        formatPrefix: "$",
        decimals: 0,
      },
      {
        id: "literacyRate",
        name: "Literacy Rate",
        unit: "percent",
        description: "Adult literacy rate",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Floor must span every ERA. At 80 this was a US-modern assumption
        // ("baseline is high") applied globally: processStateMetrics + the
        // metric-engine literacyRateNode.bounds both snapped every low-literacy
        // 1953 region up to 80 on turn 1 (TR east 15, CN ~22–38, TR_IST 55 all
        // became ≥80; SE 99 escaped). 10 still bounds nonsense while leaving
        // every historical value the eras actually author.
        minValue: 10,
        maxValue: 99, // Can't reach 100%
      },
      {
        id: "workforceSkill",
        minValue: 0,
        maxValue: 100,
        name: "Workforce Skill Index",
        shortName: "Workforce Skills",
        unit: "index",
        description: "How skilled the workforce is here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "gcseAttainment",
        name: "Secondary Attainment Rate",
        shortName: "Secondary Attainment",
        unit: "percent",
        description: "Percentage of pupils achieving standard secondary education pass grades",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: 20,
        maxValue: 95,
      },
      {
        id: "universityEnrollment",
        name: "University Enrollment Rate",
        shortName: "University Enrollment",
        unit: "percent",
        description: "Percentage of young people entering higher (university/college) education",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "apprenticeshipRate",
        name: "Apprenticeship Rate",
        unit: "rate",
        description:
          "Rate of apprenticeship starts per capita - reflects vocational training investment",
        isHigherBetter: true,
        decimals: 2,
        // Ceiling must span every ERA. 8 was a modern per-capita starts rate —
        // AT authors 28 (Lehre tradition already strong in 1953). Floor 0
        // unchanged.
        minValue: 0,
        maxValue: 40,
      },
      {
        id: "academicPressure",
        minValue: 0,
        maxValue: 100,
        name: "Academic Pressure",
        unit: "index",
        description: "Exam culture intensity and student mental health (0-100)",
        detailedDescription:
          "Exam culture intensity and cram school prevalence (0-100). Higher = more pressure on students.",
        isHigherBetter: false,
        decimals: 0,
      },
    ],
  },
  {
    id: "healthcare",
    name: "Healthcare",
    description: "Health system and population health indicators",
    icon: "heart",
    metrics: [
      {
        id: "uninsuredRate",
        name: "Uninsured Rate",
        unit: "percent",
        description: "Percentage of population without health insurance",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        // 0 floor: universal-coverage systems (UK NHS etc.) genuinely reach ~0 —
        // THRESHOLDS best is 0, and bounds must contain the realistic span (S1).
        // Ceiling must span every ERA. 25 was a "Pre-ACA US" assumption —
        // NG NORTH_EAST authors 98 and BR/CN/TR sit at 70–90 in 1953 (essentially
        // no formal health coverage).
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "affordabilityIndex",
        minValue: 0,
        maxValue: 100,
        name: "Healthcare Affordability Index",
        shortName: "Healthcare Affordability",
        unit: "index",
        description: "How affordable healthcare is here (0-100, higher = more affordable)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "physicianRate",
        minValue: 0,
        maxValue: 20,
        name: "Physicians Per Capita",
        shortName: "Physicians",
        unit: "rate",
        description: "Active physicians per 1,000 residents",
        isHigherBetter: true,
        formatSuffix: " per 1k",
        decimals: 2,
      },
      {
        id: "lifeExpectancy",
        name: "Life Expectancy",
        unit: "years",
        description: "Average life expectancy at birth",
        isHigherBetter: true,
        formatSuffix: " years",
        decimals: 1,
        // Floor must span every ERA, not just the modern one. At 70 this was a
        // US-2019 assumption ("Mississippi ~74") applied globally: the policy
        // clamp snapped every non-player region up to 70 on turn 1, destroying
        // the authored 1953 mortality gradient outright (China 43, Nigeria 51,
        // Turkey 62, USSR/Poland 64, Italy 66 all became 70). The player four
        // escaped only because writeSplitMetrics drops their political half, so
        // the distortion was invisible in exactly the countries anyone checked.
        // 35 still bounds the metric against nonsense while leaving every
        // historical value the eras actually author.
        minValue: 35,
        maxValue: 90,
      },
      {
        id: "preventableMortality",
        minValue: 0,
        maxValue: 1000,
        name: "Preventable Mortality Rate",
        shortName: "Preventable Mortality",
        unit: "rate",
        description: "Preventable deaths per 100,000 residents",
        isHigherBetter: false,
        formatSuffix: " per 100k",
        decimals: 0,
      },
      {
        id: "publicHealthPreparedness",
        minValue: 0,
        maxValue: 100,
        name: "Public Health Preparedness Index",
        shortName: "Health Preparedness",
        unit: "index",
        description: "How prepared public health is for emergencies (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "nhsWaitingTime",
        name: "Public Care Waiting Time",
        unit: "score",
        description: "Average public healthcare waiting time for treatment in weeks",
        isHigherBetter: false,
        decimals: 1,
        minValue: 1,
        maxValue: 52,
      },
      {
        id: "mentalHealthAccess",
        name: "Mental Health Access Rate",
        shortName: "Mental Health Access",
        unit: "percent",
        description: "Percentage of population with access to timely mental health services",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // Floor must span every ERA. 5 was a modern-access floor — NG NORTH_WEST
        // authors 3 in 1953 (essentially no community mental health).
        minValue: 0,
        maxValue: 95,
      },
      {
        id: "socialCareQuality",
        name: "Social Care Quality Index",
        shortName: "Social Care Quality",
        unit: "index",
        description:
          "Quality index of adult social care provision - care home standards, domiciliary care availability",
        isHigherBetter: true,
        decimals: 1,
        // Floor must span every ERA. 10 was a welfare-state floor — NG NORTH_WEST
        // authors 8 in 1953 (family-based care only).
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "elderCareQuality",
        minValue: 0,
        maxValue: 100,
        name: "Elder Care Quality",
        unit: "index",
        description: "Quality of elder care services (0-100)",
        detailedDescription:
          "Quality of elder care services for aging populations (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      // ── IE-specific ──────────────────────────────────────────────────────
      {
        id: "slaintecareProgress",
        name: "Sláintecare Progress",
        unit: "index",
        description: "Universal single-tier health-system rollout progress (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "hseWaitingListMonths",
        name: "HSE Waiting List",
        shortName: "HSE Waits",
        unit: "rate",
        description: "NTPF median outpatient appointment wait, in months",
        isHigherBetter: false,
        formatSuffix: " mo",
        decimals: 1,
        minValue: 0,
        maxValue: 60,
        countryScope: "ie",
      },
    ],
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    description: "Physical infrastructure and connectivity indicators",
    icon: "building-office",
    metrics: [
      {
        id: "roadCondition",
        minValue: 0,
        maxValue: 100,
        name: "Road & Bridges Condition Index",
        shortName: "Road Condition",
        unit: "percent",
        description: "Percentage of roads and bridges in good condition",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "broadbandAccess",
        minValue: 0,
        maxValue: 100,
        name: "Broadband Access Rate",
        shortName: "Broadband Access",
        unit: "percent",
        description: "Percentage of households with broadband internet",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "publicTransit",
        minValue: 0,
        maxValue: 100,
        name: "Public Transit Efficiency Score",
        shortName: "Public Transit",
        unit: "index",
        description: "How good public transit coverage and efficiency are here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "waterQuality",
        minValue: 0,
        maxValue: 100,
        name: "Water Quality Index",
        shortName: "Water Quality",
        unit: "percent",
        description: "Percentage of water systems meeting quality standards",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "powerGridReliability",
        minValue: 0,
        maxValue: 100,
        name: "Power Grid Reliability",
        shortName: "Grid Reliability",
        unit: "percent",
        description: "Electric grid uptime percentage",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 2,
      },
      {
        id: "infrastructureInvestmentGap",
        minValue: 0,
        maxValue: 100,
        name: "Infrastructure Investment Gap",
        shortName: "Investment Gap",
        unit: "percent",
        description: "Gap between needed and actual infrastructure investment (lower = better)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "transportEfficiency",
        minValue: 0,
        maxValue: 100,
        name: "Transport Efficiency",
        unit: "index",
        description: "Public transport reliability and coverage (0-100)",
        detailedDescription:
          "Intercity and public transit network quality (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
    ],
  },
  {
    id: "publicSafety",
    name: "Public Safety",
    description: "Crime, law enforcement, and public safety indicators",
    icon: "shield-check",
    metrics: [
      {
        id: "crimeRate",
        name: "Overall Crime Rate",
        shortName: "Crime Rate",
        unit: "rate",
        description: "Total crimes per 100,000 residents",
        isHigherBetter: false,
        formatSuffix: " per 100k",
        decimals: 0,
        // P3a: per-100k scale (THRESHOLDS [1500, 11000], seeds to ~8700). The old
        // [10,80] ceiling-clamped real values to 80 every turn (the S1
        // educationSpending class of bug). Headroom above the worst realistic level.
        minValue: 0,
        maxValue: 15000,
      },
      {
        id: "violentCrimeRate",
        minValue: 0,
        maxValue: 3000,
        name: "Violent Crime Rate",
        shortName: "Violent Crime",
        unit: "rate",
        description: "Violent crimes per 100,000 residents",
        isHigherBetter: false,
        formatSuffix: " per 100k",
        decimals: 0,
      },
      {
        id: "policePerCapita",
        minValue: 0,
        maxValue: 20,
        name: "Police Per Capita",
        shortName: "Police per Capita",
        unit: "rate",
        description: "Police officers per 1,000 residents",
        isHigherBetter: true,
        formatSuffix: " per 1k",
        decimals: 2,
      },
      {
        id: "incarcerationRate",
        name: "Incarceration Rate",
        shortName: "Incarceration",
        unit: "rate",
        description: "Incarcerated individuals per 100,000 residents",
        isHigherBetter: false,
        formatSuffix: " per 100k",
        decimals: 0,
        // P3a: per-100k scale (THRESHOLDS [50, 800]; US ~640). The old [10,80]
        // ceiling-clamped real values to 80 every turn (the S1 educationSpending
        // class of bug). Ceiling must also span every ERA — 1200 still truncated
        // RU 1953 gulag-era rates (CEN 1400, FEA 2600). Floor 0 unchanged.
        minValue: 0,
        maxValue: 3000,
      },
      {
        id: "recidivismRate",
        minValue: 0,
        maxValue: 100,
        name: "Recidivism Rate",
        unit: "percent",
        description: "Percentage of released prisoners who reoffend within 3 years",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
      },
      {
        id: "publicSafetyConfidence",
        minValue: 0,
        maxValue: 100,
        name: "Public Safety Confidence Index",
        shortName: "Safety Confidence",
        unit: "index",
        description: "How confident the public is in safety here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "antiSocialBehaviourRate",
        name: "Anti-Social Behaviour Rate",
        shortName: "Anti-Social Behaviour",
        unit: "rate",
        description: "Rate of reported anti-social behaviour incidents",
        isHigherBetter: false,
        decimals: 2,
        minValue: 0,
        maxValue: 20,
      },
      {
        id: "knifeCrimeRate",
        name: "Knife Crime Rate",
        unit: "rate",
        description: "Rate of knife or sharp-weapon crime incidents per capita",
        isHigherBetter: false,
        decimals: 2,
        minValue: 0,
        maxValue: 10,
      },
      // ── Axis metric (P6d pattern: electorate-weighted approval term) ──
      {
        id: "firearmRights",
        minValue: 0,
        maxValue: 100,
        name: "Firearm Rights",
        unit: "index",
        description:
          "Breadth of lawful civilian firearm ownership and carry (0-100, higher means fewer restrictions)",
        isHigherBetter: true,
        decimals: 1,
      },
    ],
  },
  {
    id: "environment",
    name: "Environment",
    description: "Environmental quality and sustainability indicators",
    icon: "globe-americas",
    metrics: [
      {
        id: "airQuality",
        minValue: 0,
        maxValue: 100,
        name: "Air Quality Index",
        shortName: "Air Quality",
        unit: "index",
        description: "Average air quality index (lower is better)",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "renewableEnergy",
        minValue: 0,
        maxValue: 100,
        name: "Renewable Energy Share",
        shortName: "Renewable Energy",
        unit: "percent",
        description: "Percentage of energy from renewable sources",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
      },
      {
        id: "energyTransitionProgress",
        name: "Energy Transition Progress",
        shortName: "Energy Transition",
        unit: "index",
        description: "Progress toward a renewable-dominant energy mix (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "carbonEmissions",
        minValue: 0,
        maxValue: 60,
        name: "Carbon Emissions Per Capita",
        shortName: "Carbon Emissions",
        unit: "rate",
        description: "CO2 emissions in metric tons per capita",
        isHigherBetter: false,
        formatSuffix: " tons",
        decimals: 1,
      },
      {
        id: "recyclingRate",
        minValue: 0,
        maxValue: 100,
        name: "Recycling/Waste Diversion Rate",
        shortName: "Recycling Rate",
        unit: "percent",
        description: "Percentage of waste recycled or diverted from landfills",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "climateResilience",
        minValue: 0,
        maxValue: 100,
        name: "Climate Resilience Score",
        shortName: "Climate Resilience",
        unit: "index",
        description: "How ready the region is for climate change adaptation (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "protectedLand",
        minValue: 0,
        maxValue: 100,
        name: "Protected Land Percentage",
        shortName: "Protected Land",
        unit: "percent",
        description: "Percentage of land area under protection",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
      },
      {
        id: "floodRisk",
        name: "Flood Risk",
        unit: "percent",
        description: "Percentage of properties at significant flood risk",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        minValue: 1,
        maxValue: 30,
      },
      {
        id: "naturalDisasterPreparedness",
        minValue: 0,
        maxValue: 100,
        name: "Natural Disaster Preparedness",
        unit: "index",
        description: "Readiness for earthquakes, typhoons, tsunamis (0-100)",
        detailedDescription:
          "Readiness for earthquakes, typhoons, and tsunamis (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "nuclearSafety",
        minValue: 0,
        maxValue: 100,
        name: "Nuclear Safety",
        unit: "index",
        description: "Nuclear regulatory confidence and reactor safety (0-100)",
        detailedDescription:
          "Nuclear regulatory confidence, reactor safety, and energy mix trust (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      // ── IE-specific ──────────────────────────────────────────────────────
      {
        id: "agriEmissionsShare",
        name: "Agricultural Emissions Share",
        shortName: "Agri Emissions",
        unit: "percent",
        description: "% of total emissions from agriculture (methane + N₂O dominant)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
    ],
  },
  {
    id: "social",
    name: "Social",
    description: "Social welfare and community health indicators",
    icon: "users",
    metrics: [
      {
        id: "socialMobility",
        minValue: 0,
        maxValue: 100,
        name: "Social Mobility Index",
        shortName: "Social Mobility",
        unit: "index",
        description: "How much economic mobility people have here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "incomeInequality",
        name: "Income Inequality",
        unit: "index",
        // P3a Gini-100 unification: values were stored as Gini FRACTIONS
        // (0.29-0.52) against [25,60] bounds — the floor rewrote every value UP
        // to 25, and ±3-scale law contributions overwhelmed a 0-1 metric. The
        // canonical scale is now the Gini INDEX ×100 (seeds rescaled; live
        // migration script prepared, dry-run default).
        description: "Gini index (0 = perfect equality, 100 = maximum inequality)",
        isHigherBetter: false,
        decimals: 0,
        minValue: 15,
        maxValue: 70,
      },
      {
        id: "homelessnessRate",
        minValue: 0,
        maxValue: 200,
        name: "Homelessness Rate",
        shortName: "Homelessness",
        unit: "rate",
        description: "Homeless individuals per 10,000 residents",
        isHigherBetter: false,
        formatSuffix: " per 10k",
        decimals: 1,
      },
      {
        id: "foodInsecurity",
        minValue: 0,
        maxValue: 100,
        name: "Food Insecurity Rate",
        shortName: "Food Insecurity",
        unit: "percent",
        description: "Percentage of population facing food insecurity",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
      },
      {
        id: "civicParticipation",
        minValue: 0,
        maxValue: 100,
        name: "Civic Participation Rate",
        shortName: "Civic Participation",
        unit: "percent",
        description: "Percentage of adults engaged in civic activities",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "socialCohesion",
        minValue: 0,
        maxValue: 100,
        name: "Social Cohesion Index",
        shortName: "Social Cohesion",
        unit: "index",
        description: "How strong community bonds and trust are here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "housingSupplyGrowth",
        name: "Housing Supply Growth",
        unit: "percent",
        description:
          "Annual growth in housing units per capita; insufficient supply drives local cost pressure",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        minValue: -2,
        maxValue: 8,
      },
      {
        id: "childPoverty",
        name: "Child Poverty Rate",
        shortName: "Child Poverty",
        unit: "percent",
        description: "Percentage of children living in relative poverty",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        // Ceiling must span every ERA. 50 was a developed-welfare ceiling —
        // NG NORTH_EAST authors 88 in 1953. Floor 5 unchanged (SE sits at 8).
        minValue: 5,
        maxValue: 95,
      },
      {
        id: "housingAffordability",
        name: "Housing Cost Pressure",
        shortName: "Housing Pressure",
        unit: "index",
        description: "Index of housing cost burden relative to incomes (0-100, lower is better)",
        isHigherBetter: false,
        decimals: 1,
        // P3d unit repair: defined as a price-to-income ratio [2,20], but IE
        // seeds run 18-32 (Dublin was ceiling-clamped at 20 LIVE — the S1
        // educationSpending class) and the uniform derivation produces
        // index-scale values. Unified on a 0-100 pressure index; clamped live
        // values recover toward their baselines via policyEffects decay.
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "roughSleeping",
        name: "Rough Sleeping Rate",
        shortName: "Rough Sleeping",
        unit: "rate",
        description: "Rate of rough sleepers per 10,000 population",
        isHigherBetter: false,
        decimals: 2,
        minValue: 0,
        maxValue: 10,
      },
      {
        id: "workLifeBalance",
        minValue: 0,
        maxValue: 100,
        name: "Work-Life Balance",
        unit: "index",
        description: "Index of healthy work-life balance (0-100)",
        detailedDescription:
          "Overwork risk and labor reform effectiveness (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "foreignWorkerIntegration",
        minValue: 0,
        maxValue: 100,
        name: "Foreign Worker Integration",
        unit: "index",
        description: "Immigration acceptance and visa program breadth (0-100)",
        detailedDescription:
          "Social cohesion with foreign residents and visa program breadth (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "genderEquality",
        minValue: 0,
        maxValue: 100,
        name: "Gender Equality",
        unit: "index",
        description: "Workforce participation gap and pay equity (0-100)",
        detailedDescription:
          "Workforce participation gap, political representation, and pay equity (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      // ── DE-specific ──────────────────────────────────────────────────────
      {
        id: "kitaCoverage",
        name: "Kita Coverage",
        unit: "percent",
        description: "Kita (childcare) placement coverage: Rechtsanspruch auf Kita-Platz",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      {
        id: "wohnungsBauRate",
        name: "Housing Construction Rate",
        shortName: "Wohnungsbau",
        unit: "rate",
        description: "New housing units constructed per 1k residents per year",
        isHigherBetter: true,
        decimals: 1,
        minValue: 0,
        maxValue: 20,
        countryScope: "de",
      },
      // ── CN-specific ──────────────────────────────────────────────────────
      {
        id: "hukouMobility",
        name: "Hukou Mobility",
        unit: "index",
        description: "户口 transfer ease (inter-region): higher = freer internal migration",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      // ── IE-specific ──────────────────────────────────────────────────────
      {
        id: "housingCompletionsRate",
        name: "Housing Completions Rate",
        shortName: "Completions",
        unit: "rate",
        description: "New dwellings per 1k residents per year (Housing for All target ≈ 6.5)",
        isHigherBetter: true,
        decimals: 1,
        minValue: 0,
        maxValue: 20,
        countryScope: "ie",
      },
      {
        id: "vacantPropertyRate",
        name: "Vacant Property Rate",
        shortName: "Vacancy",
        unit: "percent",
        description: "% of dwellings recorded vacant in Census",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "rentalPressureIndex",
        name: "Rental Pressure Index",
        shortName: "Rental Pressure",
        unit: "index",
        description: "Rent as % of median income: drives Rent Pressure Zone designation",
        isHigherBetter: false,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "irishLanguageStrength",
        name: "Irish Language Strength",
        shortName: "Gaeilge",
        unit: "percent",
        description: "% claiming some Gaeilge ability (Census); Gaeltacht / cultural vitality",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
    ],
  },
  {
    id: "governance",
    name: "Governance",
    description: "Government effectiveness and civic participation indicators",
    icon: "building-library",
    metrics: [
      {
        id: "governmentTransparency",
        minValue: 0,
        maxValue: 100,
        name: "Government Transparency Score",
        shortName: "Transparency",
        unit: "index",
        description: "How open the government is here (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "budgetBalance",
        name: "Budget Balance",
        unit: "percent",
        description: "Budget surplus/deficit as percentage of GDP",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
        // S1: surplus/deficit %. Without an explicit negative minValue the default
        // [0,100] clamp floored every deficit at 0 — silently inert on ~97 spending
        // laws and the half of the P6 "spend = win" brake that runs through here.
        minValue: -100,
        maxValue: 100,
      },
      {
        id: "debtToGdp",
        name: "National Debt to GDP",
        shortName: "Debt to GDP",
        unit: "percent",
        description: "Total government debt as share of GDP",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 1,
        minValue: 0,
        maxValue: 300,
      },
      {
        id: "corruptionIndex",
        minValue: 0,
        maxValue: 100,
        name: "Corruption Percentage Index",
        shortName: "Corruption Index",
        unit: "index",
        description: "Perceived corruption level (0 = least, 100 = most)",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "voterTurnout",
        minValue: 0,
        maxValue: 100,
        name: "Voter Turnout",
        unit: "percent",
        description: "Average voter turnout in elections",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 1,
      },
      {
        id: "publicTrust",
        minValue: 0,
        maxValue: 100,
        name: "Public Trust",
        unit: "percent",
        description: "Percentage of residents trusting state government",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      // ── P6a axis metrics (EXCLUDED from approval until the P6d cutover) ──
      {
        id: "civilLiberties",
        minValue: 0,
        maxValue: 100,
        name: "Civil Liberties",
        unit: "index",
        description: "Privacy, personal freedom, and due-process protections (0-100)",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "nationalPride",
        minValue: 0,
        maxValue: 100,
        name: "National Pride",
        unit: "index",
        description: "National identity and prestige sentiment (0-100)",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "militaryReadiness",
        minValue: 0,
        maxValue: 100,
        name: "Military Readiness",
        unit: "index",
        description: "Armed-forces operational readiness sustained by defense funding (0-100)",
        isHigherBetter: true,
        decimals: 1,
      },
      // ── Axis metric (P6d pattern: electorate-weighted approval term) ──
      {
        id: "borderSecurity",
        minValue: 0,
        maxValue: 100,
        name: "Border Security",
        unit: "index",
        description:
          "Enforcement and control of entry at the national border, including screening capacity and interior compliance (0-100)",
        isHigherBetter: true,
        decimals: 1,
      },
      {
        id: "coDeterminationQuality",
        name: "Co-Determination Quality",
        shortName: "Co-Determination",
        unit: "index",
        description: "Quality of worker board representation and collective bargaining (0-100)",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "devolutionSatisfaction",
        name: "Devolution Satisfaction Index",
        shortName: "Devolution Satisfaction",
        unit: "index",
        description:
          "Public satisfaction with the balance of powers between national and regional government",
        isHigherBetter: true,
        decimals: 1,
        minValue: 10,
        maxValue: 100,
      },
      {
        id: "independenceDesire",
        name: "Independence Desire",
        shortName: "Independence",
        unit: "index",
        description:
          "Regional sentiment toward leaving the UK (or unifying with Ireland in NI); 0 = staunchly against, 50 = neutral, 100 = full separation/reunification",
        // Framed from the central-government POV — higher = more strain on the
        // union. The FM's Devolution tab uses its own colouring scheme.
        isHigherBetter: false,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "uk",
        regionDisplayNames: {
          NIR: "Reunification Desire",
        },
      },
      {
        id: "roboticsAdoption",
        minValue: 0,
        maxValue: 100,
        name: "Robotics Adoption",
        unit: "index",
        description: "Industrial and service robotics adoption (0-100)",
        detailedDescription:
          "Industrial and service robotics adoption (0-100). Higher = more advanced.",
        isHigherBetter: true,
        decimals: 0,
      },
      // ── DE-specific ──────────────────────────────────────────────────────
      {
        id: "schuldenbremseHeadroom",
        name: "Schuldenbremse Headroom",
        shortName: "Debt Brake",
        unit: "percent",
        description: "Structural-deficit room under Art. 109 GG Schuldenbremse (% of GDP)",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 2,
        minValue: -1,
        maxValue: 1,
        countryScope: "de",
      },
      {
        id: "bundeswehrReadiness",
        name: "Bundeswehr Readiness",
        unit: "percent",
        description: "Materielle Einsatzbereitschaft: operational readiness of Bundeswehr assets",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      {
        id: "rentenStabilitaet",
        name: "Pension Stability",
        shortName: "Rente",
        unit: "index",
        description: "Pension sustainability: Rentenniveau vs Beitragssatz balance",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      {
        id: "euCohesionScore",
        name: "EU Cohesion Score",
        shortName: "EU Cohesion",
        unit: "index",
        description: "DE-EU integration alignment and pro-European foreign-policy score",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "de",
      },
      // ── CN-specific ──────────────────────────────────────────────────────
      {
        id: "partyDiscipline",
        name: "Party Discipline",
        unit: "index",
        description: "CCP internal cohesion + anti-corruption intensity + ideological compliance",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      {
        id: "socialCreditCoverage",
        name: "Social Credit Coverage",
        shortName: "Social Credit",
        unit: "percent",
        description: "社会信用体系 social credit system deployment depth",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      {
        id: "taiwanStraitTension",
        name: "Taiwan Strait Tension",
        shortName: "Strait Tension",
        unit: "index",
        description: "Cross-strait political-military tension level (lower = de-escalation)",
        isHigherBetter: false,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      {
        id: "beltAndRoadEngagement",
        name: "Belt and Road Engagement",
        shortName: "BRI",
        unit: "index",
        description: "一带一路 participation depth + partner-country count",
        isHigherBetter: true,
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "cn",
      },
      // ── IE-specific ──────────────────────────────────────────────────────
      {
        id: "unityReferendumSupport",
        name: "Unity Referendum Support",
        shortName: "Unity Polling",
        unit: "percent",
        description:
          "RoI polling % favouring North-South unity (mirrors UK independenceDesire from the Republic side)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
      {
        id: "directProvisionLoad",
        name: "Direct Provision Load",
        shortName: "DP Load",
        unit: "percent",
        description: "IPAS centres % capacity utilization (higher = system strain)",
        isHigherBetter: false,
        formatSuffix: "%",
        decimals: 0,
        minValue: 0,
        maxValue: 100,
        countryScope: "ie",
      },
    ],
  },
  {
    id: "population",
    name: "Population",
    description: "Demographic trends and population indicators",
    icon: "user-group",
    metrics: [
      {
        id: "populationGrowth",
        name: "Population Growth Rate",
        shortName: "Population Growth",
        unit: "percent",
        description: "Annual population growth rate",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 2,
        // S1: can be negative (population decline). The default [0,100] floor made
        // declines impossible; the design's demographic engine requires this range.
        minValue: -3,
        maxValue: 5,
      },
      {
        id: "urbanizationRate",
        minValue: 0,
        maxValue: 100,
        name: "Urbanization Rate",
        shortName: "Urbanization",
        unit: "percent",
        description: "Percentage of population living in urban areas",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 0,
      },
      {
        id: "medianAge",
        minValue: 10,
        maxValue: 80,
        name: "Median Age",
        unit: "years",
        description: "Median age of the population",
        isHigherBetter: false,
        formatSuffix: " years",
        decimals: 1,
      },
      {
        id: "migrationRate",
        name: "Migration Rate",
        unit: "percent",
        description: "Net migration as percentage of population",
        isHigherBetter: true,
        formatSuffix: "%",
        decimals: 2,
        // S1: net migration can be negative (net emigration). The default [0,100]
        // floor made restrictive-immigration laws (effectDirection -1) no-ops.
        minValue: -5,
        maxValue: 5,
      },
      {
        id: "demographicDecline",
        minValue: 0,
        maxValue: 100,
        name: "Demographic Decline",
        unit: "index",
        description: "Rate of population aging and shrinkage (0-100, higher = more severe)",
        detailedDescription:
          "Rate of population aging and shrinkage (0-100). Lower = healthier demographics.",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "birthRate",
        minValue: 0,
        maxValue: 100,
        name: "Birth Rate",
        unit: "index",
        description: "Fertility rate and family formation (0-100)",
        detailedDescription:
          "Fertility rate, family formation, childcare availability, and parental support (0-100). Higher = better.",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "sexRatio",
        name: "Sex Ratio",
        unit: "percent",
        description: "Share of the population that is male (balanced ≈ 50)",
        detailedDescription:
          "Share male, 0-100. A derived readout of the age×sex population structure. A healthy population settles a point or two above 50 (more boys are born; the older tail is female-majority). Not a policy dial; its drivers are migration composition and the sex ratio at birth.",
        // Derived target-band readout, NOT a monotonic approval lever — excluded
        // from approval scoring (see governmentApproval APPROVAL_EXCLUDED_METRICS).
        // isHigherBetter is set false only to satisfy the required field; the
        // exclusion is what actually keeps it out of the score.
        isHigherBetter: false,
        formatSuffix: "% male",
        decimals: 1,
        minValue: 0,
        maxValue: 100,
      },
      {
        id: "dependencyRatio",
        name: "Dependency Ratio",
        unit: "rate",
        description: "Dependents (under 18 + over 64) per working-age person",
        detailedDescription:
          "Derived readout of the age structure: youth plus seniors divided by the working-age population. Higher = heavier support burden on workers. Excluded from approval scoring.",
        isHigherBetter: false,
        decimals: 2,
        minValue: 0,
        maxValue: 3,
      },
    ],
  },
  {
    id: "mediaInformation",
    name: "Media & Information",
    description: "Media landscape and information quality indicators",
    icon: "newspaper",
    metrics: [
      {
        id: "mediaPolarization",
        minValue: 0,
        maxValue: 100,
        name: "Media Polarization Index",
        shortName: "Media Polarization",
        unit: "index",
        description: "How polarized the media is here (0-100, lower = less polarized)",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "disinformationRisk",
        minValue: 0,
        maxValue: 100,
        name: "Disinformation Risk",
        shortName: "Disinfo Risk",
        unit: "index",
        description: "How exposed people are to misinformation (0-100, lower = less risk)",
        isHigherBetter: false,
        decimals: 0,
      },
      {
        id: "pressFreedom",
        minValue: 0,
        maxValue: 100,
        name: "Press Freedom Score",
        shortName: "Press Freedom",
        unit: "index",
        description: "How free the local press is here (0-100, higher = more free)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "socialMediaSentiment",
        name: "Social Media Sentiment",
        shortName: "Social Sentiment",
        unit: "index",
        description: "Average sentiment score on social media (-100 to +100)",
        isHigherBetter: true,
        decimals: 0,
        // S1: bipolar metric. Without an explicit negative minValue the default
        // [0,100] floor truncated the entire negative half its description promises.
        minValue: -100,
        maxValue: 100,
      },
      {
        id: "newsTrust",
        minValue: 0,
        maxValue: 100,
        name: "News Trust Index",
        shortName: "News Trust",
        unit: "index",
        description: "How much the public trusts local news (0-100)",
        isHigherBetter: true,
        decimals: 0,
      },
      {
        id: "bbcTrust",
        name: "Public Broadcaster Trust Index",
        shortName: "Public Broadcaster Trust",
        unit: "index",
        description:
          "Public trust in public service broadcasting as an impartial information source",
        isHigherBetter: true,
        decimals: 1,
        minValue: 10,
        maxValue: 100,
      },
      // P6a axis metric (EXCLUDED from approval until the P6d cutover).
      {
        id: "stateMediaControl",
        minValue: 0,
        maxValue: 100,
        name: "State Media Control",
        unit: "index",
        description: "Degree of state control over media and information (0-100, lower is freer)",
        isHigherBetter: false,
        decimals: 1,
      },
    ],
  },
];

// Country dashboards now use one uniform metric catalog. `countryId` is kept in
// the signature for compatibility with seed scripts and UI callers.
export function getMetricsForCountry(_countryId: MetricCountryCode): MetricCategory[] {
  return metricCategories.map((cat) => ({
    ...cat,
    metrics: [...cat.metrics],
  }));
}

// Helper to get metric definition by category and metric ID
export function getMetricDefinition(
  categoryId: MetricCategoryId,
  metricId: string
): MetricDefinition | undefined {
  const category = metricCategories.find((c) => c.id === categoryId);
  return category?.metrics.find((m) => m.id === metricId);
}

// Helper to get category by ID
export function getMetricCategory(categoryId: MetricCategoryId): MetricCategory | undefined {
  return metricCategories.find((c) => c.id === categoryId);
}

// Helper to format a metric value for display
export function formatMetricValue(value: number, definition: MetricDefinition): string {
  const decimals = definition.decimals ?? 0;
  const formatted = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${definition.formatPrefix || ""}${formatted}${definition.formatSuffix || ""}`;
}

// Display-layer helpers
// These let UI consumers treat this module as the single source of truth for
// metric presentation: `MetricsCategoryDisplay`, the region metric detail page,
// and the national metrics dashboard all import from here.

/** Human-readable labels for each metric category. */
export const CATEGORY_LABELS: Record<MetricCategoryId, string> = {
  economic: "Economic",
  education: "Education",
  healthcare: "Healthcare",
  infrastructure: "Infrastructure",
  publicSafety: "Public Safety",
  environment: "Environment",
  social: "Social",
  governance: "Governance",
  population: "Population",
  mediaInformation: "Media & Info",
};

/**
 * Flat-by-category view of all metric definitions, keyed as
 * `definitions[categoryId][metricId]`. Built once at module load from
 * `metricCategories`. Consumers that previously kept their own nested copy
 * (see `MetricsCategoryDisplay.tsx`, the region metric detail page) should
 * use this instead.
 */
export const METRIC_DEFS_BY_CATEGORY: Record<
  MetricCategoryId,
  Record<string, MetricDefinition>
> = metricCategories.reduce(
  (acc, cat) => {
    const catMap: Record<string, MetricDefinition> = {};
    for (const metric of cat.metrics) catMap[metric.id] = metric;
    acc[cat.id] = catMap;
    return acc;
  },
  {} as Record<MetricCategoryId, Record<string, MetricDefinition>>
);

function findMetricDefinition(metricId: string): MetricDefinition | undefined {
  for (const cat of metricCategories) {
    const found = cat.metrics.find((m) => m.id === metricId);
    if (found) return found;
  }
  return undefined;
}

/** Short display name (falls back to full name). */
export function getMetricShortName(metricId: string): string | undefined {
  const def = findMetricDefinition(metricId);
  return def?.shortName ?? def?.name;
}

/** Full display name. */
export function getMetricName(metricId: string): string | undefined {
  return findMetricDefinition(metricId)?.name;
}

/** Long directional description (falls back to `description`). */
export function getMetricDetailedDescription(metricId: string): string | undefined {
  const def = findMetricDefinition(metricId);
  return def?.detailedDescription ?? def?.description;
}

/** @deprecated The metric catalog is now uniform across countries. */
export function getMetricCountryScope(metricId: string): MetricCountryScopeSetting | undefined {
  void metricId;
  return undefined;
}

// Flat maps derived at module load (drop-in replacements for the former
// per-metric constant maps).

function buildFlatMap<T>(select: (def: MetricDefinition) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const cat of metricCategories) {
    for (const metric of cat.metrics) {
      const value = select(metric);
      if (value !== undefined) out[metric.id] = value;
    }
  }
  return out;
}

/** Map of metricId -> short display name (falls back to full name). */
export const METRIC_NAMES: Record<string, string> = buildFlatMap((d) => d.shortName ?? d.name);

/** Map of metricId -> detailed directional description. */
export const METRIC_DESCRIPTIONS: Record<string, string> = buildFlatMap(
  (d) => d.detailedDescription ?? d.description
);

/** @deprecated The metric catalog is now uniform across countries. */
export const METRIC_COUNTRY_SCOPE: Record<string, MetricCountryScopeSetting> = {};

export default metricCategories;
