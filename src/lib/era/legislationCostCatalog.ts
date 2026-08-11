/**
 * Era-Aware Legislation cost catalog (Spec B). Classifies every legislation type
 * by cost representation and resolves the era-native cost forms. Flag-on only:
 * the two forms are consulted by costs.ts only when the era year is non-null;
 * flag-off keeps the legacy COST_SCALE_ANCHORS path byte-identical.
 *
 * Spec: docs/superpowers/specs/2026-07-06-era-legislation-costs-design.md
 */
import { getIncomeAnchor } from "./metricCatalog";

export type CostClass = "gdpFraction" | "perCapita" | "none";

/** Per-type cost class. Populated in Task 3 (full coverage, validated). */
export const LEGISLATION_COST_CLASS: Record<string, CostClass> = {
  bal_economic_system: "none",
  bal_enterprise_levy: "none",
  bal_foreign_trade: "none",
  bal_income_tax: "none",
  bal_political_system: "none",
  bal_price_controls: "none",
  bal_product_tax: "none",
  bal_social_insurance: "none",
  br_corporate_tax: "none",
  br_customs_tariff: "none",
  br_defense_policy: "perCapita",
  br_education_funding: "perCapita",
  br_general_administration: "perCapita",
  br_iap_contribution: "none",
  br_income_tax_rate: "none",
  br_infrastructure_investment: "perCapita",
  br_ivc: "none",
  br_labor_law: "none",
  br_public_health: "perCapita",
  br_social_security_benefits: "perCapita",
  br_state_enterprises: "none",
  br_state_grants: "perCapita",
  bg_defense_appropriations: "gdpFraction",
  bg_economic_system: "none",
  bg_enterprise_levy: "none",
  bg_foreign_trade: "none",
  bg_income_tax: "none",
  bg_infrastructure_investment: "gdpFraction",
  bg_political_system: "none",
  bg_price_controls: "none",
  bg_product_tax: "none",
  bg_public_health_service: "gdpFraction",
  bg_regional_investment_grants: "gdpFraction",
  bg_social_insurance: "none",
  bg_social_security_fund: "gdpFraction",
  bg_state_administration: "gdpFraction",
  bg_universal_education: "gdpFraction",
  ukr_defense_appropriations: "gdpFraction",
  ukr_economic_system: "none",
  ukr_enterprise_levy: "none",
  ukr_foreign_trade: "none",
  ukr_income_tax: "none",
  ukr_infrastructure_investment: "gdpFraction",
  ukr_political_system: "none",
  ukr_price_controls: "none",
  ukr_product_tax: "none",
  ukr_public_health_service: "gdpFraction",
  ukr_regional_investment_grants: "gdpFraction",
  ukr_social_insurance: "none",
  ukr_social_security_fund: "gdpFraction",
  ukr_state_administration: "gdpFraction",
  ukr_universal_education: "gdpFraction",
  blr_defense_appropriations: "gdpFraction",
  blr_economic_system: "none",
  blr_enterprise_levy: "none",
  blr_foreign_trade: "none",
  blr_income_tax: "none",
  blr_infrastructure_investment: "gdpFraction",
  blr_political_system: "none",
  blr_price_controls: "none",
  blr_product_tax: "none",
  blr_public_health_service: "gdpFraction",
  blr_regional_investment_grants: "gdpFraction",
  blr_social_insurance: "none",
  blr_social_security_fund: "gdpFraction",
  blr_state_administration: "gdpFraction",
  blr_universal_education: "gdpFraction",
  bal_defense_appropriations: "gdpFraction",
  bal_infrastructure_investment: "gdpFraction",
  bal_public_health_service: "gdpFraction",
  bal_regional_investment_grants: "gdpFraction",
  bal_social_security_fund: "gdpFraction",
  bal_state_administration: "gdpFraction",
  bal_universal_education: "gdpFraction",
  cn_academic_pressure_reform: "none",
  cn_agricultural_subsidies: "gdpFraction",
  cn_ai_strategy: "gdpFraction",
  cn_anticorruption_campaign: "none",
  cn_belt_and_road: "gdpFraction",
  cn_climate_targets: "gdpFraction",
  cn_common_prosperity: "perCapita",
  cn_conscription: "gdpFraction",
  cn_criminal_justice: "gdpFraction",
  cn_customs_tariff: "none",
  cn_cybersecurity: "gdpFraction",
  cn_diaspora_engagement: "none",
  cn_digital_infrastructure: "gdpFraction",
  cn_education_funding: "perCapita",
  cn_elder_care: "perCapita",
  cn_emissions_trading_scheme: "gdpFraction",
  cn_enterprise_income_tax: "none",
  cn_family_policy: "perCapita",
  cn_fiscal_stimulus: "gdpFraction",
  cn_food_security: "gdpFraction",
  cn_gaokao_reform: "perCapita",
  cn_gender_equality: "perCapita",
  cn_hk_macao_affairs: "none",
  cn_housing: "gdpFraction",
  cn_hukou_reform: "none",
  cn_individual_income_tax: "none",
  cn_industrial_strategy: "gdpFraction",
  cn_internet_governance: "none",
  cn_land_value_added_tax: "none",
  cn_medical_insurance: "perCapita",
  cn_mental_health: "perCapita",
  cn_minimum_wage: "none",
  cn_npc_reform: "none",
  cn_nuclear_energy: "gdpFraction",
  cn_pension_system: "perCapita",
  cn_pla_modernization: "gdpFraction",
  cn_press_freedom: "none",
  cn_provincial_culture_propaganda: "gdpFraction",
  cn_provincial_economic_development: "gdpFraction",
  cn_provincial_education: "perCapita",
  cn_provincial_environmental_policy: "gdpFraction",
  cn_provincial_health_services: "perCapita",
  cn_provincial_infrastructure_investment: "gdpFraction",
  cn_provincial_public_security: "gdpFraction",
  cn_provincial_resource_tax: "none",
  cn_public_health: "perCapita",
  cn_public_security: "gdpFraction",
  cn_rail_transport: "gdpFraction",
  cn_renewable_energy_target: "gdpFraction",
  cn_research_science: "gdpFraction",
  cn_rural_revitalization: "gdpFraction",
  cn_semiconductor_strategy: "gdpFraction",
  cn_skilled_immigration: "none",
  cn_social_insurance_contribution: "none",
  cn_stamp_duty: "none",
  cn_state_enterprises: "gdpFraction",
  cn_state_media_funding: "gdpFraction",
  cn_taiwan_strait_doctrine: "gdpFraction",
  cn_un_security_council_posture: "none",
  cn_urban_maintenance_construction_tax: "none",
  cn_us_china_relations: "none",
  cn_value_added_tax: "none",
  cs_defense_appropriations: "gdpFraction",
  cs_economic_system: "none",
  cs_enterprise_levy: "none",
  cs_foreign_trade: "none",
  cs_income_tax: "none",
  cs_infrastructure_investment: "gdpFraction",
  cs_political_system: "none",
  cs_price_controls: "none",
  cs_product_tax: "none",
  cs_public_health_service: "gdpFraction",
  cs_regional_investment_grants: "gdpFraction",
  cs_social_insurance: "none",
  cs_social_security_fund: "gdpFraction",
  cs_state_administration: "gdpFraction",
  cs_universal_education: "gdpFraction",
  dd_civil_liberties: "none",
  dd_economic_system: "none",
  dd_enterprise_levy: "none",
  dd_foreign_trade: "none",
  dd_housing: "none",
  dd_income_tax: "none",
  dd_political_system: "none",
  dd_price_controls: "none",
  dd_product_tax: "none",
  dd_social_insurance: "none",
  de_academic_reform: "none",
  de_agricultural_subsidies: "gdpFraction",
  de_animal_welfare: "none",
  de_asylum_policy: "none",
  de_bundeswehr_funding: "gdpFraction",
  de_carbon_pricing: "gdpFraction",
  de_climate_targets: "gdpFraction",
  de_constitutional_protection: "gdpFraction",
  de_criminal_justice: "gdpFraction",
  de_customs_tariff_rate: "none",
  de_cybersecurity: "gdpFraction",
  de_defense_posture: "gdpFraction",
  de_digital_governance: "gdpFraction",
  de_digital_infrastructure: "gdpFraction",
  de_domestic_corporate_tax_rate: "none",
  de_education_funding: "perCapita",
  de_elder_care: "perCapita",
  de_electoral_reform: "none",
  de_eu_integration: "gdpFraction",
  de_family_policy: "perCapita",
  de_fiscal_stimulus_act: "gdpFraction",
  de_food_security: "gdpFraction",
  de_foreign_aid_diplomacy: "gdpFraction",
  de_foreign_corporate_tax_rate: "none",
  de_gender_equality: "perCapita",
  de_government_ethics: "none",
  de_grundgesetz_reform: "none",
  de_health_insurance: "perCapita",
  de_housing: "gdpFraction",
  de_immigration_policy: "none",
  de_income_tax_rate: "none",
  de_integration_programs: "perCapita",
  de_labor_reform: "none",
  de_land_culture: "gdpFraction",
  de_land_economic_development: "gdpFraction",
  de_land_education: "perCapita",
  de_land_health_services: "perCapita",
  de_land_municipal_grants: "gdpFraction",
  de_land_police: "gdpFraction",
  de_mental_health: "perCapita",
  de_minimum_wage: "none",
  de_nuclear_energy: "gdpFraction",
  de_payroll_social_insurance: "none",
  de_pension_system: "perCapita",
  de_policing_public_safety: "gdpFraction",
  de_press_freedom: "none",
  de_public_broadcasting: "gdpFraction",
  de_public_health: "perCapita",
  de_rail_transport: "gdpFraction",
  de_renewable_energy_target: "gdpFraction",
  de_research_science: "gdpFraction",
  de_robotics_ai: "gdpFraction",
  de_sme_mittelstand: "gdpFraction",
  de_solidarity_surcharge: "none",
  de_trade_agreements: "none",
  de_trade_tax: "none",
  de_unemployment_welfare: "perCapita",
  de_university_tuition: "perCapita",
  de_vat_rate: "none",
  de_wehrpflicht: "gdpFraction",
  es_consumption_tax: "none",
  es_corporate_tax: "none",
  es_customs_tariff: "none",
  es_income_tax: "none",
  es_labor_law: "none",
  es_social_charges: "none",
  es_state_holdings: "none",
  es_welfare_state: "none",
  fr_corporate_tax: "none",
  fr_customs_tariff: "none",
  fr_defense_appropriations: "gdpFraction",
  fr_economic_subsidies: "gdpFraction",
  fr_education_funding: "gdpFraction",
  fr_health_insurance: "gdpFraction",
  fr_income_tax: "none",
  fr_infrastructure_investment: "gdpFraction",
  fr_labor_law: "none",
  fr_local_grants: "gdpFraction",
  fr_nationalization: "none",
  fr_social_charges: "none",
  fr_vat: "none",
  fr_welfare_state: "gdpFraction",
  hu_defense_appropriations: "gdpFraction",
  hu_economic_system: "none",
  hu_enterprise_levy: "none",
  hu_foreign_trade: "none",
  hu_income_tax: "none",
  hu_infrastructure_investment: "gdpFraction",
  hu_political_system: "none",
  hu_price_controls: "none",
  hu_product_tax: "none",
  hu_public_health_service: "gdpFraction",
  hu_regional_investment_grants: "gdpFraction",
  hu_social_insurance: "none",
  hu_social_security_fund: "gdpFraction",
  hu_state_administration: "gdpFraction",
  hu_universal_education: "gdpFraction",
  ie_agricultural_subsidies: "gdpFraction",
  ie_capital_gains_tax: "none",
  ie_childcare_policy: "perCapita",
  ie_climate_policy: "gdpFraction",
  ie_corporate_tax_rate: "none",
  ie_criminal_justice: "gdpFraction",
  ie_curriculum_reform: "perCapita",
  ie_customs_tariff_rate: "none",
  ie_cybersecurity: "gdpFraction",
  ie_defence_recruitment: "gdpFraction",
  ie_defence_spending: "gdpFraction",
  ie_digital_infrastructure: "gdpFraction",
  ie_drug_policy: "none",
  ie_education_funding: "perCapita",
  ie_elder_care: "perCapita",
  ie_electoral_reform: "none",
  ie_excise_duty: "none",
  ie_fiscal_stimulus: "gdpFraction",
  ie_food_security: "gdpFraction",
  ie_foreign_aid_diplomacy: "gdpFraction",
  ie_foreign_corporate_tax_rate: "none",
  ie_garda_policing: "gdpFraction",
  ie_gender_equality: "perCapita",
  ie_government_ethics: "none",
  ie_healthcare_policy: "perCapita",
  ie_higher_education: "perCapita",
  ie_housing_policy: "perCapita",
  ie_immigration_asylum: "none",
  ie_income_tax_rate: "none",
  ie_integration_programs: "perCapita",
  ie_local_property_tax: "none",
  ie_media_press: "gdpFraction",
  ie_mental_health: "perCapita",
  ie_minimum_wage: "none",
  ie_neutrality_posture: "none",
  ie_parental_leave: "perCapita",
  ie_peat_bog_policy: "gdpFraction",
  ie_prsi: "none",
  ie_public_health: "perCapita",
  ie_regional_economic_development: "gdpFraction",
  ie_regional_health: "perCapita",
  ie_regional_housing: "perCapita",
  ie_regional_skills: "perCapita",
  ie_regional_transport: "gdpFraction",
  ie_renewable_energy_target: "gdpFraction",
  ie_research_science: "gdpFraction",
  ie_rural_development: "gdpFraction",
  ie_sme_support: "gdpFraction",
  ie_stamp_duty: "none",
  ie_state_pensions: "perCapita",
  ie_transport_rail: "gdpFraction",
  ie_unemployment_benefits: "perCapita",
  ie_usc: "none",
  ie_vat_rate: "none",
  ie_work_visas: "none",
  ie_workers_rights: "none",
  ie_workforce_development: "perCapita",
  ie_working_family_payment: "perCapita",
  it_corporate_tax: "none",
  it_customs_tariff: "none",
  it_defense_appropriations: "gdpFraction",
  it_economic_subsidies: "gdpFraction",
  it_education_funding: "gdpFraction",
  it_health_insurance: "gdpFraction",
  it_income_tax: "none",
  it_infrastructure_investment: "gdpFraction",
  it_labor_law: "none",
  it_local_grants: "gdpFraction",
  it_social_charges: "none",
  it_state_holdings: "none",
  it_vat: "none",
  it_welfare_state: "gdpFraction",
  jp_academic_reform: "none",
  jp_agricultural_subsidies: "gdpFraction",
  jp_article9_sdf: "gdpFraction",
  jp_climate_emissions: "gdpFraction",
  jp_constitutional_reform: "none",
  jp_consumption_tax: "none",
  jp_criminal_justice: "gdpFraction",
  jp_customs_tariff: "none",
  jp_cybersecurity: "gdpFraction",
  jp_defense_spending: "gdpFraction",
  jp_digital_governance: "gdpFraction",
  jp_digital_infrastructure: "gdpFraction",
  jp_disaster_preparedness: "gdpFraction",
  jp_domestic_corporation_tax: "none",
  jp_education_funding: "perCapita",
  jp_elder_care: "perCapita",
  jp_electoral_reform: "none",
  jp_family_policy: "perCapita",
  jp_fiscal_stimulus: "gdpFraction",
  jp_fixed_asset_tax: "none",
  jp_food_security: "gdpFraction",
  jp_foreign_aid_diplomacy: "gdpFraction",
  jp_foreign_corporation_tax: "none",
  jp_foreign_worker_policy: "gdpFraction",
  jp_gender_equality: "perCapita",
  jp_income_tax_rate: "none",
  jp_integration_programs: "perCapita",
  jp_jsdf_recruitment: "gdpFraction",
  jp_labor_reform: "gdpFraction",
  jp_local_allocation_tax: "gdpFraction",
  jp_media_press: "gdpFraction",
  jp_mental_health: "perCapita",
  jp_minimum_wage: "none",
  jp_national_health_insurance: "perCapita",
  jp_nuclear_energy: "gdpFraction",
  jp_pension: "gdpFraction",
  jp_policing_public_safety: "gdpFraction",
  jp_public_health: "perCapita",
  jp_rail_transport: "gdpFraction",
  jp_rd_investment: "gdpFraction",
  jp_regional_agriculture: "gdpFraction",
  jp_regional_autonomy: "gdpFraction",
  jp_regional_economic_development: "gdpFraction",
  jp_regional_education: "perCapita",
  jp_regional_environment: "gdpFraction",
  jp_regional_governance: "gdpFraction",
  jp_regional_health: "perCapita",
  jp_regional_policing: "gdpFraction",
  jp_regional_skills: "perCapita",
  jp_regional_social_services: "perCapita",
  jp_regional_transport: "gdpFraction",
  jp_regional_utilities: "gdpFraction",
  jp_renewable_energy: "gdpFraction",
  jp_research_science: "gdpFraction",
  jp_resident_tax: "none",
  jp_robotics_ai: "gdpFraction",
  jp_rural_development: "gdpFraction",
  jp_sme_support: "gdpFraction",
  jp_social_insurance: "none",
  jp_trade_agreements: "gdpFraction",
  jp_university_tuition: "perCapita",
  jp_visa_residency: "none",
  jp_work_culture_reform: "perCapita",
  ng_agriculture_policy: "gdpFraction",
  ng_anti_corruption: "none",
  ng_basic_education: "perCapita",
  ng_capital_gains_tax: "none",
  ng_civil_service_reform: "gdpFraction",
  ng_companies_income_tax: "none",
  ng_counterinsurgency: "gdpFraction",
  ng_criminal_justice: "gdpFraction",
  ng_customs_tariff: "none",
  ng_defense_policy: "gdpFraction",
  ng_digital_economy: "gdpFraction",
  ng_disability_inclusion: "perCapita",
  ng_electoral_reform: "none",
  ng_environmental_protection: "gdpFraction",
  ng_excise_duty: "none",
  ng_federalism: "none",
  ng_fiscal_framework: "none",
  ng_foreign_policy: "none",
  ng_gender_equality: "perCapita",
  ng_health_insurance: "perCapita",
  ng_housing_policy: "perCapita",
  ng_immigration_policy: "none",
  ng_industrial_policy: "gdpFraction",
  ng_infrastructure_investment: "gdpFraction",
  ng_judiciary_reform: "none",
  ng_labor_rights: "none",
  ng_land_reform: "gdpFraction",
  ng_local_government: "none",
  ng_maternal_child_health: "perCapita",
  ng_mental_health: "perCapita",
  ng_minimum_wage: "none",
  ng_paye: "none",
  ng_pension_system: "perCapita",
  ng_personal_income_tax: "none",
  ng_petroleum_profit_tax: "none",
  ng_petroleum_sector_reform: "none",
  ng_policing_reform: "gdpFraction",
  ng_population_policy: "none",
  ng_power_sector_reform: "gdpFraction",
  ng_press_freedom: "none",
  ng_primary_healthcare: "perCapita",
  ng_public_health: "perCapita",
  ng_regional_integration: "none",
  ng_renewable_energy: "gdpFraction",
  ng_sme_support: "gdpFraction",
  ng_social_safety_net: "perCapita",
  ng_solid_minerals: "gdpFraction",
  ng_stamp_duty: "none",
  ng_technical_education: "perCapita",
  ng_telecommunications: "gdpFraction",
  ng_tertiary_education: "perCapita",
  ng_trade_promotion: "gdpFraction",
  ng_vat_rate: "none",
  ng_water_sanitation: "gdpFraction",
  ng_youth_employment: "gdpFraction",
  pl_defense_appropriations: "gdpFraction",
  pl_economic_system: "none",
  pl_enterprise_levy: "none",
  pl_foreign_trade: "none",
  pl_income_tax: "none",
  pl_infrastructure_investment: "gdpFraction",
  pl_political_system: "none",
  pl_price_controls: "none",
  pl_product_tax: "none",
  pl_public_health_service: "gdpFraction",
  pl_regional_investment_grants: "gdpFraction",
  pl_social_insurance: "none",
  pl_social_security_fund: "gdpFraction",
  pl_state_administration: "gdpFraction",
  pl_universal_education: "gdpFraction",
  ro_defense_appropriations: "gdpFraction",
  ro_economic_system: "none",
  ro_enterprise_levy: "none",
  ro_foreign_trade: "none",
  ro_income_tax: "none",
  ro_infrastructure_investment: "gdpFraction",
  ro_political_system: "none",
  ro_price_controls: "none",
  ro_product_tax: "none",
  ro_public_health_service: "gdpFraction",
  ro_regional_investment_grants: "gdpFraction",
  ro_social_insurance: "none",
  ro_social_security_fund: "gdpFraction",
  ro_state_administration: "gdpFraction",
  ro_universal_education: "gdpFraction",
  se_corporate_tax: "none",
  se_customs_tariff: "none",
  se_defense_appropriations: "gdpFraction",
  se_economic_subsidies: "gdpFraction",
  se_education_funding: "gdpFraction",
  se_health_insurance: "gdpFraction",
  se_income_tax: "none",
  se_infrastructure_investment: "gdpFraction",
  se_labor_law: "none",
  se_local_grants: "gdpFraction",
  se_social_charges: "none",
  se_vat: "none",
  resource_extraction_authority: "none",
  se_wage_earner_funds: "none",
  se_welfare_state: "gdpFraction",
  senate_filibuster_rules: "none",
  su_agriculture: "none",
  su_civil_liberties: "none",
  su_customs_tariff: "none",
  su_defense_spending: "none",
  su_economic_system: "none",
  su_enterprise_levy: "none",
  su_housing: "none",
  su_individual_income_tax: "none",
  su_political_system: "none",
  su_price_controls: "none",
  su_social_insurance: "none",
  su_turnover_tax: "none",
  at_corporate_tax: "none",
  at_customs_tariff: "none",
  at_defense_appropriations: "gdpFraction",
  at_economic_subsidies: "gdpFraction",
  at_education_funding: "gdpFraction",
  at_health_insurance: "gdpFraction",
  at_income_tax: "none",
  at_infrastructure_investment: "gdpFraction",
  at_labor_law: "none",
  at_local_grants: "gdpFraction",
  at_sales_tax: "none",
  at_social_charges: "none",
  at_state_enterprises: "none",
  at_welfare_state: "gdpFraction",
  fi_corporate_tax: "none",
  fi_customs_tariff: "none",
  fi_defense_appropriations: "gdpFraction",
  fi_economic_subsidies: "gdpFraction",
  fi_education_funding: "gdpFraction",
  fi_health_insurance: "gdpFraction",
  fi_income_tax: "none",
  fi_infrastructure_investment: "gdpFraction",
  fi_labor_law: "none",
  fi_local_grants: "gdpFraction",
  fi_sales_tax: "none",
  fi_social_charges: "none",
  fi_state_enterprises: "none",
  fi_welfare_state: "gdpFraction",
  gr_corporate_tax: "none",
  gr_customs_tariff: "none",
  gr_defense_appropriations: "gdpFraction",
  gr_economic_subsidies: "gdpFraction",
  gr_education_funding: "gdpFraction",
  gr_health_insurance: "gdpFraction",
  gr_income_tax: "none",
  gr_infrastructure_investment: "gdpFraction",
  gr_labor_law: "none",
  gr_local_grants: "gdpFraction",
  gr_sales_tax: "none",
  gr_social_charges: "none",
  gr_state_enterprises: "none",
  gr_welfare_state: "gdpFraction",
  tr_corporate_tax: "none",
  tr_customs_tariff: "none",
  tr_defense_appropriations: "gdpFraction",
  tr_economic_subsidies: "gdpFraction",
  tr_education_funding: "gdpFraction",
  tr_health_insurance: "gdpFraction",
  tr_income_tax: "none",
  tr_infrastructure_investment: "gdpFraction",
  tr_labor_law: "none",
  tr_local_grants: "gdpFraction",
  tr_sales_tax: "none",
  tr_social_charges: "none",
  tr_state_enterprises: "none",
  tr_welfare_state: "gdpFraction",
  uk_agriculture_policy: "gdpFraction",
  uk_bbc_public_media: "gdpFraction",
  uk_business_rates: "none",
  uk_childcare: "perCapita",
  uk_climate_net_zero: "gdpFraction",
  uk_council_tax: "none",
  uk_defence_spending: "gdpFraction",
  uk_devolution_local_powers: "gdpFraction",
  uk_digital_broadband: "gdpFraction",
  uk_domestic_corporation_tax: "none",
  uk_drug_policy: "none",
  uk_education_funding: "perCapita",
  uk_education_standards: "perCapita",
  uk_electoral_reform: "none",
  uk_energy_grid: "gdpFraction",
  uk_excise_customs: "none",
  uk_fiscal_spending: "gdpFraction",
  uk_foreign_corporation_tax: "none",
  uk_foreign_policy: "gdpFraction",
  uk_government_ethics: "none",
  uk_housing_planning: "perCapita",
  uk_immigration_asylum: "none",
  uk_income_tax_rate: "none",
  uk_leasehold_reform: "perCapita",
  uk_local_government_funding: "gdpFraction",
  uk_mental_health: "perCapita",
  uk_national_insurance: "none",
  uk_national_service: "gdpFraction",
  uk_nhs_funding: "perCapita",
  uk_north_sea_energy: "gdpFraction",
  uk_policing_crime: "gdpFraction",
  uk_prison_rehabilitation: "gdpFraction",
  uk_public_health: "perCapita",
  uk_regional_agriculture: "gdpFraction",
  uk_regional_economic_development: "gdpFraction",
  uk_regional_education: "perCapita",
  uk_regional_emergency_services: "gdpFraction",
  uk_regional_environment: "gdpFraction",
  uk_regional_governance: "gdpFraction",
  uk_regional_health: "perCapita",
  uk_regional_housing_development: "perCapita",
  uk_regional_housing_support: "perCapita",
  uk_regional_justice: "gdpFraction",
  uk_regional_labour: "perCapita",
  uk_regional_policing: "gdpFraction",
  uk_regional_skills: "perCapita",
  uk_regional_technology: "gdpFraction",
  uk_regional_transport: "gdpFraction",
  uk_regional_utilities: "gdpFraction",
  uk_research_science: "gdpFraction",
  uk_social_care: "perCapita",
  uk_state_pensions: "perCapita",
  uk_surveillance_privacy: "gdpFraction",
  uk_technology_policy: "gdpFraction",
  uk_transport_rail: "gdpFraction",
  uk_trident_defence: "gdpFraction",
  uk_tuition_fees: "perCapita",
  uk_universal_credit: "perCapita",
  uk_vat: "none",
  uk_work_visas: "none",
  uk_workers_rights: "perCapita",
  uk_workforce_development: "perCapita",
  us_border_security_enforcement: "gdpFraction",
  us_broadband_energy: "gdpFraction",
  us_civics_voting_rights: "none",
  us_clean_energy: "gdpFraction",
  us_conservation: "gdpFraction",
  us_defense_spending: "gdpFraction",
  us_drug_pricing_medicare: "perCapita",
  us_emergency_services: "gdpFraction",
  us_federal_domestic_corporate_tax_rate: "none",
  us_federal_education_funding: "perCapita",
  us_federal_foreign_corporate_tax_rate: "none",
  us_federal_healthcare_funding: "perCapita",
  us_federal_income_tax_rate: "none",
  us_federal_payroll_tax_rate: "none",
  us_federal_sales_tax_rate: "none",
  us_federal_science_funding: "gdpFraction",
  us_federal_spending_stimulus: "gdpFraction",
  us_federal_tariff_rate: "none",
  us_food_nutrition: "perCapita",
  us_foreign_policy: "gdpFraction",
  us_government_ethics: "none",
  us_gun_control: "none",
  us_housing: "perCapita",
  us_law_enforcement_criminal_justice: "gdpFraction",
  us_legal_immigration_visas: "none",
  us_media_communications: "gdpFraction",
  us_medicaid: "perCapita",
  us_medicaid_expansion: "perCapita",
  us_minimum_wage: "none",
  us_national_service: "gdpFraction",
  us_paid_family_leave: "perCapita",
  us_prison_rehabilitation: "gdpFraction",
  us_public_health: "perCapita",
  us_reproductive_rights: "none",
  us_school_standards: "perCapita",
  us_social_security: "gdpFraction",
  us_state_business_regulation: "gdpFraction",
  us_state_compactness: "none",
  us_state_domestic_corporate_tax_rate: "none",
  us_state_education_funding: "perCapita",
  us_state_environment: "gdpFraction",
  us_state_fairness: "none",
  us_state_food_assistance: "perCapita",
  us_state_foreign_corporate_tax_rate: "none",
  us_state_government_ethics: "none",
  us_state_healthcare: "perCapita",
  us_state_higher_education: "perCapita",
  us_state_housing: "perCapita",
  us_state_income_tax_rate: "none",
  us_state_labor: "gdpFraction",
  us_state_media_communications: "gdpFraction",
  us_state_minimum_wage: "none",
  us_state_policing: "gdpFraction",
  us_state_prison_rehabilitation: "gdpFraction",
  us_state_property_tax_rate: "none",
  us_state_public_health: "perCapita",
  us_state_redistricting_authority: "none",
  us_state_sales_tax_rate: "none",
  us_state_spending_stimulus: "gdpFraction",
  us_state_transportation: "gdpFraction",
  us_state_utilities: "gdpFraction",
  us_state_voting_rights: "none",
  us_state_workforce_development: "gdpFraction",
  us_transportation: "gdpFraction",
  us_workforce_development: "gdpFraction",
  yu_defense_appropriations: "gdpFraction",
  yu_economic_system: "none",
  yu_enterprise_levy: "none",
  yu_foreign_trade: "none",
  yu_income_tax: "none",
  yu_infrastructure_investment: "gdpFraction",
  yu_political_system: "none",
  yu_price_controls: "none",
  yu_product_tax: "none",
  yu_public_health_service: "gdpFraction",
  yu_regional_investment_grants: "gdpFraction",
  yu_social_insurance: "none",
  yu_social_security_fund: "gdpFraction",
  yu_state_administration: "gdpFraction",
  yu_universal_education: "gdpFraction",
};

/** typeId → rationale for deviating from the domain default. */
export const COST_CLASS_OVERRIDES: Record<string, string> = {};

/** Unknown typeId ⇒ "none" (fail-safe: never invent a phantom cost line). */
export function getCostClass(typeId: string): CostClass {
  return LEGISLATION_COST_CLASS[typeId] ?? "none";
}

export interface EraCostContext {
  countryId: string;
  year: number;
  gdp: number;
  population: number;
  /**
   * The country's LIVE national median income (local currency — same
   * denomination as `gdp`). The perCapita charge base: costs must track the
   * game's own economic history, not the real-world era anchor (macro-v1
   * Phase 1; see 2026-07-09-gdp-growth-realism-design.md §3).
   */
  nationalMedianIncome?: number;
}

export interface EraCostFields {
  gdpCostFraction?: number;
  incomeCostFraction?: number;
}

/**
 * Flag-on cost for a spending option/law. gdpFraction → fraction × GDP;
 * perCapita → fraction × GAME national median income × population (falls back
 * to the same share of GDP via the calibration-time income-to-GDP ratio when
 * the live income is unavailable — never the real-world era anchor, which
 * overweights costs wherever the game's history diverged from the real
 * world's); none/missing → 0.
 */
export function resolveEraSpendingCost(
  typeId: string,
  fields: EraCostFields,
  ctx: EraCostContext
): number | undefined {
  const cls = getCostClass(typeId);
  if (cls === "gdpFraction") {
    // A law/option whose type is classed here but was never migrated onto the
    // era catalog (no `gdpCostFraction` materialized on THIS document — e.g. it
    // still carries a legacy `gdpPerCapitaMultiplier`/`annualCostPerCapita`)
    // must fall through to that legacy field, not silently book $0. Concretely:
    // jp_national_health_insurance, jp_article9_sdf, ie_healthcare_policy,
    // ie_defence_spending, cn_medical_insurance, cn_pla_modernization,
    // ng_health_insurance, ng_defense_policy (and siblings) were all generated
    // with a real `gdpPerCapitaMultiplier` and NO era field — before this fix,
    // `?? 0` here made the era path win with a phantom zero, so
    // calculateEnactedLawAnnualCost's `era !== undefined` short-circuit never
    // reached the legacy branch that actually prices them. An explicit `0`
    // (a genuinely materialized zero-cost option) is still honoured as 0; only
    // an unmaterialized (`undefined`/non-finite) field defers to legacy pricing.
    if (typeof fields.gdpCostFraction !== "number" || !Number.isFinite(fields.gdpCostFraction)) {
      return undefined;
    }
    return fields.gdpCostFraction * ctx.gdp;
  }
  if (cls === "perCapita") {
    if (
      typeof fields.incomeCostFraction !== "number" ||
      !Number.isFinite(fields.incomeCostFraction)
    ) {
      return undefined;
    }
    const frac = fields.incomeCostFraction;
    const i2g = incomeToGdp(ctx.countryId);
    // perCapita cost is pinned to the calibrated share of GDP: `incomeCostFraction`
    // was materialized as share / i2g, so `frac × i2g × gdp` === `share × gdp` (the
    // gdpFraction target). The live national median income is NO LONGER used to
    // scale the charge — it is symmetrically clamped to the calibrated income-to-GDP
    // ratio from BOTH sides, which collapses to this same expression:
    //
    //   CEILING (#3000): a seed economy whose income metric never grew down with GDP
    //   (CN ¥67.6k vs GDP/capita ¥2.4k, 28×) would inflate spending to a 204%-of-GDP
    //   phantom deficit — capped at the calibrated ratio.
    //
    //   FLOOR (#3149): the mirror image. Where the income metric sits BELOW its
    //   real-world calibration anchor (JP live ¥2.09M vs the ¥5.5M anchor, 0.36×;
    //   NG 0.097×) every perCapita law was silently scaled down to a fraction of its
    //   calibrated %GDP, suppressing ALL perCapita spending in those countries.
    //
    // Pinning to the calibrated share restores the intended %GDP for JP/NG, matches
    // the gdpFraction class, and matches how every correctly-calibrated country
    // (live income ≈ anchor ⇒ the old clamp was already inert) already resolved.
    // It leaves i2g / frac untouched, so enacted-law snapshots stay consistent and
    // no reseed or migration is required. `nationalMedianIncome` is retained on the
    // context for the callers/telemetry but intentionally does not scale the charge.
    return frac * i2g * ctx.gdp;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calibration model (Spec B, per-option field materialization).
//
// The per-option cost fractions are MATERIALIZED onto each spending option at
// seed-build time by `withEraCosts`, from a real-world domain max-share × the
// option's generosity (its position on the type's own cost ladder). The fields
// live on the seed options (inspectable, and hand-overridable — the materializer
// never overwrites a value already set on an option). Reference:
// docs/superpowers/era-cost-reference-shares.md.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Max-option spending share of GDP for a WHOLE domain (all its types at max
 * generosity, combined). This budget is SPLIT across the spending types in the
 * domain at materialize time (see {@link materializeEraCosts}) so a country with N
 * levers in a domain gets ~share/N per lever and the domain totals ~share when all
 * N are maxed — instead of each lever claiming the full share and the domain
 * stacking to N×share. (US healthcare has 7 types; pre-split that stacked to
 * ~0.31×GDP.) Summing every domain at max still lands above the ~45% revenue
 * ceiling (structurally unaffordable), per the dry-run.
 */
export const DOMAIN_MAX_SHARE: Record<string, number> = {
  healthcare: 0.03,
  welfare: 0.025,
  social: 0.02,
  education: 0.015,
  housing: 0.008,
  defense: 0.012,
  infrastructure: 0.01,
  environment: 0.005,
  agriculture: 0.004,
  publicSafety: 0.008,
  criminal_justice: 0.006,
  law_justice: 0.005,
  economic: 0.006,
  technology: 0.005,
  foreign_policy: 0.004,
  immigration: 0.004,
  labor: 0.004,
  labour: 0.004,
  mediaInformation: 0.002,
  governance: 0.002,
  government: 0.002,
  population: 0.004,
};

/** Per-type max-share overrides for big-ticket / outlier programs. */
export const COST_SHARE_OVERRIDES: Record<string, number> = {
  // Healthcare normalization (ticket #953 + issue #3137 follow-up): the /N
  // domain split priced every country's flagship healthcare lever far below
  // its real-world government-health share of GDP (game year 2012 anchors).
  // Values are pre-CALIBRATION_SCALE (x1.5) per-type max shares chosen so the
  // CURRENTLY ENACTED generosity lands near the anchor:
  //   US  1.44% -> ~5.3%  (fed Medicare+Medicaid)
  //   UK  1.63% -> ~7.5%  (NHS)
  //   DE  3.17% -> ~8.5%  (public health insurance)
  //   JP  1.19% -> ~7.5%  (the income-base fix has landed — #3149: the perCapita
  //       income base is no longer suppressed to 0.36x calibration, so this
  //       override now reaches its intended ~7.5% anchor. Retune DOWN, never up,
  //       if a post-fix dry-run shows it overshooting.)
  //   CN  3.60% -> ~1.7%  (2012 CN government health share; all four levers
  //       are maxed since 1995, so shares come DOWN)
  //   IE  3.60% -> ~5.9%
  // After changing these, reseed legislationTypes AND run
  // scripts/migrate-enacted-law-healthcare-fractions.ts — enacted laws
  // snapshot fractions at enactment and never re-read the catalog.
  us_federal_healthcare_funding: 0.043,
  uk_nhs_funding: 0.067,
  de_health_insurance: 0.048,
  jp_national_health_insurance: 0.055,
  cn_medical_insurance: 0.005,
  cn_elder_care: 0.002,
  cn_public_health: 0.002,
  cn_mental_health: 0.002,
  ie_healthcare_policy: 0.021,
};

/**
 * Global multiplier on every max-share, so "max everything" clears the
 * unaffordable-deficit floor across all countries (the country spread from type
 * counts / income ratios is absorbed here). Tuned via the dry-run.
 */
export const CALIBRATION_SCALE = 1.5;

// Representative modern (gdp, population) per playable country — from the 2019/2023
// budget seed configs. Used to precompute the income-to-GDP ratio so a perCapita
// share targets the same %GDP as a gdpFraction share.
const REP_ECON: Record<string, { gdp: number; population: number }> = {
  US: { gdp: 27_000_000_000_000, population: 333_000_000 },
  UK: { gdp: 2_900_000_000_000, population: 68_000_000 },
  DE: { gdp: 4_500_000_000_000, population: 84_400_000 },
  JP: { gdp: 550_000_000_000_000, population: 126_000_000 },
  IE: { gdp: 500_000_000_000, population: 5_100_000 },
  CN: { gdp: 126_000_000_000_000, population: 1_412_000_000 },
  NG: { gdp: 144_000_000_000_000, population: 200_000_000 },
};

/** incomeAnchor(2019) × population / GDP — the household-income-to-GDP ratio. */
function incomeToGdp(country: string): number {
  const e = REP_ECON[country];
  const anchor = getIncomeAnchor(country, 2019);
  if (!e || anchor == null || e.gdp <= 0) return 0.8;
  return (anchor * e.population) / e.gdp;
}

interface MaterializeOption {
  effectDirection?: number;
  annualCostPerCapita?: number;
  gdpPerCapitaMultiplier?: number;
  gdpCostFraction?: number;
  incomeCostFraction?: number;
}
interface MaterializeType {
  _id: string;
  policyDomain: string;
  countryScope?: string;
  policyOptions?: MaterializeOption[];
}

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Group key for the per-domain type count: country scope + policy domain. */
function domainKey(type: MaterializeType): string {
  return `${(type.countryScope ?? "us").toUpperCase()}|${type.policyDomain}`;
}

/**
 * Count the non-`none` spending types per (countryScope, policyDomain) across a
 * type array. The count is the divisor that splits each domain's `DOMAIN_MAX_SHARE`
 * budget evenly across its levers, so `materializeEraCosts` needs the full set to
 * de-stack — call it via {@link withEraCosts}, not per-type in isolation.
 */
export function countDomainTypes(types: MaterializeType[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of types) {
    if (getCostClass(t._id) === "none") continue;
    const k = domainKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Stamp gdpCostFraction / incomeCostFraction onto every option of one spending
 * type (mutates + returns it). `none`-class types are left untouched. An option
 * that already carries a fraction (hand-authored override) is left as-is.
 *
 * `domainTypeCount` (from {@link countDomainTypes}) splits the domain's
 * `DOMAIN_MAX_SHARE` budget across the N spending types sharing that
 * (countryScope, policyDomain) so they don't each claim the full domain share and
 * stack. Omit it (or miss the key) ⇒ divisor 1 (single-type / legacy behavior).
 * A `COST_SHARE_OVERRIDES` value is an explicit PER-TYPE share and is never split.
 */
export function materializeEraCosts<T extends MaterializeType>(
  type: T,
  domainTypeCount?: Map<string, number>
): T {
  const cls = getCostClass(type._id);
  if (cls === "none") return type;
  const opts = type.policyOptions ?? [];
  if (opts.length === 0) return type;

  const override = COST_SHARE_OVERRIDES[type._id];
  const domainTotal = DOMAIN_MAX_SHARE[type.policyDomain] ?? 0.01;
  const divisor =
    override !== undefined ? 1 : Math.max(1, domainTypeCount?.get(domainKey(type)) ?? 1);
  const maxShare = ((override ?? domainTotal) / divisor) * CALIBRATION_SCALE;
  const country = (type.countryScope ?? "us").toUpperCase();
  const i2g = incomeToGdp(country);

  // Generosity: prefer the option's own legacy cost ladder; else effectDirection.
  const legacy = opts.map((o) => o.annualCostPerCapita ?? o.gdpPerCapitaMultiplier);
  const haveLegacy =
    legacy.every((c) => typeof c === "number") && Math.max(...(legacy as number[])) > 0;
  const maxLegacy = haveLegacy ? Math.max(...(legacy as number[])) : 0;

  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (o.gdpCostFraction !== undefined || o.incomeCostFraction !== undefined) continue; // hand-set
    const g = haveLegacy
      ? (legacy[i] as number) / maxLegacy
      : o.effectDirection === 1
        ? 1
        : o.effectDirection === 0
          ? 0.4
          : 0.05;
    const share = maxShare * g;
    if (cls === "gdpFraction") o.gdpCostFraction = round5(share);
    else o.incomeCostFraction = round5(share / i2g);
  }
  return type;
}

/**
 * Apply {@link materializeEraCosts} across a legislation-type array (seed build),
 * splitting each domain's share across its types via {@link countDomainTypes}. Pass
 * the FULL type set so the per-domain counts are complete.
 */
export function withEraCosts<T extends MaterializeType>(types: T[]): T[] {
  const counts = countDomainTypes(types);
  return types.map((t) => materializeEraCosts(t, counts));
}
