/**
 * Japan ministerial orders configuration.
 * Two orders per cabinet position. Orders are time-limited metric modifiers
 * that cost one ministerial action each.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";

export const JP_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  chief_cabinet_secretary: [
    {
      id: "transparency_initiative",
      name: "Government Transparency Initiative",
      description:
        "Launch a whole-of-government transparency push to improve trust and message discipline.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
    {
      id: "press_briefing_blitz",
      name: "Press Briefing Blitz",
      description:
        "Run a dense cycle of briefings and disclosures to improve press-freedom sentiment and confidence in government communication.",
      duration: 24,
      effects: [{ metric: "pressFreedom", modifier: 0.03, scope: "national" }],
    },
  ],

  finance_minister: [
    {
      id: "fiscal_stimulus_package",
      name: "Fiscal Stimulus Package",
      description: "Deploy a targeted fiscal package to support demand and employment nationwide.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "employment_subsidy",
      name: "Employment Subsidy Program",
      description:
        "Fund an emergency employment subsidy for small and medium-sized firms to keep workers attached to the labor market.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  foreign_affairs_minister: [
    {
      id: "trade_summit",
      name: "International Trade Summit",
      description:
        "Host a major trade summit to strengthen market access and foreign confidence in Japan's economy.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.02, scope: "national" }],
    },
    {
      id: "diplomatic_exchange",
      name: "Diplomatic Exchange Program",
      description:
        "Launch a cultural and diplomatic exchange to improve international goodwill and domestic confidence in the government's diplomacy.",
      duration: 24,
      effects: [{ metric: "governmentTransparency", modifier: 0.03, scope: "national" }],
    },
  ],

  justice_minister: [
    {
      id: "anti_corruption_raids",
      name: "Anti-Corruption Raids",
      description:
        "Deploy national investigators to pursue corruption networks and signal clean governance.",
      duration: 24,
      effects: [{ metric: "corruptionIndex", modifier: -0.04, scope: "national" }],
    },
    {
      id: "court_backlog_clearance",
      name: "Court Backlog Clearance",
      description:
        "Temporary staffing and case-management support to speed justice delivery and reduce crime spillovers.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.03, scope: "national" }],
    },
  ],

  defense_minister: [
    {
      id: "disaster_readiness_drill",
      name: "National Disaster Readiness Drill",
      description:
        "Coordinate a large-scale civil-defense and disaster-readiness exercise with the Self-Defense Forces.",
      duration: 24,
      effects: [{ metric: "publicSafetyConfidence", modifier: 0.04, scope: "national" }],
    },
    {
      id: "defense_white_paper",
      name: "Defense White Paper Rollout",
      description:
        "Publish and communicate a major readiness review to improve public confidence in national preparedness.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.03, scope: "national" }],
    },
  ],

  economy_minister: [
    {
      id: "startup_accelerator",
      name: "National Startup Accelerator",
      description:
        "Launch a government-backed accelerator network to boost entrepreneurship and commercialization.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
    {
      id: "robotics_investment",
      name: "Robotics Investment Initiative",
      description:
        "Direct capital and procurement support into industrial robotics and automation.",
      duration: 24,
      effects: [{ metric: "roboticsAdoption", modifier: 0.04, scope: "national" }],
    },
  ],

  health_minister: [
    {
      id: "elder_care_expansion",
      name: "Elder Care Expansion",
      description:
        "Fund a temporary expansion of elder care capacity and staffing across the country.",
      duration: 24,
      effects: [{ metric: "elderCareQuality", modifier: 0.04, scope: "national" }],
    },
    {
      id: "work_reform_campaign",
      name: "Work Reform Campaign",
      description:
        "Run an enforcement and public-education campaign against overwork culture and labor violations.",
      duration: 24,
      effects: [{ metric: "workLifeBalance", modifier: 0.04, scope: "national" }],
    },
  ],

  education_minister: [
    {
      id: "education_excellence",
      name: "Education Excellence Initiative",
      description:
        "Deploy additional support for classroom quality and teacher development to improve student outcomes.",
      duration: 24,
      effects: [{ metric: "testPerformance", modifier: 0.03, scope: "national" }],
    },
    {
      id: "skills_training",
      name: "National Skills Training Program",
      description:
        "Partner with industry and schools on an intensive upskilling and technical training push.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
  ],

  land_minister: [
    {
      id: "shinkansen_expansion",
      name: "Shinkansen Expansion Push",
      description:
        "Accelerate planning and funding approvals for high-speed rail and regional transport upgrades.",
      duration: 24,
      effects: [{ metric: "transportEfficiency", modifier: 0.04, scope: "national" }],
    },
    {
      id: "resilience_upgrade",
      name: "Resilience Upgrade Program",
      description:
        "Fast-track evacuation routes, seawalls, and infrastructure hardening to improve disaster preparedness.",
      duration: 24,
      effects: [{ metric: "naturalDisasterPreparedness", modifier: 0.04, scope: "national" }],
    },
  ],

  environment_minister: [
    {
      id: "clean_energy_push",
      name: "Clean Energy Acceleration",
      description:
        "Fast-track renewable approvals and support packages to shift the energy mix faster.",
      duration: 24,
      effects: [{ metric: "renewableEnergy", modifier: 0.04, scope: "national" }],
    },
    {
      id: "air_quality_intervention",
      name: "Air Quality Intervention",
      description: "Deploy targeted monitoring and emissions controls in polluted urban corridors.",
      duration: 24,
      effects: [{ metric: "airQuality", modifier: 0.03, scope: "national" }],
    },
  ],

  internal_affairs_minister: [
    {
      id: "digital_japan",
      name: "Digital Japan Initiative",
      description:
        "Accelerate broadband and digital service deployment for households and local governments.",
      duration: 24,
      effects: [{ metric: "broadbandAccess", modifier: 0.03, scope: "national" }],
    },
    {
      id: "regional_revitalization",
      name: "Regional Revitalization Program",
      description:
        "Deploy incentives and local-government support to stabilize declining regions and attract families and workers.",
      duration: 24,
      effects: [{ metric: "demographicDecline", modifier: -0.04, scope: "national" }],
    },
  ],
};
