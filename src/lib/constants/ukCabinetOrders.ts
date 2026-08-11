/**
 * UK Ministerial Orders configuration.
 * Defines the 2 available orders per cabinet position (32 total).
 * Orders are time-limited metric bonuses costing 1 ministerial action each.
 * Imported by the order-issuing API, turn processing, and the UI order panel.
 *
 * Shared types and constants live in cabinetMechanicsTypes.ts — re-exported
 * here for backwards compatibility with existing imports.
 */
export type { MinisterialOrderEffect, MinisterialOrderConfig } from "./cabinetMechanicsTypes";
export {
  MINISTERIAL_ACTION_CAP,
  MINISTERIAL_ACTION_REGEN_INTERVAL,
  DEFAULT_ORDER_DURATION,
} from "./cabinetMechanicsTypes";

import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";
// ── Orders per position ──────────────────────────────────────────────────────

export const UK_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  // ── 0. Deputy Prime Minister ────────────────────────────────────────────────
  deputy_prime_minister: [
    {
      id: "government_coordination_drive",
      name: "Government Coordination Drive",
      description:
        "Launch a cross-government coordination drive to improve delivery, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.04, scope: "national" }],
    },
    {
      id: "public_trust_campaign",
      name: "Public Trust Campaign",
      description:
        "Lead a national campaign to rebuild public confidence in government, for a temporary boost to public trust.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 1. First Secretary of State ──────────────────────────────────────────────
  first_secretary_of_state: [
    {
      id: "national_skills_programme",
      name: "National Skills Programme",
      description:
        "Launch a national skills development programme, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
    {
      id: "community_cohesion_initiative",
      name: "Community Cohesion Initiative",
      description:
        "Fund a national community cohesion initiative, for a temporary boost to social cohesion.",
      duration: 24,
      effects: [{ metric: "socialCohesion", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 2. Chancellor of the Exchequer ────────────────────────────────────────
  chancellor: [
    {
      id: "emergency_budget_review",
      name: "Emergency Budget Review",
      description:
        "Conduct an emergency review of the national budget, unlocking efficiency gains for a temporary GDP growth bonus.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "fiscal_stimulus",
      name: "Fiscal Stimulus Package",
      description:
        "Deploy a targeted fiscal stimulus package to boost employment, for a temporary drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 2. Foreign Secretary ──────────────────────────────────────────────────
  foreign_secretary: [
    {
      id: "diplomatic_summit",
      name: "Diplomatic Summit",
      description:
        "Host a major diplomatic summit to strengthen trade relationships, for an enhanced GDP growth bonus for the order duration.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "emergency_humanitarian_response",
      name: "Emergency Humanitarian Response",
      description:
        "Lead an emergency humanitarian response that raises the UK's international standing and boosts domestic government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.05, scope: "national" }],
    },
  ],

  // ── 3. Home Secretary ─────────────────────────────────────────────────────
  home_secretary: [
    {
      id: "enhanced_policing_directive",
      name: "Enhanced Policing Directive",
      description: "Issue a national enhanced policing directive, for a temporary drop in crime.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "public_safety_initiative",
      name: "Public Safety Initiative",
      description:
        "Launch a national public safety campaign, for a temporary boost to the public safety index.",
      duration: 24,
      effects: [{ metric: "publicSafety", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 4. Secretary of State for Defence ────────────────────────────────────
  defence_secretary: [
    {
      id: "national_defence_review",
      name: "National Defence Review",
      description:
        "Conduct a comprehensive national defence review that reassures the public, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.03, scope: "national" }],
    },
    {
      id: "veterans_support_programme",
      name: "Veterans Support Programme",
      description:
        "Launch a veterans employment support programme in the region with the primary military base, for a temporary regional drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.04, scope: "regional" }],
    },
  ],

  // ── 5. Lord Chancellor & Secretary of State for Justice ──────────────────
  justice_secretary: [
    {
      id: "judicial_reform_initiative",
      name: "Judicial Reform Initiative",
      description:
        "Launch a national judicial reform programme targeting corruption, for a temporary drop in the corruption index.",
      duration: 24,
      effects: [{ metric: "corruptionIndex", modifier: -0.04, scope: "national" }],
    },
    {
      id: "court_efficiency_programme",
      name: "Court Efficiency Programme",
      description:
        "Implement court efficiency improvements that speed case resolution, for a temporary national drop in crime.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 6. Secretary of State for Health and Social Care ─────────────────────
  health_secretary: [
    {
      id: "nhs_emergency_funding",
      name: "NHS Emergency Funding",
      description:
        "Release emergency NHS funding to clear backlogs and improve service delivery, for a temporary boost to healthcare quality.",
      duration: 24,
      effects: [{ metric: "healthcareQuality", modifier: 0.05, scope: "national" }],
    },
    {
      id: "social_care_investment",
      name: "Social Care Investment",
      description:
        "Deploy emergency social care investment to improve community support systems, for a temporary boost to social cohesion.",
      duration: 24,
      effects: [{ metric: "socialCohesion", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 7. Secretary of State for Education ──────────────────────────────────
  education_secretary: [
    {
      id: "national_education_review",
      name: "National Education Review",
      description:
        "Conduct a national education review that identifies and implements quick-win improvements, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
    {
      id: "teacher_recruitment_drive",
      name: "Teacher Recruitment Drive",
      description:
        "Launch an emergency teacher recruitment drive to address shortfalls, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 8. Secretary of State for Business and Trade ──────────────────────────
  business_secretary: [
    {
      id: "trade_mission",
      name: "Trade Mission",
      description:
        "Lead a high-profile international trade mission to secure new commercial agreements, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "consumer_protection_initiative",
      name: "Consumer Protection Initiative",
      description:
        "Implement a consumer protection initiative targeting price gouging and market manipulation, for a temporary drop in cost of living.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 9. Secretary of State for Levelling Up, Housing & Communities ─────────
  levelling_secretary: [
    {
      id: "regional_investment_programme",
      name: "Regional Investment Programme",
      description:
        "Deploy a targeted regional investment programme to the lowest-performing regions, for a temporary regional GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.05, scope: "regional" }],
    },
    {
      id: "community_regeneration_fund",
      name: "Community Regeneration Fund",
      description:
        "Release a community regeneration fund for deprived regions, for a temporary regional boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.04, scope: "regional" }],
    },
  ],

  // ── 10. Secretary of State for Transport ──────────────────────────────────
  transport_secretary: [
    {
      id: "national_infrastructure_review",
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
      id: "transport_connectivity_programme",
      name: "Transport Connectivity Programme",
      description:
        "Launch a connectivity improvement programme in the infrastructure investment priority region, for a temporary regional GDP boost through better accessibility.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "regional" }],
    },
  ],

  // ── Minister of Agriculture, Fisheries and Food (retired 2001 → DEFRA) ─────
  agriculture_secretary: [
    {
      id: "rural_support_programme",
      name: "Rural Support Programme",
      description:
        "Direct targeted support to farms and rural industries, for a temporary boost to national economic growth.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "food_security_drive",
      name: "Food Security Drive",
      description:
        "Champion domestic food production and supply resilience, for a temporary boost to public trust.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 11. Secretary of State for Environment, Food and Rural Affairs ─────────
  environment_secretary: [
    {
      id: "green_energy_initiative",
      name: "Green Energy Initiative",
      description:
        "Launch a national green energy initiative accelerating the transition to clean power, for a temporary drop in carbon emissions.",
      duration: 24,
      effects: [{ metric: "carbonEmissions", modifier: -0.05, scope: "national" }],
    },
    {
      id: "agricultural_support_package",
      name: "Agricultural Support Package",
      description:
        "Deploy an agricultural support package to stabilise food supply chains, for a temporary drop in cost of living.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 12. Secretary of State for Work and Pensions ──────────────────────────
  work_secretary: [
    {
      id: "national_jobs_programme",
      name: "National Jobs Programme",
      description:
        "Launch a national jobs programme creating employment opportunities across all regions, for a temporary drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "cost_of_living_support_package",
      name: "Cost of Living Support Package",
      description:
        "Deploy a targeted cost of living support package including energy bill relief and household grants, for a temporary reduction.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 13. Secretary of State for Northern Ireland ───────────────────────────
  northern_ireland: [
    {
      id: "ni_development_fund",
      name: "NI Development Fund",
      description:
        "Release a targeted development fund for Northern Ireland, for a temporary GDP boost in NIR.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.05, scope: "regional" }],
    },
    {
      id: "ni_community_relations_initiative",
      name: "Community Relations Initiative",
      description:
        "Fund a community relations programme in Northern Ireland, for a temporary boost to government approval in NIR.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.05, scope: "regional" }],
    },
  ],

  // ── 14. Secretary of State for Scotland ───────────────────────────────────
  scotland: [
    {
      id: "scotland_development_fund",
      name: "Scotland Development Fund",
      description:
        "Release a targeted development fund for Scotland, for a temporary GDP boost in SCO.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.05, scope: "regional" }],
    },
    {
      id: "scotland_community_initiative",
      name: "Scottish Community Initiative",
      description:
        "Fund a community improvement programme in Scotland, for a temporary boost to government approval in SCO.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.05, scope: "regional" }],
    },
  ],

  // ── 15. Secretary of State for Wales ──────────────────────────────────────
  wales: [
    {
      id: "wales_development_fund",
      name: "Wales Development Fund",
      description:
        "Release a targeted development fund for Wales, for a temporary GDP boost in WAL.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.05, scope: "regional" }],
    },
    {
      id: "wales_community_initiative",
      name: "Welsh Community Initiative",
      description:
        "Fund a community improvement programme in Wales, for a temporary boost to government approval in WAL.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.05, scope: "regional" }],
    },
  ],
};
