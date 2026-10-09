import { getGdpIndexedCostScale } from "@/lib/budget/costs";
import { ieLegislationTypes } from "@/lib/countries/ie/data/ieLegislationTypes";
import { ieRegions1991 } from "@/lib/countries/ie/data/ieRegions1991";
import { resetLawFamilies } from "@/lib/resetLegislation/catalog";
import type { OpeningLawReference } from "@/lib/resetLegislation/openingLaw";
import { COUNTRY_POLICY_CONFIGS_1991 } from "@/lib/seeds/reference/basePolicies1991";

const IE_1991_GDP = 30_933_434_751.04;
const population = ieRegions1991.reduce((sum, region) => sum + region.population, 0);
const costScale = getGdpIndexedCostScale("IE", IE_1991_GDP / population);
const types = new Map(ieLegislationTypes.map((type) => [type._id, type]));
const optionIndexes = COUNTRY_POLICY_CONFIGS_1991.ie.optionIndexes;

const familySources: Readonly<Record<string, readonly string[]>> = {
  L01: ["ie_working_family_payment"],
  L02: ["ie_state_pensions", "ie_unemployment_benefits"],
  L03: ["ie_sme_support"],
  L04: ["ie_minimum_wage", "ie_workers_rights"],
  L06: ["ie_workforce_development", "ie_regional_economic_development"],
  L08: ["ie_fiscal_stimulus"],
  L10: ["ie_education_funding"],
  L12: ["ie_curriculum_reform"],
  L14: ["ie_higher_education"],
  L15: ["ie_research_science"],
  L16: ["ie_healthcare_policy"],
  L19: ["ie_public_health"],
  L20: ["ie_mental_health"],
  L21: ["ie_elder_care"],
  L22: ["ie_housing_policy"],
  L25: ["ie_transport_rail"],
  L27: ["ie_digital_infrastructure"],
  L30: ["ie_renewable_energy_target"],
  L31: ["ie_climate_policy"],
  L33: ["ie_peat_bog_policy"],
  L34: ["ie_garda_policing"],
  L35: ["ie_criminal_justice", "ie_drug_policy"],
  L37: ["ie_agricultural_subsidies", "ie_food_security"],
  L38: ["ie_parental_leave", "ie_childcare_policy"],
  L39: ["ie_integration_programs"],
  L40: ["ie_gender_equality"],
  L41: ["ie_rural_development"],
  L43: ["ie_electoral_reform"],
  L45: ["ie_government_ethics"],
  L47: ["ie_media_press"],
  L48: [
    "ie_defence_spending",
    "ie_defence_recruitment",
    "ie_neutrality_posture",
    "ie_foreign_aid_diplomacy",
    "ie_cybersecurity",
  ],
  L49: ["ie_immigration_asylum", "ie_work_visas"],
};

const taxSources: Readonly<Record<string, string>> = {
  T01: "ie_income_tax_rate",
  T02: "ie_corporate_tax_rate",
  T03: "ie_foreign_corporate_tax_rate",
  T04: "ie_prsi",
  T05: "ie_vat_rate",
  T06: "ie_customs_tariff_rate",
  T07: "ie_local_property_tax",
  T08: "ie_stamp_duty",
  T09: "ie_capital_gains_tax",
};

function selectedSource(sourceId: string, familyId: string) {
  const type = types.get(sourceId);
  // Newer rule-only types may postdate the 1991 policy map. Their authored
  // seven-point scale is centered at index 3, which is the neutral opening law.
  const optionIndex = optionIndexes[sourceId] ?? 3;
  const option = type?.policyOptions?.[optionIndex];
  if (!type || optionIndex === undefined || !option) {
    throw new Error(`Missing Ireland 1991 current-law option for ${sourceId}`);
  }
  const annualBooked =
    option.annualCostPerCapita === undefined
      ? 0
      : Math.round(option.annualCostPerCapita * population * costScale);
  return {
    sourceId,
    selectedOption: option.name,
    optionIndex,
    historicalDisposition: "retained-legal-lineage",
    fiscalOwner: familyId,
    fiscalRole: "single-booked-owner",
    annualBooked,
    treatment: "retained-opening-obligation",
  } as const;
}

function emptyReference(scope: "national" | "regional", familyId: string, title: string) {
  return {
    key: `IE:${scope}:${familyId}`,
    country: "IE",
    scope,
    familyId,
    status: "no-dedicated-law",
    currentLaw: `No dedicated ${title.toLowerCase()} law`,
    legalNote: "No separately mapped 1991 Irish statute or funded programme in this family.",
    sourceComponents: [],
  } as const satisfies OpeningLawReference;
}

export function buildIeOpeningLawReferences1991(): OpeningLawReference[] {
  const nationalFamilies = resetLawFamilies.map((family) => {
    const sourceIds = familySources[family.id] ?? [];
    if (sourceIds.length === 0) return emptyReference("national", family.id, family.title);
    const components = sourceIds.map((sourceId) => selectedSource(sourceId, family.id));
    return {
      key: `IE:national:${family.id}`,
      country: "IE" as const,
      scope: "national" as const,
      familyId: family.id,
      status: "seeded-regime",
      currentLaw: components.map((component) => component.selectedOption).join("; "),
      legalNote: "Ireland's authored 1991 policy selection supplies this opening legal lineage.",
      sourceComponents: components,
    } satisfies OpeningLawReference;
  });
  const nationalTaxes = Object.entries(taxSources).map(([taxId, sourceId]) => {
    const source = selectedSource(sourceId, taxId);
    return {
      key: `IE:national:${taxId}`,
      country: "IE" as const,
      scope: "national" as const,
      familyId: taxId,
      status: "seeded-rate",
      currentLaw: source.selectedOption,
      legalNote: "Ireland's authored 1991 effective tax selection supplies this opening rate.",
      sourceComponents: [{ ...source, annualBooked: 0 }],
    } satisfies OpeningLawReference;
  });
  const regional = [
    ...resetLawFamilies.map((family) => [family.id, family.title] as const),
    ...Object.keys(taxSources).map((id) => [id, id] as const),
  ].map(([id, title]) => emptyReference("regional", id, title));
  return [...nationalFamilies, ...nationalTaxes, ...regional];
}
