import { describe, it, expect } from "vitest";
import { legislationTypes } from "./legislationTypes";

/**
 * Dead-node target invariant.
 *
 * The metric engine nodes economic.gdpGrowth and economic.unemploymentRate both
 * have maxPolicyDelta: 0 (see src/lib/metricEngine/registry/economic.ts). Any
 * policy delta applied to them is overwritten every turn, so references in seed
 * legislation are cosmetic / dead code.
 *
 * New legislation must NOT target these metrics in effectTargetsWeighted or
 * metricEffects. Existing violations are enumerated in DEAD_NODE_ALLOWLIST below.
 * The list is grouped by country scope (which maps to the seed file) and law id.
 *
 * The test fails if:
 *   - any legislation references gdpGrowth or unemploymentRate outside the
 *     allowlist, or
 *   - an allowlist entry no longer matches a reference (so the list must shrink
 *     as fixes land).
 *
 * Goal: drive this allowlist to zero. Do not add entries.
 */

const DEAD_METRICS = ["gdpGrowth", "unemploymentRate"] as const;

type DeadMetric = (typeof DEAD_METRICS)[number];
type AllowlistLocation = "effectTargetsWeighted" | "metricEffects";

interface DeadNodeAllowlistEntry {
  countryScope: string;
  lawId: string;
  metricId: DeadMetric;
  location: AllowlistLocation;
}

/**
 * Explicit allowlist of known dead-node references. Generated from the current
 * seed aggregate on 2026-07-16. Additions are forbidden; removals are encouraged.
 */
const DEAD_NODE_ALLOWLIST: DeadNodeAllowlistEntry[] = [
  // us
  {
    countryScope: "us",
    lawId: "us_federal_science_funding",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_spending_stimulus",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_spending_stimulus",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_transportation",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_broadband_energy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_clean_energy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_prison_rehabilitation",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_workforce_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_legal_immigration_visas",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_transportation",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_utilities",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_labor",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_workforce_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_environment",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_prison_rehabilitation",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_income_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_domestic_corporate_tax_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_foreign_corporate_tax_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_tariff_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_federal_sales_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_sales_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_domestic_corporate_tax_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "us",
    lawId: "us_state_foreign_corporate_tax_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  // uk
  {
    countryScope: "uk",
    lawId: "uk_income_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  { countryScope: "uk", lawId: "uk_vat", metricId: "gdpGrowth", location: "effectTargetsWeighted" },
  {
    countryScope: "uk",
    lawId: "uk_domestic_corporation_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_domestic_corporation_tax",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_foreign_corporation_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_foreign_corporation_tax",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_excise_customs",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_business_rates",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_mental_health",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_research_science",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_regional_skills",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_fiscal_spending",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_fiscal_spending",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_fiscal_spending",
    metricId: "gdpGrowth",
    location: "metricEffects",
  },
  {
    countryScope: "uk",
    lawId: "uk_regional_economic_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_regional_economic_development",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_transport_rail",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_climate_net_zero",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_north_sea_energy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_defence_spending",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_work_visas",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_work_visas",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_workforce_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_regional_labour",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "uk",
    lawId: "uk_regional_labour",
    metricId: "unemploymentRate",
    location: "metricEffects",
  },
  // jp
  {
    countryScope: "jp",
    lawId: "jp_income_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_domestic_corporation_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_domestic_corporation_tax",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_foreign_corporation_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_foreign_corporation_tax",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_customs_tariff",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_consumption_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_research_science",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_regional_skills",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_defense_spending",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_fiscal_stimulus",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_fiscal_stimulus",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_sme_support",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_sme_support",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_regional_economic_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_rail_transport",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_digital_infrastructure",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_regional_transport",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_climate_emissions",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_renewable_energy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_foreign_worker_policy",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_foreign_worker_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_agricultural_subsidies",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_rural_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_foreign_aid_diplomacy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_trade_agreements",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_robotics_ai",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_robotics_ai",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "jp",
    lawId: "jp_rd_investment",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  // de
  {
    countryScope: "de",
    lawId: "de_income_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_vat_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_domestic_corporate_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_foreign_corporate_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_payroll_social_insurance",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_trade_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_minimum_wage",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_immigration_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_immigration_policy",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_bundeswehr_funding",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_trade_agreements",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_fiscal_stimulus_act",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_fiscal_stimulus_act",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_rail_transport",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_climate_targets",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "de",
    lawId: "de_integration_programs",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  // ie
  {
    countryScope: "ie",
    lawId: "ie_corporate_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_corporate_tax_rate",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_foreign_corporate_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_income_tax_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_prsi",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_vat_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_unemployment_benefits",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_working_family_payment",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_minimum_wage",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_workforce_development",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_sme_support",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_sme_support",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_fiscal_stimulus",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_fiscal_stimulus",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_regional_economic_development",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_climate_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_defence_spending",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_work_visas",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ie",
    lawId: "ie_regional_skills",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  // cn
  {
    countryScope: "cn",
    lawId: "cn_enterprise_income_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_individual_income_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_value_added_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_urban_maintenance_construction_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_stamp_duty",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_social_insurance_contribution",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_customs_tariff",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_provincial_resource_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_research_science",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_pla_modernization",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_state_enterprises",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_industrial_strategy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_minimum_wage",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_fiscal_stimulus",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_rail_transport",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_digital_infrastructure",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_housing",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_provincial_economic_development",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "cn",
    lawId: "cn_provincial_infrastructure_investment",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  // ng
  {
    countryScope: "ng",
    lawId: "ng_vat_rate",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_companies_income_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_personal_income_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_petroleum_profit_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_customs_tariff",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_capital_gains_tax",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_stamp_duty",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_petroleum_sector_reform",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_power_sector_reform",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_minimum_wage",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_industrial_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_infrastructure_investment",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_agriculture_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_fiscal_framework",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_health_insurance",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_primary_healthcare",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_basic_education",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_tertiary_education",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_technical_education",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_social_safety_net",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_pension_system",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_housing_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_foreign_policy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_regional_integration",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_digital_economy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_water_sanitation",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_sme_support",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_trade_promotion",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_solid_minerals",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_youth_employment",
    metricId: "unemploymentRate",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_land_reform",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ng",
    lawId: "ng_telecommunications",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  // ru
  {
    countryScope: "ru",
    lawId: "su_enterprise_levy",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ru",
    lawId: "su_economic_system",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ru",
    lawId: "su_agriculture",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
  {
    countryScope: "ru",
    lawId: "su_defense_spending",
    metricId: "gdpGrowth",
    location: "effectTargetsWeighted",
  },
];

interface FoundReference {
  countryScope: string;
  lawId: string;
  metricId: DeadMetric;
  location: AllowlistLocation;
}

function collectReferences(): FoundReference[] {
  const refs: FoundReference[] = [];
  const seen = new Set<string>();

  for (const lt of legislationTypes as any[]) {
    const countryScope = lt.countryScope ?? "unknown";
    const lawId = lt._id;

    for (const target of lt.effectTargetsWeighted ?? []) {
      if (DEAD_METRICS.includes(target.metricId)) {
        const key = `${countryScope}|${lawId}|${target.metricId}|effectTargetsWeighted`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({
            countryScope,
            lawId,
            metricId: target.metricId,
            location: "effectTargetsWeighted",
          });
        }
      }
    }

    for (const opt of lt.policyOptions ?? []) {
      for (const me of opt.metricEffects ?? []) {
        if (DEAD_METRICS.includes(me.metricId)) {
          const key = `${countryScope}|${lawId}|${me.metricId}|metricEffects`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({
              countryScope,
              lawId,
              metricId: me.metricId,
              location: "metricEffects",
            });
          }
        }
      }
    }
  }

  return refs;
}

function entryKey(e: DeadNodeAllowlistEntry | FoundReference): string {
  return `${e.countryScope}|${e.lawId}|${e.metricId}|${e.location}`;
}

describe("seed invariant: dead-node targets", () => {
  const references = collectReferences();
  const allowlistKeys = new Set(DEAD_NODE_ALLOWLIST.map(entryKey));
  const referenceKeys = new Set(references.map(entryKey));

  it("has no non-allowlisted references to gdpGrowth or unemploymentRate", () => {
    const nonAllowlisted = references.filter((r) => !allowlistKeys.has(entryKey(r)));
    expect(nonAllowlisted).toEqual([]);
  });

  it("has no stale allowlist entries (allowlist must shrink as fixes land)", () => {
    const stale = DEAD_NODE_ALLOWLIST.filter((a) => !referenceKeys.has(entryKey(a)));
    expect(stale).toEqual([]);
  });

  it("reports the current allowlist size", () => {
    console.log(`DEAD_NODE_ALLOWLIST size: ${DEAD_NODE_ALLOWLIST.length}`);
    expect(DEAD_NODE_ALLOWLIST.length).toBeGreaterThanOrEqual(0);
  });
});
