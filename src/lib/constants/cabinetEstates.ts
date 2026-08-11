import type { CountryId } from "./countries";
import type { CabinetEstate, EstateFundingLevel } from "@/lib/db/types/cabinetEstate";

// ── Archetype catalog ────────────────────────────────────────────────────────
export interface EstateArchetype {
  id: string;
  label: string;
  description: string; // player-facing one-liner: what this asset does mechanically
  icon: string; // estatesUi icon key
  outputBase: number; // display capacity
  upkeepBase: number; // M/turn before multipliers
  effects: Record<string, number>; // metricPath → base per-turn delta
}

/**
 * Per-portfolio archetypes. Effect paths are full `category.metricId` and must
 * exist in metricDefinitions (enforced by the integrity test). Values are in the
 * same range as tier/regional standing effects; the capped pipeline clamps them.
 */
export const ESTATE_CATALOG: Record<string, EstateArchetype[]> = {
  education: [
    {
      id: "public_school",
      label: "Public School",
      description: "Raises high school graduation rates and test performance in its region.",
      icon: "school",
      outputBase: 5000,
      upkeepBase: 60,
      effects: { "education.highSchoolGradRate": 0.02, "education.testPerformance": 0.015 },
    },
    {
      id: "university",
      label: "University",
      description: "Raises university enrollment and workforce skill in its region.",
      icon: "graduation",
      outputBase: 12000,
      upkeepBase: 140,
      effects: { "education.universityEnrollment": 0.02, "education.workforceSkill": 0.015 },
    },
    {
      id: "vocational_center",
      label: "Vocational Center",
      description: "Builds workforce skill quickly at low upkeep.",
      icon: "wrench",
      outputBase: 3000,
      upkeepBase: 45,
      effects: { "education.workforceSkill": 0.025 },
    },
  ],
  health: [
    {
      id: "hospital",
      label: "Hospital",
      description: "Increases physician coverage and reduces preventable mortality in its region.",
      icon: "hospital",
      outputBase: 600,
      upkeepBase: 160,
      effects: { "healthcare.physicianRate": 0.02, "healthcare.preventableMortality": -0.02 },
    },
    {
      id: "clinic",
      label: "Community Clinic",
      description: "Cuts the uninsured rate and improves healthcare affordability in its region.",
      icon: "stethoscope",
      outputBase: 120,
      upkeepBase: 50,
      effects: { "healthcare.uninsuredRate": -0.02, "healthcare.affordabilityIndex": 0.015 },
    },
    {
      id: "research_institute",
      label: "Research Institute",
      description: "Strengthens public health preparedness in its region.",
      icon: "microscope",
      outputBase: 400,
      upkeepBase: 110,
      effects: { "healthcare.publicHealthPreparedness": 0.025 },
    },
  ],
  justice: [
    {
      id: "field_office",
      label: "Field Office",
      description: "Lowers the crime rate in its region.",
      icon: "shield",
      outputBase: 200,
      upkeepBase: 70,
      effects: { "publicSafety.crimeRate": -0.02 },
    },
    {
      id: "reentry_program",
      label: "Reentry Program",
      description: "Cuts recidivism and reduces the incarceration rate in its region.",
      icon: "scale",
      outputBase: 800,
      upkeepBase: 55,
      effects: { "publicSafety.recidivismRate": -0.025, "publicSafety.incarcerationRate": -0.015 },
    },
    {
      id: "anticorruption_unit",
      label: "Anti-Corruption Unit",
      description: "Reduces the corruption index in its region.",
      icon: "gavel",
      outputBase: 150,
      upkeepBase: 65,
      effects: { "governance.corruptionIndex": -0.025 },
    },
  ],
  interior: [
    {
      id: "national_park",
      label: "National Park",
      description: "Expands protected land and improves climate resilience in its region.",
      icon: "tree",
      outputBase: 50000,
      upkeepBase: 40,
      effects: { "environment.protectedLand": 0.02, "environment.climateResilience": 0.015 },
    },
    {
      id: "cleanup_program",
      label: "Cleanup Program",
      description: "Improves air quality in its region by lowering the pollution index.",
      icon: "recycle",
      outputBase: 1000,
      upkeepBase: 60,
      effects: { "environment.airQuality": -0.02 },
    },
    {
      id: "conservation_corps",
      label: "Conservation Corps",
      description: "Raises the recycling rate and nudges renewable energy adoption in its region.",
      icon: "leaf",
      outputBase: 2000,
      upkeepBase: 50,
      effects: { "environment.recyclingRate": 0.02, "environment.renewableEnergy": 0.01 },
    },
  ],
  agriculture: [
    {
      id: "research_station",
      label: "Research Station",
      description: "Reduces food insecurity and supports small business formation in its region.",
      icon: "sprout",
      outputBase: 500,
      upkeepBase: 50,
      effects: { "social.foodInsecurity": -0.02, "economic.smallBusinessFormation": 0.015 },
    },
    {
      id: "subsidy_program",
      label: "Subsidy Program",
      description:
        "Cuts food insecurity and lowers the poverty rate in its region, at higher upkeep.",
      icon: "tractor",
      outputBase: 4000,
      upkeepBase: 90,
      effects: { "social.foodInsecurity": -0.025, "economic.povertyRate": -0.015 },
    },
    {
      id: "rural_extension",
      label: "Rural Extension Office",
      description: "Boosts small business formation in its region at low upkeep.",
      icon: "wheat",
      outputBase: 300,
      upkeepBase: 40,
      effects: { "economic.smallBusinessFormation": 0.02 },
    },
  ],
  commerce: [
    {
      id: "enterprise_hub",
      label: "Enterprise Hub",
      description: "Boosts small business formation and lifts GDP growth in its region.",
      icon: "briefcase",
      outputBase: 600,
      upkeepBase: 70,
      effects: { "economic.smallBusinessFormation": 0.02, "economic.gdpGrowth": 0.01 },
    },
    {
      id: "trade_office",
      label: "Trade Office",
      description: "Lifts GDP growth and median income in its region.",
      icon: "package",
      outputBase: 200,
      upkeepBase: 60,
      effects: { "economic.gdpGrowth": 0.015, "economic.medianIncome": 0.01 },
    },
    {
      id: "innovation_park",
      label: "Innovation Park",
      description: "Delivers the strongest boost to small business formation, at high upkeep.",
      icon: "lightbulb",
      outputBase: 1500,
      upkeepBase: 110,
      effects: { "economic.smallBusinessFormation": 0.025 },
    },
  ],
  labor: [
    {
      id: "jobs_center",
      label: "Jobs Center",
      description: "Lowers unemployment and improves social mobility in its region.",
      icon: "users",
      outputBase: 1200,
      upkeepBase: 55,
      effects: { "economic.unemploymentRate": -0.02, "social.socialMobility": 0.015 },
    },
    {
      id: "training_program",
      label: "Training Program",
      description: "Improves social mobility and raises median income in its region.",
      icon: "wrench",
      outputBase: 800,
      upkeepBase: 50,
      effects: { "social.socialMobility": 0.02, "economic.medianIncome": 0.01 },
    },
    {
      id: "safety_inspectorate",
      label: "Safety Inspectorate",
      description: "Reduces income inequality in its region.",
      icon: "hardhat",
      outputBase: 150,
      upkeepBase: 45,
      effects: { "social.incomeInequality": -0.015 },
    },
  ],
  housing: [
    {
      id: "housing_project",
      label: "Housing Project",
      description: "Cuts homelessness and reduces the poverty rate in its region.",
      icon: "home",
      outputBase: 3000,
      upkeepBase: 90,
      effects: { "social.homelessnessRate": -0.025, "economic.povertyRate": -0.01 },
    },
    {
      id: "shelter",
      label: "Shelter",
      description: "Reduces homelessness in its region at low upkeep.",
      icon: "home",
      outputBase: 400,
      upkeepBase: 40,
      effects: { "social.homelessnessRate": -0.02 },
    },
    {
      id: "renewal_authority",
      label: "Renewal Authority",
      description: "Lowers cost of living and improves social mobility in its region.",
      icon: "building",
      outputBase: 2000,
      upkeepBase: 80,
      effects: { "economic.costOfLiving": -0.015, "social.socialMobility": 0.015 },
    },
  ],
  veterans: [
    {
      id: "veterans_hospital",
      label: "Veterans Hospital",
      description: "Increases physician coverage and reduces homelessness in its region.",
      icon: "hospital",
      outputBase: 500,
      upkeepBase: 130,
      effects: { "healthcare.physicianRate": 0.02, "social.homelessnessRate": -0.015 },
    },
    {
      id: "service_center",
      label: "Service Center",
      description: "Builds public trust and lowers the uninsured rate in its region.",
      icon: "shield",
      outputBase: 300,
      upkeepBase: 60,
      effects: { "governance.publicTrust": 0.015, "healthcare.uninsuredRate": -0.015 },
    },
    {
      id: "outreach_program",
      label: "Outreach Program",
      description: "Reduces homelessness and builds public trust in its region.",
      icon: "users",
      outputBase: 900,
      upkeepBase: 50,
      effects: { "social.homelessnessRate": -0.02, "governance.publicTrust": 0.01 },
    },
  ],
  homeland: [
    {
      id: "security_command",
      label: "Security Command",
      description: "Lowers the crime rate and builds public trust in its region.",
      icon: "shield",
      outputBase: 400,
      upkeepBase: 90,
      effects: { "publicSafety.crimeRate": -0.02, "governance.publicTrust": 0.01 },
    },
    {
      id: "emergency_agency",
      label: "Emergency Agency",
      description: "Raises public safety confidence in its region.",
      icon: "siren",
      outputBase: 600,
      upkeepBase: 70,
      effects: { "publicSafety.publicSafetyConfidence": 0.02 },
    },
    {
      id: "border_post",
      label: "Border Post",
      description: "Reduces the violent crime rate in its region.",
      icon: "mapPin",
      outputBase: 250,
      upkeepBase: 55,
      effects: { "publicSafety.violentCrimeRate": -0.015 },
    },
  ],
  foreign: [
    {
      id: "embassy",
      label: "Embassy",
      description: "Improves government transparency and builds public trust at home.",
      icon: "landmark",
      outputBase: 200,
      upkeepBase: 80,
      effects: { "governance.governmentTransparency": 0.015, "governance.publicTrust": 0.01 },
    },
    {
      id: "consulate",
      label: "Consulate",
      description: "Raises civic participation and adds a small lift to GDP growth at home.",
      icon: "building",
      outputBase: 80,
      upkeepBase: 45,
      effects: { "social.civicParticipation": 0.015, "economic.gdpGrowth": 0.005 },
    },
    {
      id: "cultural_institute",
      label: "Cultural Institute",
      description: "Raises civic participation and builds public trust at home.",
      icon: "palette",
      outputBase: 150,
      upkeepBase: 50,
      effects: { "social.civicParticipation": 0.02, "governance.publicTrust": 0.01 },
    },
  ],

  // ── Command-economy portfolios (RU/DD) ─────────────────────────────────────
  // Authored for the Council of Ministers seats that have no market-economy
  // analogue, so the market-flavoured portfolios above (commerce, labor,
  // housing) are not reused. Effect paths follow the same dotted
  // `category.metricId` convention and are pinned by the integrity test.
  planning: [
    {
      id: "planning_institute",
      label: "Planning Institute",
      description: "Sharpens plan execution and lifts productivity in its region.",
      icon: "landmark",
      outputBase: 400,
      upkeepBase: 70,
      effects: {
        "economic.industrialPolicyExecution": 0.02,
        "economic.productivityGrowth": 0.015,
      },
    },
    {
      id: "statistical_directorate",
      label: "Statistical Directorate",
      description: "Improves reporting accuracy, raising transparency and plan execution.",
      icon: "scale",
      outputBase: 150,
      upkeepBase: 45,
      effects: {
        "governance.governmentTransparency": 0.02,
        "economic.industrialPolicyExecution": 0.015,
      },
    },
    {
      id: "materials_balance_bureau",
      label: "Materials Balance Bureau",
      description: "Cuts input waste, raising productivity and easing costs in its region.",
      icon: "package",
      outputBase: 250,
      upkeepBase: 55,
      effects: { "economic.productivityGrowth": 0.02, "economic.costOfLiving": -0.01 },
    },
  ],
  state_bank: [
    {
      id: "savings_bank",
      label: "Savings Bank Branch",
      description: "Builds household confidence and social mobility in its region.",
      icon: "building",
      outputBase: 300,
      upkeepBase: 40,
      effects: { "economic.consumerConfidence": 0.02, "social.socialMobility": 0.01 },
    },
    {
      id: "credit_directorate",
      label: "Credit Directorate",
      description: "Channels enterprise credit, lifting investment confidence and growth.",
      icon: "briefcase",
      outputBase: 200,
      upkeepBase: 65,
      effects: { "economic.investorConfidence": 0.02, "economic.gdpGrowth": 0.01 },
    },
    {
      id: "settlement_office",
      label: "Settlement Office",
      description: "Audits enterprise accounts, cutting corruption and lifting productivity.",
      icon: "scale",
      outputBase: 120,
      upkeepBase: 50,
      effects: { "governance.corruptionIndex": -0.02, "economic.productivityGrowth": 0.01 },
    },
  ],
  // Abroad-sited (see isAbroadSited): effects land at home nationally, so every
  // path stays in a national-style category.
  trade_mission: [
    {
      id: "trade_mission",
      label: "Trade Mission",
      description: "Opens trade channels with its host country, lifting trade and growth at home.",
      icon: "landmark",
      outputBase: 250,
      upkeepBase: 85,
      effects: { "economic.tradeGrowth": 0.02, "economic.gdpGrowth": 0.01 },
    },
    {
      id: "hard_currency_office",
      label: "Hard Currency Office",
      description: "Earns convertible currency in its host country, improving the trade balance.",
      icon: "briefcase",
      outputBase: 100,
      upkeepBase: 60,
      effects: { "economic.tradeBalance": 0.02, "economic.investorConfidence": 0.01 },
    },
    {
      id: "technical_purchasing_bureau",
      label: "Technical Purchasing Bureau",
      description:
        "Acquires industrial technology abroad, raising competitiveness and productivity at home.",
      icon: "package",
      outputBase: 180,
      upkeepBase: 75,
      effects: {
        "economic.manufacturingCompetitiveness": 0.02,
        "economic.productivityGrowth": 0.01,
      },
    },
  ],
  distribution: [
    {
      id: "state_department_store",
      label: "State Department Store",
      description: "Puts goods on shelves, easing household costs and lifting confidence.",
      icon: "building",
      outputBase: 2000,
      upkeepBase: 80,
      effects: { "economic.costOfLiving": -0.02, "economic.consumerConfidence": 0.015 },
    },
    {
      id: "goods_depot",
      label: "Goods Depot",
      description: "Buffers supply shocks, easing costs and food insecurity in its region.",
      icon: "package",
      outputBase: 1500,
      upkeepBase: 50,
      effects: { "economic.costOfLiving": -0.015, "social.foodInsecurity": -0.01 },
    },
    {
      id: "consumer_cooperative",
      label: "Consumer Cooperative",
      description: "Runs local retail at low cost, building confidence and absorbing labour.",
      icon: "users",
      outputBase: 600,
      upkeepBase: 45,
      effects: { "economic.consumerConfidence": 0.02, "economic.unemploymentRate": -0.01 },
    },
  ],
  collective_farming: [
    {
      id: "state_farm",
      label: "State Farm",
      description: "Raises food security and cuts food insecurity in its region.",
      icon: "tractor",
      outputBase: 5000,
      upkeepBase: 95,
      effects: { "economic.foodSecurity": 0.02, "social.foodInsecurity": -0.015 },
    },
    {
      id: "machine_tractor_station",
      label: "Machine Tractor Station",
      description: "Mechanizes the harvest, lifting productivity and rural revitalization.",
      icon: "wrench",
      outputBase: 800,
      upkeepBase: 60,
      effects: {
        "economic.productivityGrowth": 0.02,
        "economic.ruralRevitalization": 0.015,
      },
    },
    {
      id: "grain_elevator",
      label: "Grain Elevator",
      description: "Cuts post-harvest loss, reducing food insecurity and urban costs.",
      icon: "wheat",
      outputBase: 3000,
      upkeepBase: 40,
      effects: { "social.foodInsecurity": -0.02, "economic.costOfLiving": -0.01 },
    },
  ],
  heavy_industry: [
    {
      id: "industrial_combine",
      label: "Industrial Combine",
      description: "The heaviest employer available: strong competitiveness and hiring gains.",
      icon: "factory",
      outputBase: 6000,
      upkeepBase: 150,
      effects: {
        "economic.manufacturingCompetitiveness": 0.025,
        "economic.unemploymentRate": -0.015,
      },
    },
    {
      id: "machine_tool_plant",
      label: "Machine Tool Plant",
      description: "Supplies the plan's capital goods, lifting productivity and plan execution.",
      icon: "wrench",
      outputBase: 2500,
      upkeepBase: 100,
      effects: {
        "economic.productivityGrowth": 0.02,
        "economic.industrialPolicyExecution": 0.015,
      },
    },
    {
      id: "metallurgical_works",
      label: "Metallurgical Works",
      description: "Raises industrial competitiveness, at the cost of dirtier air in its region.",
      icon: "factory",
      outputBase: 4000,
      upkeepBase: 130,
      // airQuality is an AQI (LOWER is better): a POSITIVE delta dirties the air.
      // This is the one archetype in the catalog with a deliberate downside.
      effects: {
        "economic.manufacturingCompetitiveness": 0.02,
        "environment.airQuality": 0.015,
      },
    },
  ],
  state_security: [
    {
      id: "militia_directorate",
      label: "Militia Directorate",
      description: "Lowers the crime rate and raises safety confidence in its region.",
      icon: "shield",
      outputBase: 500,
      upkeepBase: 80,
      effects: {
        "publicSafety.crimeRate": -0.02,
        "publicSafety.publicSafetyConfidence": 0.015,
      },
    },
    {
      id: "internal_troops_garrison",
      label: "Internal Troops Garrison",
      description: "Cuts violent crime in its region and hardens the border.",
      icon: "shield",
      outputBase: 900,
      upkeepBase: 110,
      effects: { "publicSafety.violentCrimeRate": -0.02, "governance.borderSecurity": 0.01 },
    },
    {
      id: "civil_registry_office",
      label: "Civil Registry Office",
      description: "Tightens administrative control, cutting corruption and crime.",
      icon: "scale",
      outputBase: 200,
      upkeepBase: 45,
      effects: { "governance.corruptionIndex": -0.015, "publicSafety.crimeRate": -0.01 },
    },
  ],
  // Universal state healthcare (the Semashko model). Deliberately NOT the market
  // `health` portfolio: that one's Community Clinic "cuts the uninsured rate and
  // improves healthcare affordability", and a command economy has no uninsured
  // population and no point of payment. Same metric family, coherent framing.
  socialized_health: [
    {
      id: "polyclinic",
      label: "Polyclinic",
      description:
        "The district's first point of contact: raises physician coverage and cuts preventable deaths in its region.",
      icon: "stethoscope",
      outputBase: 900,
      upkeepBase: 120,
      effects: {
        "healthcare.physicianRate": 0.02,
        "healthcare.preventableMortality": -0.015,
      },
    },
    {
      id: "sanatorium",
      label: "Sanatorium",
      description:
        "Convalescent and preventive care: cuts preventable deaths and builds health preparedness in its region.",
      icon: "hospital",
      outputBase: 700,
      upkeepBase: 100,
      effects: {
        "healthcare.preventableMortality": -0.02,
        "healthcare.publicHealthPreparedness": 0.015,
      },
    },
    {
      id: "feldsher_post",
      label: "Feldsher Post",
      description:
        "Rural paramedic station: extends coverage and preparedness cheaply across thin districts.",
      icon: "microscope",
      outputBase: 200,
      upkeepBase: 45,
      effects: {
        "healthcare.physicianRate": 0.015,
        "healthcare.publicHealthPreparedness": 0.01,
      },
    },
  ],
  culture: [
    {
      id: "house_of_culture",
      label: "House of Culture",
      description: "Raises civic participation and national pride in its region.",
      icon: "palette",
      outputBase: 800,
      upkeepBase: 55,
      effects: { "social.civicParticipation": 0.02, "governance.nationalPride": 0.015 },
    },
    {
      id: "state_publishing_house",
      label: "State Publishing House",
      description: "Drives the literacy campaign and builds national pride.",
      icon: "book",
      outputBase: 1200,
      upkeepBase: 65,
      effects: { "education.literacyRate": 0.02, "governance.nationalPride": 0.01 },
    },
    {
      id: "cinema_network",
      label: "Cinema Network",
      description: "Builds social cohesion and public trust in its region.",
      icon: "film",
      outputBase: 400,
      upkeepBase: 50,
      effects: { "social.socialCohesion": 0.02, "governance.publicTrust": 0.01 },
    },
  ],
};

// ── Canonical portfolio per country seat ─────────────────────────────────────
// Reserved/excluded (no entry → no estates, placeholder stays): finance, defense,
// energy, transportation, and head-of-government / deputy / territorial seats.
export const ESTATE_PORTFOLIO_BY_COUNTRY: Partial<Record<CountryId, Record<string, string>>> = {
  US: {
    secretary_of_state: "foreign",
    attorney_general: "justice",
    secretary_of_interior: "interior",
    secretary_of_agriculture: "agriculture",
    secretary_of_commerce: "commerce",
    secretary_of_labor: "labor",
    secretary_of_health: "health",
    secretary_of_hud: "housing",
    secretary_of_education: "education",
    secretary_of_veterans: "veterans",
    secretary_of_homeland: "homeland",
  },
  UK: {
    foreign_secretary: "foreign",
    home_secretary: "homeland",
    justice_secretary: "justice",
    health_secretary: "health",
    education_secretary: "education",
    business_secretary: "commerce",
    levelling_secretary: "housing",
    environment_secretary: "interior",
    work_secretary: "labor",
  },
  DE: {
    foreign_minister: "foreign",
    interior_minister: "homeland",
    justice_minister: "justice",
    labour_minister: "labor",
    health_minister: "health",
    education_minister: "education",
    environment_minister: "interior",
    economy_minister: "commerce",
  },
  CN: {
    minister_of_foreign_affairs: "foreign",
    minister_of_education: "education",
    minister_of_health: "health",
    minister_of_public_security: "homeland",
    minister_of_commerce: "commerce",
    minister_of_human_resources_social_security: "labor",
    minister_of_ecology_environment: "interior",
    minister_of_agriculture_rural_affairs: "agriculture",
    minister_of_housing_urban_rural: "housing",
  },
  JP: {
    foreign_affairs_minister: "foreign",
    justice_minister: "justice",
    health_minister: "health",
    education_minister: "education",
    economy_minister: "commerce",
    environment_minister: "interior",
    internal_affairs_minister: "homeland",
  },
  IE: {
    minister_for_foreign_affairs: "foreign",
    minister_for_enterprise: "commerce",
    minister_for_health: "health",
    minister_for_education: "education",
    minister_for_further_higher_education: "education",
    minister_for_housing: "housing",
    minister_for_social_protection: "labor",
    minister_for_justice: "justice",
    minister_for_environment_climate: "interior",
    minister_for_agriculture: "agriculture",
  },
  // Command-economy Council of Ministers. Defence → Military flagship and
  // Finance → Monetary flagship are resolved elsewhere, so both are absent here;
  // `premier`/`generalSecretary` and `first_deputy_premier` are leadership seats
  // with no flagship (the UK Deputy PM precedent). DD mirrors RU's position ids
  // one-for-one (ddCabinet.ts), so the two maps are identical — written out
  // separately rather than aliased so a future divergence is a local edit.
  RU: {
    minister_of_foreign_affairs: "foreign",
    minister_of_internal_affairs: "state_security",
    chairman_of_gosplan: "planning",
    gosbank_liaison: "state_bank",
    minister_of_foreign_trade: "trade_mission",
    minister_of_internal_trade: "distribution",
    minister_of_agriculture: "collective_farming",
    minister_of_machine_building: "heavy_industry",
    minister_of_culture: "culture",
    minister_of_health: "socialized_health",
    minister_of_higher_education: "education",
  },
  DD: {
    minister_of_foreign_affairs: "foreign",
    minister_of_internal_affairs: "state_security",
    chairman_of_gosplan: "planning",
    gosbank_liaison: "state_bank",
    minister_of_foreign_trade: "trade_mission",
    minister_of_internal_trade: "distribution",
    minister_of_agriculture: "collective_farming",
    minister_of_machine_building: "heavy_industry",
    minister_of_culture: "culture",
    minister_of_health: "socialized_health",
    minister_of_higher_education: "education",
  },
};

/** Portfolio → federal-budget spending category; unmapped → gdp-fraction fallback. */
export const PORTFOLIO_BUDGET_CATEGORY: Record<string, string> = {
  education: "education",
  health: "healthcare",
  interior: "environment",
  housing: "housing",
  agriculture: "agriculture",
  justice: "publicSafety",
  homeland: "publicSafety",
  // Command-economy portfolios with a clean analogue, so a Soviet agriculture or
  // interior seat draws its envelope from the same appropriation its US/UK
  // counterpart does instead of silently falling through to the GDP fraction.
  collective_farming: "agriculture",
  state_security: "publicSafety",
  socialized_health: "healthcare",
  // commerce, labor, veterans, foreign → no clean category → gdp-fraction fallback.
  // Same for planning, state_bank, trade_mission, distribution, heavy_industry and
  // culture: a command economy's planning apparatus, bank branch network, overseas
  // trade missions, retail distribution, industrial combines and houses of culture
  // have no counterpart in KNOWN_SPENDING_CATEGORIES.
};

/**
 * Non-canonical spending keys real budgets use for a canonical category, tried in
 * order after the canonical key misses. `resolvePortfolioEnvelope` walks these so
 * a portfolio still resolves a real appropriation instead of silently dropping to
 * the GDP fraction.
 *
 * Why this is needed: `KNOWN_SPENDING_CATEGORIES` says `healthcare`, but BR, CN,
 * DE, IE, JP and UK all key their health line `health` — so the `health` portfolio
 * resolved an appropriation for the US alone and fell back to GDP everywhere else.
 * `resolveInfraEnvelope` already solved the same problem for transportation with a
 * hand-rolled `transportation → infrastructure → transport` chain; this is that
 * idea made declarative for estates.
 */
export const BUDGET_CATEGORY_ALIASES: Record<string, readonly string[]> = {
  healthcare: ["health"],
};

export const ESTATE_ENVELOPE_FALLBACK_GDP_FRACTION = 0.01;

/** Discretionary slice of a portfolio's department appropriation. Tunable. */
export const ESTATE_DISCRETIONARY_FRACTION = 0.04;
/**
 * Estate envelope is clamped to an ABSOLUTE band [FLOOR, CAP] in the upkeep unit (millions of
 * local currency), not a GDP fraction: estate upkeep is country-independent (same upkeepBase
 * everywhere), so a GDP-relative band starves small economies. An absolute band gives every
 * portfolio comparable room to grow regardless of economy size. Tunable.
 */
export const ESTATE_DISC_FLOOR = 3_500;
export const ESTATE_DISC_CAP = 5_000;

// ── Funding / tier ───────────────────────────────────────────────────────────
export interface FundingLevelDef {
  id: EstateFundingLevel;
  label: string;
  upkeepMult: number;
  outputMult: number;
  conditionBaseline: number;
}
export const FUNDING_LEVELS: FundingLevelDef[] = [
  { id: "reduced", label: "Reduced", upkeepMult: 0.6, outputMult: 0.7, conditionBaseline: 55 },
  { id: "standard", label: "Standard", upkeepMult: 1.0, outputMult: 1.0, conditionBaseline: 75 },
  { id: "enhanced", label: "Enhanced", upkeepMult: 1.5, outputMult: 1.25, conditionBaseline: 90 },
];
export function fundingDef(level: EstateFundingLevel): FundingLevelDef {
  return FUNDING_LEVELS.find((f) => f.id === level) ?? FUNDING_LEVELS[1];
}

export const TIER_MULTIPLIER = [1.0, 1.5, 2.0, 2.5] as const;
export const TIER_LABELS = ["Basic", "Established", "Expanded", "Flagship"] as const;

export const ESTATE_EFFECT = {
  /** budgetBalance per unit of (envelope-upkeep)/envelope gap (clamped ±1). */
  budgetWeight: 0.05,
};

/**
 * Unit conversion for estate upkeep: `upkeepBase`/effective upkeep are in millions
 * ("M/turn"), while the portfolio envelope (federalBudget spending line / GDP) is
 * absolute country-local currency. Divide the envelope by this to compare in the
 * same (millions) unit. The military seat had the equivalent constant until its synthetic
 * envelope was retired and its metrics moved to a real-money ratio.
 */
export const ESTATE_UPKEEP_UNIT = 1_000_000;

// ── Lookups ──────────────────────────────────────────────────────────────────
export function getPortfolioCatalog(portfolioKey: string): EstateArchetype[] {
  return ESTATE_CATALOG[portfolioKey] ?? [];
}
export function getEstateArchetype(
  portfolioKey: string,
  archetypeId: string
): EstateArchetype | undefined {
  return getPortfolioCatalog(portfolioKey).find((a) => a.id === archetypeId);
}
/**
 * Portfolios whose estates are sited in OTHER countries rather than in home
 * regions: diplomatic posts (`foreign`) and the command-economy foreign-trade
 * monopoly's overseas missions (`trade_mission`). Seeding, the open route's site
 * validation, and the roster UI all branch on this. Because their effects land
 * at home nationally rather than on a home region, their archetypes are limited
 * to national-style metric categories (pinned by cabinetEstates.test.ts).
 */
const ABROAD_SITED_PORTFOLIOS = new Set(["foreign", "trade_mission"]);

export function isAbroadSited(portfolioKey: string): boolean {
  return ABROAD_SITED_PORTFOLIOS.has(portfolioKey);
}

export function resolveEstatePortfolio(countryId: string, positionId: string): string | null {
  return ESTATE_PORTFOLIO_BY_COUNTRY[countryId as CountryId]?.[positionId] ?? null;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────
export function computeEffectiveOutput(
  estate: Pick<CabinetEstate, "outputBase" | "tier" | "fundingLevel" | "condition">
): number {
  return Math.round(
    estate.outputBase *
      TIER_MULTIPLIER[estate.tier] *
      fundingDef(estate.fundingLevel).outputMult *
      (estate.condition / 100)
  );
}
export function computeEffectiveUpkeep(
  estate: Pick<CabinetEstate, "upkeepBase" | "tier" | "fundingLevel">
): number {
  return Math.round(
    estate.upkeepBase * TIER_MULTIPLIER[estate.tier] * fundingDef(estate.fundingLevel).upkeepMult
  );
}

export interface EstateAggregate {
  count: number;
  totalUpkeep: number;
  /** siteId (regionId or host CountryId) → metricPath → summed effective delta. */
  bySite: Record<string, Record<string, number>>;
}
export function aggregateEstates(estates: CabinetEstate[]): EstateAggregate {
  const bySite: Record<string, Record<string, number>> = {};
  let totalUpkeep = 0;
  for (const e of estates) {
    totalUpkeep += computeEffectiveUpkeep(e);
    const arch = getEstateArchetype(e.portfolioKey, e.archetypeId);
    if (!arch) continue;
    const outMult =
      TIER_MULTIPLIER[e.tier] * fundingDef(e.fundingLevel).outputMult * (e.condition / 100);
    const site = (bySite[e.siteId] ??= {});
    for (const [path, base] of Object.entries(arch.effects)) {
      site[path] = +((site[path] ?? 0) + base * outMult).toFixed(4);
    }
  }
  return { count: estates.length, totalUpkeep, bySite };
}
