import { getAllVoterArchetypeOptions } from "@/lib/demographics/countryDemographics";

export const POLICY_DOMAINS = [
  "economic",
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
];

// Metric options for each category
export const METRIC_OPTIONS: Record<string, string[]> = {
  economic: [
    "unemploymentRate",
    "medianIncome",
    "gdpGrowth",
    "povertyRate",
    "costOfLiving",
    "smallBusinessFormation",
    "economicFreedom",
    "regulatoryBurden",
  ],
  education: [
    "highSchoolGradRate",
    "testPerformance",
    "educationSpending",
    "literacyRate",
    "workforceSkill",
  ],
  healthcare: [
    "uninsuredRate",
    "affordabilityIndex",
    "physicianRate",
    "lifeExpectancy",
    "preventableMortality",
    "publicHealthPreparedness",
  ],
  infrastructure: [
    "roadCondition",
    "broadbandAccess",
    "publicTransit",
    "waterQuality",
    "powerGridReliability",
    "infrastructureInvestmentGap",
  ],
  publicSafety: [
    "crimeRate",
    "violentCrimeRate",
    "policePerCapita",
    "incarcerationRate",
    "emergencyResponse",
    "publicSafetyConfidence",
    // Axis metric (P6d pattern)
    "firearmRights",
  ],
  environment: [
    "airQuality",
    "renewableEnergy",
    "carbonEmissions",
    "recyclingRate",
    "climateResilience",
    "protectedLand",
  ],
  social: [
    "socialMobility",
    "incomeInequality",
    "homelessnessRate",
    "foodInsecurity",
    "civicParticipation",
    "socialCohesion",
  ],
  governance: [
    "governmentTransparency",
    "budgetBalance",
    "corruptionIndex",
    "voterTurnout",
    "publicTrust",
    // P6a axis metrics
    "civilLiberties",
    "nationalPride",
    "militaryReadiness",
    "borderSecurity",
  ],
  population: ["populationGrowth", "urbanizationRate", "medianAge", "migrationRate"],
  mediaInformation: [
    "mediaPolarization",
    "disinformationRisk",
    "pressFreedom",
    "socialMediaSentiment",
    "newsTrust",
    "stateMediaControl",
  ],
};

// Demographic groups for targeting — every country's voter archetypes (US 12 +
// the six seeded countries), sourced from the demographics SSOT so the admin
// dropdown stays complete and uses canonical seed IDs.
export const DEMOGRAPHIC_GROUPS = getAllVoterArchetypeOptions();

// Committee names by policy domain
export const COMMITTEE_NAMES: Record<string, string> = {
  economic: "Finance",
  education: "Education",
  healthcare: "Health",
  infrastructure: "Transportation",
  publicSafety: "Judiciary",
  environment: "Environment",
  social: "Social Services",
  governance: "Government Affairs",
};
