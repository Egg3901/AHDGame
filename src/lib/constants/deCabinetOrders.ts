/**
 * Germany (DE) Ministerial Orders configuration.
 * 2 orders per cabinet position — 22 total.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";

export const DE_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  // ── 1. Federal Minister of Finance ──────────────────────────────────────────
  finance_minister: [
    {
      id: "de_emergency_budget_review",
      name: "Emergency Budget Review",
      description:
        "Conduct an emergency review of the federal budget to unlock efficiency gains, for a temporary GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "de_fiscal_stimulus",
      name: "Fiscal Stimulus Package",
      description:
        "Deploy a targeted fiscal stimulus package to boost employment, for a temporary drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 2. Federal Minister for Foreign Affairs ──────────────────────────────────
  foreign_minister: [
    {
      id: "de_diplomatic_summit",
      name: "Diplomatic Summit",
      description:
        "Host a major diplomatic summit to strengthen Germany's trade relationships, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "de_foreign_aid_initiative",
      name: "Foreign Aid Initiative",
      description:
        "Lead a high-profile foreign aid initiative to strengthen Germany's international standing and boost domestic public trust.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 3. Federal Minister of the Interior ─────────────────────────────────────
  interior_minister: [
    {
      id: "de_enhanced_policing_directive",
      name: "Enhanced Policing Directive",
      description: "Issue a national enhanced policing directive, for a temporary drop in crime.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "de_public_safety_initiative",
      name: "Public Safety Initiative",
      description:
        "Launch a national public safety campaign, for a temporary boost to public safety confidence.",
      duration: 24,
      effects: [{ metric: "publicSafetyConfidence", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 4. Federal Minister of Defence ──────────────────────────────────────────
  defense_minister: [
    {
      id: "de_national_defence_review",
      name: "National Defence Review",
      description:
        "Conduct a comprehensive defence review that reassures the public, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.03, scope: "national" }],
    },
    {
      id: "de_veterans_support_programme",
      name: "Veterans Support Programme",
      description:
        "Launch a veterans employment support programme in the defence-priority Land, for a temporary regional drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.04, scope: "regional" }],
    },
  ],

  // ── 5. Federal Minister of Justice ──────────────────────────────────────────
  justice_minister: [
    {
      id: "de_judicial_reform_initiative",
      name: "Judicial Reform Initiative",
      description:
        "Launch a national judicial reform programme targeting corruption, for a temporary drop in the corruption index.",
      duration: 24,
      effects: [{ metric: "corruptionIndex", modifier: -0.04, scope: "national" }],
    },
    {
      id: "de_court_efficiency_programme",
      name: "Court Efficiency Programme",
      description:
        "Implement court efficiency improvements that speed case resolution, for a temporary national drop in crime.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 6. Federal Minister for Economic Affairs ─────────────────────────────────
  economy_minister: [
    {
      id: "de_trade_mission",
      name: "Trade Mission",
      description:
        "Lead a high-profile international trade mission to secure new commercial agreements, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "de_mittelstand_support_programme",
      name: "Mittelstand Support Programme",
      description:
        "Deploy targeted support for small and medium-sized enterprises, for a temporary national boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 7. Federal Minister of Labour and Social Affairs ────────────────────────
  labour_minister: [
    {
      id: "de_national_jobs_programme",
      name: "National Jobs Programme",
      description:
        "Launch a national jobs programme creating employment opportunities across all Länder, for a temporary drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "de_cost_of_living_support",
      name: "Cost of Living Support Package",
      description:
        "Deploy a targeted cost of living support package including welfare supplements and household grants, for a temporary reduction.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 8. Federal Minister of Health ───────────────────────────────────────────
  health_minister: [
    {
      id: "de_healthcare_emergency_funding",
      name: "Healthcare Emergency Funding",
      description:
        "Release emergency healthcare funding to clear backlogs and improve service delivery, for a temporary boost to healthcare quality.",
      duration: 24,
      effects: [{ metric: "healthcareQuality", modifier: 0.05, scope: "national" }],
    },
    {
      id: "de_elder_care_investment",
      name: "Elder Care Investment",
      description:
        "Deploy emergency elder care investment to improve community support systems, for a temporary boost to elder care quality.",
      duration: 24,
      effects: [{ metric: "elderCareQuality", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 9. Federal Minister for Transport ───────────────────────────────────────
  transport_minister: [
    {
      id: "de_national_infrastructure_review",
      name: "National Infrastructure Review",
      description:
        "Conduct a national infrastructure review that fast-tracks priority projects, for a temporary boost to road condition and broadband access.",
      duration: 24,
      effects: [
        { metric: "roadCondition", modifier: 0.04, scope: "national" },
        { metric: "broadbandAccess", modifier: 0.04, scope: "national" },
      ],
    },
    {
      id: "de_transport_connectivity_programme",
      name: "Transport Connectivity Programme",
      description:
        "Launch a connectivity improvement programme in the infrastructure investment priority Land, for a temporary regional GDP boost through better accessibility.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "regional" }],
    },
  ],

  // ── 10. Federal Minister of Education and Research ──────────────────────────
  education_minister: [
    {
      id: "de_national_education_review",
      name: "National Education Review",
      description:
        "Conduct a national education review implementing quick-win improvements, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
    {
      id: "de_stem_investment_drive",
      name: "STEM Investment Drive",
      description:
        "Launch a targeted STEM investment drive to address skills gaps, for a temporary boost to test performance.",
      duration: 24,
      effects: [{ metric: "testPerformance", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 11. Federal Minister for the Environment ─────────────────────────────────
  environment_minister: [
    {
      id: "de_energiewende_acceleration",
      name: "Energiewende Acceleration",
      description:
        "Accelerate Germany's energy transition programme, for a temporary drop in carbon emissions.",
      duration: 24,
      effects: [{ metric: "carbonEmissions", modifier: -0.05, scope: "national" }],
    },
    {
      id: "de_clean_air_initiative",
      name: "Clean Air Initiative",
      description:
        "Launch a national clean air initiative targeting industrial and transport emissions, for a temporary air quality boost.",
      duration: 24,
      effects: [{ metric: "airQuality", modifier: -0.04, scope: "national" }], // AQI: lower = cleaner (P3c sign fix)
    },
  ],
};
