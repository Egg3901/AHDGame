/**
 * US Ministerial Orders configuration.
 * Defines the 2 available orders per cabinet position (30 total).
 * Orders are time-limited metric bonuses costing 1 ministerial action each.
 * Imported by the order-issuing API, turn processing, and the UI order panel.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";
import { DEFAULT_ORDER_DURATION } from "./cabinetMechanicsTypes";

// ── Orders per position ──────────────────────────────────────────────────────

export const US_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  // ── 1. Secretary of State ────────────────────────────────────────────────
  secretary_of_state: [
    {
      id: "diplomatic_offensive",
      name: "Diplomatic Offensive",
      description:
        "Launch a diplomatic campaign to secure trade agreements and strengthen alliances, for a temporary national GDP boost.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "international_aid_initiative",
      name: "International Aid Initiative",
      description:
        "Run a high-profile international aid program to raise America's global standing and public trust.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "governance.publicTrust", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 2. Secretary of the Treasury ─────────────────────────────────────────
  secretary_of_treasury: [
    {
      id: "emergency_fiscal_stimulus",
      name: "Emergency Fiscal Stimulus",
      description:
        "Deploy emergency fiscal measures for job creation and consumer spending, for a temporary drop in unemployment.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.unemploymentRate", modifier: -0.03, scope: "national" }],
    },
    {
      id: "federal_reserve_coordination",
      name: "Federal Reserve Coordination",
      description:
        "Coordinate with the Federal Reserve to improve monetary conditions, for a temporary national GDP boost.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.gdpGrowth", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 3. Secretary of Defense ──────────────────────────────────────────────
  secretary_of_defense: [
    {
      id: "national_guard_deployment",
      name: "National Guard Deployment",
      description:
        "Deploy National Guard units to help local police in high-crime areas, for a temporary drop in crime.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "publicSafety.crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "defense_modernization",
      name: "Defense Modernization",
      description:
        "Accelerate defense modernization to boost national readiness and public confidence, for a temporary public safety boost.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [
        { metric: "publicSafety.publicSafetyConfidence", modifier: 0.04, scope: "national" },
      ],
    },
  ],

  // ── 4. Attorney General ──────────────────────────────────────────────────
  attorney_general: [
    {
      id: "federal_task_force",
      name: "Federal Task Force",
      description:
        "Set up a federal task force against organized crime and drug trafficking, for a temporary drop in crime.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "publicSafety.crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "anti_corruption_drive",
      name: "Anti-Corruption Drive",
      description:
        "Launch an anti-corruption investigation into waste and fraud in federal agencies, for a temporary drop in corruption.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "governance.corruptionIndex", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 5. Secretary of the Interior ─────────────────────────────────────────
  secretary_of_interior: [
    {
      id: "conservation_initiative",
      name: "Conservation Initiative",
      description:
        "Expand federal conservation programs to protect ecosystems and public lands, for a temporary rise in protected land.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "environment.protectedLand", modifier: 0.03, scope: "national" }],
    },
    {
      id: "resource_management_reform",
      name: "Resource Management Reform",
      description:
        "Reform resource management to cut pollution from federal land operations, for a temporary air quality improvement.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "environment.airQuality", modifier: -0.04, scope: "national" }], // AQI: lower = cleaner (P3c sign fix)
    },
  ],

  // ── 6. Secretary of Agriculture ──────────────────────────────────────────
  secretary_of_agriculture: [
    {
      id: "farm_relief_program",
      name: "Farm Relief Program",
      description:
        "Deploy emergency farm relief and food distribution to stabilize supply chains, for a temporary drop in food insecurity.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "social.foodInsecurity", modifier: -0.04, scope: "national" }],
    },
    {
      id: "rural_development_grant",
      name: "Rural Development Grant",
      description:
        "Issue rural development grants for infrastructure and jobs in underserved communities, for a temporary drop in poverty.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.povertyRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 7. Secretary of Commerce ─────────────────────────────────────────────
  secretary_of_commerce: [
    {
      id: "trade_mission",
      name: "Trade Mission",
      description:
        "Lead an international trade mission to open new markets for American goods, for a temporary national GDP boost.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "small_business_accelerator",
      name: "Small Business Accelerator",
      description:
        "Launch a small business accelerator offering grants, mentorship, and regulatory relief, for a temporary boost to small business formation.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 8. Secretary of Labor ────────────────────────────────────────────────
  secretary_of_labor: [
    {
      id: "worker_protection_campaign",
      name: "Worker Protection Campaign",
      description:
        "Enforce stronger worker protections and wage compliance audits, for a temporary boost to median income.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.medianIncome", modifier: 0.03, scope: "national" }],
    },
    {
      id: "employment_training_initiative",
      name: "Employment Training Initiative",
      description:
        "Fund workforce retraining programs with industry leaders, for a temporary drop in unemployment.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 9. Secretary of Health and Human Services ────────────────────────────
  secretary_of_health: [
    {
      id: "public_health_emergency_response",
      name: "Public Health Emergency Response",
      description:
        "Mobilize federal health agencies to fight preventable disease and expand screening, for a temporary drop in preventable deaths.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "healthcare.preventableMortality", modifier: -0.04, scope: "national" }],
    },
    {
      id: "medicare_expansion_drive",
      name: "Medicare Expansion Drive",
      description:
        "Fast-track Medicare enrollment and coverage for vulnerable groups, for a temporary drop in the uninsured rate.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "healthcare.uninsuredRate", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 10. Secretary of Housing and Urban Development ───────────────────────
  secretary_of_hud: [
    {
      id: "emergency_housing_vouchers",
      name: "Emergency Housing Vouchers",
      description:
        "Issue emergency housing vouchers to families facing eviction, for a temporary drop in homelessness.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "social.homelessnessRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "community_development_block_grant",
      name: "Community Development Block Grant",
      description:
        "Speed up community development block grants for affordable housing and neighborhood renewal, for a temporary drop in cost of living.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "economic.costOfLiving", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 11. Secretary of Transportation ──────────────────────────────────────
  secretary_of_transportation: [
    {
      id: "infrastructure_emergency_fund",
      name: "Infrastructure Emergency Fund",
      description:
        "Release emergency funds to repair roads, bridges, and highways, for a temporary improvement in road condition.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "infrastructure.roadCondition", modifier: 0.04, scope: "national" }],
    },
    {
      id: "public_transit_expansion",
      name: "Public Transit Expansion",
      description:
        "Fast-track federal grants for public transit modernization and expansion, for a temporary improvement in transit quality.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "infrastructure.publicTransit", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 12. Secretary of Energy ──────────────────────────────────────────────
  secretary_of_energy: [
    {
      id: "grid_modernization_push",
      name: "Grid Modernization Push",
      description:
        "Accelerate power grid modernization with emergency funding for smart grid and resilience upgrades, for a temporary boost to grid reliability.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [
        { metric: "infrastructure.powerGridReliability", modifier: 0.04, scope: "national" },
      ],
    },
    {
      id: "clean_energy_incentive",
      name: "Clean Energy Incentive",
      description:
        "Expand tax credits and fast-track permits for renewable energy, for a temporary boost to renewable energy share.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "environment.renewableEnergy", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 13. Secretary of Education ───────────────────────────────────────────
  secretary_of_education: [
    {
      id: "education_emergency_fund",
      name: "Education Emergency Fund",
      description:
        "Release emergency education funding to fix school shortfalls and expand after-school programs, for a temporary boost to education spending.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "education.educationSpending", modifier: 0.04, scope: "national" }],
    },
    {
      id: "workforce_skills_initiative",
      name: "Workforce Skills Initiative",
      description:
        "Launch a nationwide skills initiative with community colleges and trade schools, for a temporary boost to workforce skill.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "education.workforceSkill", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 14. Secretary of Veterans Affairs ────────────────────────────────────
  secretary_of_veterans: [
    {
      id: "veterans_emergency_fund",
      name: "Veterans Emergency Fund",
      description:
        "Deploy emergency funds to expand VA healthcare and cut wait times for veterans, for a temporary drop in the uninsured rate.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "healthcare.uninsuredRate", modifier: -0.03, scope: "national" }],
    },
    {
      id: "veterans_housing_initiative",
      name: "Veterans Housing Initiative",
      description:
        "Launch a housing initiative providing transitional and permanent housing for homeless veterans, for a temporary drop in homelessness.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "social.homelessnessRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 15. Secretary of Homeland Security ───────────────────────────────────
  secretary_of_homeland: [
    {
      id: "heightened_security_protocol",
      name: "Heightened Security Protocol",
      description:
        "Raise national security protocols and boost federal law enforcement coordination, for a temporary drop in crime.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "publicSafety.crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "border_security_operation",
      name: "Border Security Operation",
      description:
        "Launch a border security operation to manage migration flows and strengthen enforcement, for a temporary adjustment to migration.",
      duration: DEFAULT_ORDER_DURATION,
      effects: [{ metric: "population.migrationRate", modifier: -0.03, scope: "national" }],
    },
  ],
};
