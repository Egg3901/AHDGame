/**
 * Political Metrics v1 — new metric domain, fully independent of the legacy
 * stateMetrics/metricDefinitions/metricEngine stack (do not import from those).
 * Spec: docs/superpowers/specs/2026-07-16-political-metrics-catalog-design.md
 */

export const POLITICAL_METRIC_COUNTRY_IDS = ["US", "UK", "RU", "DD"] as const;
export type PoliticalMetricsCountryId = (typeof POLITICAL_METRIC_COUNTRY_IDS)[number];

export const REQUIRED_CATEGORY_LEANS = [-5, -3, -1, 0, 1, 3, 5] as const;
export type PoliticalLean = (typeof REQUIRED_CATEGORY_LEANS)[number];

export const POLITICAL_METRIC_CATEGORIES = [
  {
    id: "economy",
    displayName: "Economy & Labor",
    ukDisplayName: "Economy & Labour",
    icon: "currency",
  },
  { id: "education", displayName: "Education, Science & Skills", icon: "cap" },
  { id: "health", displayName: "Health & Social Protection", icon: "heart" },
  { id: "infrastructure", displayName: "Infrastructure, Housing & Connectivity", icon: "building" },
  { id: "order", displayName: "Public Order & Justice", icon: "scales" },
  { id: "environment", displayName: "Environment, Energy & Resources", icon: "globe" },
  { id: "society", displayName: "Society & Demography", icon: "users" },
  { id: "governance", displayName: "Governance, Rights & Information", icon: "library" },
  {
    id: "defense",
    displayName: "Defense & Foreign Affairs",
    ukDisplayName: "Defence & Foreign Affairs",
    icon: "shield",
  },
] as const;
export type PoliticalMetricCategoryId = (typeof POLITICAL_METRIC_CATEGORIES)[number]["id"];

/** Seven slugs per category in lean order (-5 → +5). Slugs and derived ids are stable forever. */
export const FAMILY_SLUGS = {
  economy: [
    "workerSecurity",
    "mobility",
    "householdIncome",
    "stability",
    "productivity",
    "fiscal",
    "competition",
  ],
  education: [
    "universalSchooling",
    "teacherCorps",
    "adultSkills",
    "attainment",
    "research",
    "standards",
    "choice",
  ],
  health: [
    "universalCare",
    "socialInsurance",
    "prevention",
    "outcomes",
    "responsibility",
    "providerChoice",
    "systemEfficiency",
  ],
  infrastructure: [
    "publicHousing",
    "transit",
    "utilities",
    "condition",
    "highways",
    "ownership",
    "development",
  ],
  order: [
    "dueProcess",
    "legalAid",
    "communityTrust",
    "safety",
    "courts",
    "policeStrength",
    "deterrence",
  ],
  environment: [
    "conservation",
    "stewardship",
    "urbanAir",
    "energySecurity",
    "resourceDev",
    "affordability",
    "extraction",
  ],
  society: [
    "integration",
    "womensOpportunity",
    "socialMobility",
    "demography",
    "civicLife",
    "familyStability",
    "tradition",
  ],
  governance: [
    "participation",
    "openness",
    "localAutonomy",
    "integrity",
    "administration",
    "decisiveness",
    "centralAuthority",
  ],
  defense: [
    "diplomacy",
    "institutions",
    "softPower",
    "security",
    "defenseIndustry",
    "armedForces",
    "projection",
  ],
} as const satisfies Record<
  PoliticalMetricCategoryId,
  readonly [string, string, string, string, string, string, string]
>;

/** Literal 63-member union, e.g. "economy.workerSecurity". */
export type PoliticalMetricId = {
  [C in PoliticalMetricCategoryId]: `${C}.${(typeof FAMILY_SLUGS)[C][number]}`;
}[PoliticalMetricCategoryId];

export interface PoliticalMetricFamily {
  id: PoliticalMetricId;
  categoryId: PoliticalMetricCategoryId;
  slug: string;
  /** Political association (-5 strong-left … +5 strong-right); derived from slot position. NEVER a quality judgment. */
  lean: PoliticalLean;
  /** Shared across countries. */
  description: string;
  /** Directional contributor examples shown on metric detail. */
  pos: string[];
  neg: string[];
  /** Era-keyed component-indicator names ("early" pre-information-era, "modern" after). Display flavor only. */
  indicators: { early: string[]; modern: string[] };
  /** Post-reform RU display name, applied only by future gameplay events. */
  reformName?: string;
  higherIsBetter: true;
  /**
   * Era existence window, inclusive at both ends; a null `activeToYear` means
   * the family never retires. Default authoring is always-active — most of
   * these axes are era-independent, so a window is authored only where a
   * family genuinely did not exist as a political axis yet.
   */
  activeFromYear: number;
  activeToYear: number | null;
}
