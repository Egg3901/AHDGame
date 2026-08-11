/**
 * Ireland (IE) Ministerial Orders configuration.
 * 2 orders per cabinet position — 38 total.
 *
 * Order naming follows IRL Irish Government press-release conventions
 * (initiatives, reviews, programmes, packages, strategies). English
 * titles per feedback_law_titles_english; optional Gaeilge italic flavor
 * inside descriptions where it adds character.
 */
import type { MinisterialOrderConfig } from "./cabinetMechanicsTypes";

export const IE_MINISTERIAL_ORDERS: Record<string, MinisterialOrderConfig[]> = {
  // ── 1. Taoiseach ────────────────────────────────────────────────────────────
  taoiseach: [
    {
      id: "ie_national_recovery_address",
      name: "National Recovery Address",
      description:
        "Address the nation from Government Buildings on the year ahead, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_all_of_government_initiative",
      name: "All-of-Government Initiative",
      description:
        "Convene a cross-departmental delivery taskforce led by the Department of An Taoiseach, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 2. Tánaiste ─────────────────────────────────────────────────────────────
  tanaiste: [
    {
      id: "ie_coalition_coordination_drive",
      name: "Coalition Coordination Drive",
      description:
        "Lead a coalition coordination drive to reinforce the Programme for Government, for a temporary boost to public trust.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_cabinet_communications_push",
      name: "Cabinet Communications Push",
      description:
        "Run a sustained government communications push, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 3. Minister for Finance ─────────────────────────────────────────────────
  minister_for_finance: [
    {
      id: "ie_emergency_budget_review",
      name: "Emergency Budget Review",
      description:
        "Conduct an emergency review of the Exchequer to unlock efficiency gains, for a temporary GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "ie_fiscal_stimulus_package",
      name: "Fiscal Stimulus Package",
      description:
        "Deploy a targeted fiscal stimulus package to support employment, for a temporary drop in unemployment.",
      duration: 24,
      effects: [{ metric: "unemploymentRate", modifier: -0.03, scope: "national" }],
    },
  ],

  // ── 4. Minister for Public Expenditure ──────────────────────────────────────
  minister_for_public_expenditure: [
    {
      id: "ie_ndp_acceleration_review",
      name: "NDP Acceleration Review",
      description:
        "Fast-track National Development Plan priority projects, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_public_sector_efficiency_drive",
      name: "Public-Sector Efficiency Drive",
      description:
        "Launch a public-sector efficiency drive targeting waste and duplication, for a temporary boost to government transparency.",
      duration: 24,
      effects: [{ metric: "governmentTransparency", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 5. Minister for Foreign Affairs ─────────────────────────────────────────
  minister_for_foreign_affairs: [
    {
      id: "ie_diplomatic_trade_mission",
      name: "Diplomatic Trade Mission",
      description:
        "Lead a high-profile diplomatic trade mission, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_global_ireland_initiative",
      name: "Global Ireland Initiative",
      description:
        "Expand Ireland's diplomatic and cultural footprint abroad through the Global Ireland strategy, for a temporary boost to public trust.",
      duration: 24,
      effects: [{ metric: "publicTrust", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 6. Minister for Enterprise, Trade and Employment ────────────────────────
  minister_for_enterprise: [
    {
      id: "ie_ida_investment_drive",
      name: "IDA Investment Drive",
      description:
        "Lead an IDA Ireland investment-promotion drive targeting strategic foreign investment, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_enterprise_ireland_sme_programme",
      name: "Enterprise Ireland SME Programme",
      description:
        "Deploy an Enterprise Ireland SME support programme, for a temporary boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 7. Minister for Health ──────────────────────────────────────────────────
  minister_for_health: [
    {
      id: "ie_hse_waiting_list_initiative",
      name: "HSE Waiting-List Initiative",
      description:
        "Deploy targeted HSE waiting-list reduction funding, for a temporary drop in HSE waiting-list months.",
      duration: 24,
      effects: [{ metric: "hseWaitingListMonths", modifier: -0.05, scope: "national" }],
    },
    {
      id: "ie_slaintecare_investment_surge",
      name: "Sláintecare Investment Surge",
      description:
        "Front-load Sláintecare implementation funding to expand community-care capacity, for a temporary boost to the national physician rate.",
      duration: 24,
      effects: [{ metric: "physicianRate", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 8. Minister for Education ───────────────────────────────────────────────
  minister_for_education: [
    {
      id: "ie_national_curriculum_review",
      name: "National Curriculum Review",
      description:
        "Launch a national curriculum review delivering quick-win improvements, for a temporary boost to test performance.",
      duration: 24,
      effects: [{ metric: "testPerformance", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_deis_schools_investment",
      name: "DEIS Schools Investment",
      description:
        "Expand DEIS programme funding for schools in disadvantaged areas, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 9. Minister for Further and Higher Education ────────────────────────────
  minister_for_further_higher_education: [
    {
      id: "ie_higher_education_funding_drive",
      name: "Higher Education Funding Drive",
      description:
        "Deploy emergency higher-education funding to address capacity gaps, for a temporary boost to workforce skill.",
      duration: 24,
      effects: [{ metric: "workforceSkill", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_apprenticeship_expansion_programme",
      name: "Apprenticeship Expansion Programme",
      description:
        "Expand the National Apprenticeship Plan with new employer partnerships, for a temporary boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 10. Minister for Housing ────────────────────────────────────────────────
  minister_for_housing: [
    {
      id: "ie_housing_for_all_acceleration",
      name: "Housing for All Acceleration",
      description:
        "Accelerate Housing for All delivery targets through faster planning and purchasing, for a temporary boost to housing completions.",
      duration: 24,
      effects: [{ metric: "housingCompletionsRate", modifier: 0.05, scope: "national" }],
    },
    {
      id: "ie_lda_activation_order",
      name: "LDA Activation Order",
      description:
        "Activate Land Development Agency sites for affordable cost-rental in the priority region, for a temporary regional boost to housing completions.",
      duration: 24,
      effects: [{ metric: "housingCompletionsRate", modifier: 0.05, scope: "regional" }],
    },
  ],

  // ── 11. Minister for Social Protection ──────────────────────────────────────
  minister_for_social_protection: [
    {
      id: "ie_living_wage_supplement_drive",
      name: "Living-Wage Supplement Drive",
      description:
        "Deploy a cost-of-living welfare supplement package, for a temporary drop in cost of living.",
      duration: 24,
      effects: [{ metric: "costOfLiving", modifier: -0.04, scope: "national" }],
    },
    {
      id: "ie_anti_poverty_initiative",
      name: "Anti-Poverty Initiative",
      description:
        "Launch a targeted anti-poverty support package, for a temporary drop in the poverty rate.",
      duration: 24,
      effects: [{ metric: "povertyRate", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 12. Minister for Justice ────────────────────────────────────────────────
  minister_for_justice: [
    {
      id: "ie_garda_resourcing_order",
      name: "An Garda Síochána Resourcing Order",
      description:
        "Boost An Garda Síochána resourcing for community policing, for a temporary drop in crime.",
      duration: 24,
      effects: [{ metric: "crimeRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "ie_sentencing_reform_initiative",
      name: "Sentencing Reform Initiative",
      description:
        "Implement a sentencing reform initiative targeting violent offenders, for a temporary boost to public safety confidence.",
      duration: 24,
      effects: [{ metric: "publicSafetyConfidence", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 13. Minister for Defence ────────────────────────────────────────────────
  minister_for_defence: [
    {
      id: "ie_defence_forces_review",
      name: "Defence Forces Review",
      description:
        "Conduct a Defence Forces capabilities review and implement quick-win reforms, for a temporary boost to public safety confidence.",
      duration: 24,
      effects: [{ metric: "publicSafetyConfidence", modifier: 0.03, scope: "national" }],
    },
    {
      id: "ie_veterans_support_programme",
      name: "Veterans Support Programme",
      description:
        "Launch a veterans' support and outreach programme, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 14. Minister for the Environment, Climate and Communications ────────────
  minister_for_environment_climate: [
    {
      id: "ie_climate_action_plan_acceleration",
      name: "Climate Action Plan Acceleration",
      description:
        "Accelerate Climate Action Plan delivery milestones, for a temporary drop in carbon emissions.",
      duration: 24,
      effects: [{ metric: "carbonEmissions", modifier: -0.05, scope: "national" }],
    },
    {
      id: "ie_just_transition_initiative",
      name: "Just Transition Initiative",
      description:
        "Launch a Just Transition initiative targeting Midlands peat-bog communities, for a temporary boost to renewable energy share.",
      duration: 24,
      effects: [{ metric: "renewableEnergy", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 15. Minister for Agriculture, Food and the Marine ───────────────────────
  minister_for_agriculture: [
    {
      id: "ie_cap_strategic_plan_order",
      name: "CAP Strategic Plan Order",
      description:
        "Front-load CAP Strategic Plan funding for Irish farmers, for a temporary national GDP boost.",
      duration: 24,
      effects: [{ metric: "gdpGrowth", modifier: 0.03, scope: "national" }],
    },
    {
      id: "ie_food_security_initiative",
      name: "Food Security Initiative",
      description:
        "Launch a national food security initiative supporting agri-food SMEs, for a temporary boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
  ],

  // ── 16. Minister for Transport ──────────────────────────────────────────────
  minister_for_transport: [
    {
      id: "ie_national_transport_strategy_review",
      name: "National Transport Strategy Review",
      description:
        "Fast-track National Transport Strategy priority projects, for a temporary boost to transport efficiency and road condition.",
      duration: 24,
      effects: [
        { metric: "transportEfficiency", modifier: 0.04, scope: "national" },
        { metric: "roadCondition", modifier: 0.04, scope: "national" },
      ],
    },
    {
      id: "ie_rural_connectivity_programme",
      name: "Rural Connectivity Programme",
      description:
        "Deploy a rural connectivity programme in the infrastructure-priority region, for a temporary regional boost to transport efficiency.",
      duration: 24,
      effects: [{ metric: "transportEfficiency", modifier: 0.05, scope: "regional" }],
    },
  ],

  // ── 17. Minister for Tourism, Culture, Arts, Gaeltacht, Sport and Media ─────
  minister_for_tourism_culture: [
    {
      id: "ie_tourism_recovery_initiative",
      name: "Tourism Recovery Initiative",
      description:
        "Launch a Fáilte Ireland tourism recovery initiative, for a temporary boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_gaeltacht_cultural_investment",
      name: "Gaeltacht Cultural Investment",
      description:
        "Deploy Gaeltacht cultural investment programmes through Údarás na Gaeltachta, for a temporary boost to government approval.",
      duration: 24,
      effects: [{ metric: "governmentApproval", modifier: 0.03, scope: "national" }],
    },
  ],

  // ── 18. Minister for Children, Equality, Disability, Integration and Youth ──
  minister_for_children: [
    {
      id: "ie_childcare_affordability_drive",
      name: "Childcare Affordability Drive",
      description:
        "Deploy a National Childcare Scheme expansion, for a temporary drop in the national poverty rate.",
      duration: 24,
      effects: [{ metric: "povertyRate", modifier: -0.04, scope: "national" }],
    },
    {
      id: "ie_equality_initiative",
      name: "Equality Initiative",
      description:
        "Launch a national equality initiative targeting income disparities, for a temporary drop in income inequality.",
      duration: 24,
      effects: [{ metric: "incomeInequality", modifier: -0.04, scope: "national" }],
    },
  ],

  // ── 19. Minister for Rural and Community Development ────────────────────────
  minister_for_rural_community: [
    {
      id: "ie_town_centre_renewal_initiative",
      name: "Town Centre Renewal Initiative",
      description:
        "Deploy the Town Centre First plan in rural towns, for a temporary boost to business formation.",
      duration: 24,
      effects: [{ metric: "smallBusinessFormation", modifier: 0.04, scope: "national" }],
    },
    {
      id: "ie_community_connectivity_drive",
      name: "Community Connectivity Drive",
      description:
        "Launch a rural broadband and community connectivity drive, for a temporary boost to broadband access.",
      duration: 24,
      effects: [{ metric: "broadbandAccess", modifier: 0.04, scope: "national" }],
    },
  ],
};
