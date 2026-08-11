/**
 * Base policy records for nation and each state.
 * National: realistic defaults per legislation type calibrated to Jan 2020 real-world policy.
 * State: derived from state politicalLean (-4 to +5) mapped to economic/social -3..3.
 * Used by scripts/seed-policies.ts and seedStatePolicies.
 *
 * Adding a new country: add an entry to COUNTRY_POLICY_CONFIGS with defaults, optionIndexes,
 * nationalStateId, and regions. The buildBasePolicies() loop handles the rest.
 */

import type { State } from "@/lib/db/types";
import { legislationTypes } from "./legislationTypes";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";
import { states } from "./states";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { uaRegions } from "@/lib/seeds/ua/uaRegions";
import { blrRegions } from "@/lib/seeds/blr/blrRegions";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { balRegions } from "@/lib/seeds/bal/balRegions";
import { easternBlocPolicyConfig } from "@/lib/seeds/shared/easternBlocLegislation";
import { getStateLean } from "@/lib/utils/demographics";

export type BasePolicyRecord = {
  scope: "national" | "state";
  stateId?: string;
  legislationTypeId: string;
  economic: number;
  social: number;
  /** Default policy option ID (center option) for national policies */
  policyOptionId?: string;
  /** Default policy option index (center = 3) for national policies */
  policyOptionIndex?: number;
  /**
   * Direction of effect from the seeded option, derived from the option's stance
   * (-1 left, 0 center, +1 right). Required by the runtime weighted-target engine
   * (policyEffects.ts) — without it, `policy.effectDirection * 3` evaluates to
   * NaN and contaminates metric targets.
   */
  effectDirection: number;
  updatedAt: Date;
};

// ═════════════════════════════════════════════════════════════════════════════
//  Country Policy Configuration
// ═════════════════════════════════════════════════════════════════════════════

export interface CountryPolicyConfig {
  /** stateId used for national-scope policy records (e.g. "federal", "uk_national") */
  nationalStateId: string;
  /** eco/soc defaults for non-tax national legislation types */
  defaults: Record<string, { economic: number; social: number }>;
  /** override option indexes for tax types and specific policies */
  optionIndexes: Record<string, number>;
  /** state/region data source for sub-national records */
  regions: State[];
}

/**
 * Per-country policy configuration. Each entry defines:
 * - defaults: eco/soc scores for national legislation types (Jan 2020 real-world policy)
 * - optionIndexes: which policyOption index to use for tax types and specific non-tax types
 * - nationalStateId: the stateId used for national-scope statePolicies records
 * - regions: array of State documents for sub-national policy records
 *
 * economic/social: -3 (left/lib) to +3 (right/trad), 0 = center.
 */
export const COUNTRY_POLICY_CONFIGS: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Trump administration, January 2020 (pre-COVID)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: 0, social: 0 }, // Jan 2020: DeVos proposed cuts blocked by Congress, actual spending flat
      us_federal_science_funding: { economic: 0, social: 0 }, // Jan 2020: proposed NIH/NSF cuts blocked by Congress, actual spending flat
      us_school_standards: { economic: 0, social: 0 },
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 1, social: 0 }, // Jan 2020: ACA repeal attempts, Medicaid work requirements pushed
      us_drug_pricing_medicare: { economic: 0, social: 0 }, // Jan 2020: no Medicare negotiation (Trump admin)
      us_public_health: { economic: 0, social: 0 }, // Jan 2020: CDC neutral baseline
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 1, social: 0 }, // Jan 2020: Trump withdrew from Paris Agreement, fossil fuel deregulation
      us_conservation: { economic: 0, social: 0 },
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: 0, social: 0 }, // Jan 2020: TCJA rates in place
      us_federal_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // Jan 2020: 21% corporate rate in place
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity with domestic
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // Jan 2020: standard payroll tax schedule
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline: tariffs start at 0% until lawmakers change them
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // Jan 2020: no federal sales tax
      us_federal_spending_stimulus: { economic: 0, social: 0 },
      us_transportation: { economic: 0, social: 0 },
      us_broadband_energy: { economic: 0, social: 0 },
      us_minimum_wage: { economic: 2, social: 0 }, // Jan 2020: $7.25 frozen since 2009, right-wing position
      us_workforce_development: { economic: 1, social: 0 }, // Jan 2020: Trump workforce exec orders
      us_housing: { economic: 0, social: 0 }, // Jan 2020: HUD relatively passive under Carson, no major new programs
      us_food_nutrition: { economic: 1, social: 0 }, // Jan 2020: SNAP work requirements push
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // Jan 2020: no major changes
      us_medicaid: { economic: 0, social: 0 }, // Jan 2020: work requirement push mostly blocked by courts, effective status quo
      us_medicaid_expansion: { economic: 0, social: 0 },
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: 0 },
      us_prison_rehabilitation: { economic: 1, social: 1 }, // Jan 2020: First Step Act (bipartisan)
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: 1, social: 0 }, // Jan 2020: $738B defense budget
      us_foreign_policy: { economic: 0, social: 0 }, // Jan 2020: America First, mixed
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 2, social: 2 }, // Jan 2020: border wall, ICE, strict enforcement
      us_legal_immigration_visas: { economic: 1, social: 1 }, // Jan 2020: reduced legal immigration, merit-based push
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: 1 }, // Jan 2020: Mexico City gag rule reinstated, Title X changes, but Roe still law
      us_paid_family_leave: { economic: 1, social: 0 }, // Jan 2020: no federal paid leave (OECD outlier) — only unpaid FMLA; market-reliant = mild right
      us_gun_control: { economic: 0, social: 0 },
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: 0 }, // Jan 2020: neutral baseline
      us_civics_voting_rights: { economic: 0, social: 1 }, // Jan 2020: restrictive trend
      us_media_communications: { economic: 1, social: 0 }, // Jan 2020: FCC deregulation
      us_emergency_services: { economic: 0, social: 0 }, // Jan 2020: status quo state/local funding
    },
    optionIndexes: {
      us_federal_income_tax_rate: 4, // 20% — effective rate (~18% real); game uses flat rate × base, not marginal brackets
      us_federal_domestic_corporate_tax_rate: 5, // 20% — real Jan 2020: 21% (TCJA)
      us_federal_foreign_corporate_tax_rate: 3, // 18% — closest option to domestic 20% for day-one parity
      us_federal_payroll_tax_rate: 5, // 15% — real Jan 2020: 15.3% combined (12.4% SS + 2.9% Medicare)
      us_federal_tariff_rate: 0, // 0% — game baseline starts all tariffs at zero on reset
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax (unchanged)
      us_social_security: 5,
    },
    regions: states,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED KINGDOM — Boris Johnson Conservative govt, 80-seat majority,
  //  post-December 2019 general election, January 2020
  // ═══════════════════════════════════════════════════════════════════════════
  uk: {
    nationalStateId: "uk_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────────
      uk_nhs_funding: { economic: -1, social: 0 }, // Jan 2020: pledged £34B extra NHS funding
      uk_social_care: { economic: 0, social: 0 }, // Jan 2020: promised reform but nothing concrete yet
      uk_mental_health: { economic: 0, social: 0 }, // Jan 2020: modest pledges, no major shift
      uk_public_health: { economic: 0, social: 0 }, // Jan 2020: pre-COVID status quo
      // ── Education ──────────────────────────────────────────────────────────────
      uk_tuition_fees: { economic: 1, social: 0 }, // Jan 2020: £9,250/year maintained (Tory-era regime)
      uk_education_standards: { economic: 0, social: 0 }, // Jan 2020: academization continuing, no major shift
      uk_education_funding: { economic: -1, social: 0 }, // Jan 2020: promised extra school funding in 2019 spending round
      uk_research_science: { economic: -1, social: 0 }, // Jan 2020: pledged 2.4% GDP R&D target, Cummings' ARPA vision
      // ── Economic ───────────────────────────────────────────────────────────────
      uk_fiscal_spending: { economic: -1, social: 0 }, // Jan 2020: loosening austerity, spending review promised increases
      uk_local_government_funding: { economic: 0, social: 0 }, // Jan 2020: austerity legacy slowly easing, ambiguous
      // ── Infrastructure ─────────────────────────────────────────────────────────
      uk_transport_rail: { economic: -1, social: 0 }, // Jan 2020: HS2 confirmed Feb 2020, levelling up infrastructure push
      uk_energy_grid: { economic: 0, social: 0 }, // Jan 2020: mixed signals, green push early stages
      // ── Environment ────────────────────────────────────────────────────────────
      uk_climate_net_zero: { economic: -1, social: 0 }, // Jan 2020: net zero by 2050 legislated June 2019, COP26 host
      uk_north_sea_energy: { economic: 1, social: 0 }, // Jan 2020: continued licensing, pro-extraction alongside green pledges
      // ── Law & Justice ──────────────────────────────────────────────────────────
      uk_policing_crime: { economic: -1, social: 1 }, // Jan 2020: 20k new police (investment=left-eco, tough-on-crime=right-soc)
      uk_prison_rehabilitation: { economic: 0, social: 0 }, // Jan 2020: status quo
      // ── Defence ────────────────────────────────────────────────────────────────
      uk_defence_spending: { economic: 1, social: 0 }, // Jan 2020: NATO 2%+, Global Britain ambitions
      uk_trident_defence: { economic: 0, social: 0 }, // Jan 2020: Trident renewal continuing, bipartisan consensus
      // ── Foreign Policy ─────────────────────────────────────────────────────────
      uk_foreign_policy: { economic: 0, social: 0 }, // Jan 2020: Global Britain rhetoric, early stages
      // ── Welfare ────────────────────────────────────────────────────────────────
      uk_universal_credit: { economic: 1, social: 0 }, // Jan 2020: continuing Cameron-era reform, below-inflation benefit rises
      uk_state_pensions: { economic: -1, social: 0 }, // Jan 2020: triple lock maintained, above-inflation pension increases
      uk_childcare: { economic: 0, social: 0 }, // Jan 2020: 15-30 free hours for working parents — moderate framework
      // ── Immigration ────────────────────────────────────────────────────────────
      uk_immigration_asylum: { economic: 1, social: 1 }, // Jan 2020: points-based system replacing EU free movement
      uk_work_visas: { economic: 1, social: 0 }, // Jan 2020: points-based system, skilled-worker focus
      // ── Labour ─────────────────────────────────────────────────────────────────
      uk_workers_rights: { economic: 0, social: 0 }, // Jan 2020: promised high standards post-Brexit, no legislation
      uk_workforce_development: { economic: 0, social: 0 }, // Jan 2020: apprenticeship levy continuing
      // ── Housing ────────────────────────────────────────────────────────────────
      uk_housing_planning: { economic: -1, social: 0 }, // Jan 2020: Help to Buy extended, levelling up housing promises
      uk_leasehold_reform: { economic: -1, social: 0 }, // Jan 2020: promised leasehold reforms to help homeowners
      // ── Governance ─────────────────────────────────────────────────────────────
      uk_devolution_local_powers: { economic: -1, social: 0 }, // Jan 2020: levelling up agenda, promised more devolution deals
      uk_government_ethics: { economic: 0, social: 0 }, // Jan 2020: status quo
      uk_electoral_reform: { economic: 0, social: 0 }, // Jan 2020: FPTP status quo, voter ID proposed but not yet law
      // ── Media ──────────────────────────────────────────────────────────────────
      uk_bbc_public_media: { economic: 0, social: 0 }, // Jan 2020: licence fee review threatened but not yet actioned
      uk_digital_broadband: { economic: 0, social: 0 }, // Jan 2020: promised full-fibre, early stages
      // ── Civil Liberties ────────────────────────────────────────────────────────
      uk_surveillance_privacy: { economic: 0, social: 1 }, // Jan 2020: Investigatory Powers Act 2016 in full effect
      uk_drug_policy: { economic: 0, social: 0 }, // Jan 2020: status quo (conservative)
    },
    optionIndexes: {
      uk_income_tax_rate: 5, // 20% — real Jan 2020: 20% basic rate
      uk_national_insurance: 5, // 12% — real Jan 2020: 12% employee Class 1
      uk_vat: 5, // 20% — real Jan 2020: 20% standard rate (unchanged)
      uk_excise_customs: 0, // 0% — game baseline starts all tariffs at zero on reset
      uk_domestic_corporation_tax: 4, // 20% — real Jan 2020: 19% (closest available option)
      uk_foreign_corporation_tax: 3, // 19% — closest to domestic 20% for day-one parity
      uk_nhs_funding: 3,
      uk_tuition_fees: 3,
      uk_state_pensions: 3,
      uk_fiscal_spending: 3,
    },
    regions: ukRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  JAPAN — Abe Shinzo government, January 2020
  // ═══════════════════════════════════════════════════════════════════════════
  jp: {
    nationalStateId: "jp_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      jp_national_health_insurance: { economic: 0, social: 0 }, // Jan 2020: universal coverage maintained, no major changes
      jp_elder_care: { economic: 0, social: 0 }, // Jan 2020: long-term care insurance running as-is
      jp_mental_health: { economic: 0, social: 0 }, // Jan 2020: modest awareness campaigns
      jp_public_health: { economic: 0, social: 0 }, // Jan 2020: pre-COVID status quo
      // ── Education ──────────────────────────────────────────────────────────
      jp_education_funding: { economic: 0, social: 0 }, // Jan 2020: stable
      jp_university_tuition: { economic: 0, social: 0 }, // Jan 2020: free tuition for low-income started Apr 2020, barely in effect
      jp_academic_reform: { economic: 0, social: 0 }, // Jan 2020: status quo
      jp_research_science: { economic: -1, social: 0 }, // Jan 2020: Society 5.0 initiative, science funding increases
      // ── Defense & Security ─────────────────────────────────────────────────
      jp_article9_sdf: { economic: 1, social: 1 }, // Jan 2020: Abe's defining goal — constitutional revision of Article 9
      jp_defense_spending: { economic: 1, social: 0 }, // Jan 2020: record budgets, Izumo carrier conversion
      jp_cybersecurity: { economic: 0, social: 0 }, // Jan 2020: NISC operating, gradual buildup
      // ── Economic ───────────────────────────────────────────────────────────
      jp_fiscal_stimulus: { economic: -1, social: 0 }, // Jan 2020: Abenomics first arrow — massive fiscal stimulus
      jp_minimum_wage: { economic: -1, social: 0 }, // Jan 2020: Abe raised min wage annually, ¥901 in 2019 targeting ¥1,000
      jp_labor_reform: { economic: -1, social: 0 }, // Jan 2020: Work Style Reform law passed 2018 — overtime caps, equal pay
      jp_sme_support: { economic: -1, social: 0 }, // Jan 2020: active SME subsidies, succession support programs
      jp_local_allocation_tax: { economic: 0, social: 0 }, // Jan 2020: standard fiscal transfers
      // ── Infrastructure ─────────────────────────────────────────────────────
      jp_disaster_preparedness: { economic: -1, social: 0 }, // Jan 2020: major investment post-2018 floods and Typhoon Hagibis
      jp_rail_transport: { economic: 0, social: 0 }, // Jan 2020: Shinkansen network stable
      jp_digital_infrastructure: { economic: -1, social: 0 }, // Jan 2020: My Number expansion, push toward digital government
      // ── Environment & Energy ───────────────────────────────────────────────
      jp_nuclear_energy: { economic: 1, social: 0 }, // Jan 2020: Abe pushed reactor restarts post-Fukushima
      jp_climate_emissions: { economic: 0, social: 0 }, // Jan 2020: Paris commitment but modest targets
      jp_renewable_energy: { economic: -1, social: 0 }, // Jan 2020: feed-in tariff system, slower than peers but active
      // ── Social Policy ──────────────────────────────────────────────────────
      jp_family_policy: { economic: -1, social: 0 }, // Jan 2020: free preschool from Oct 2019, childcare expansion, Womenomics
      jp_pension: { economic: 0, social: 0 }, // Jan 2020: pensionable age 65 with macro-slide indexation — sustainability-centrist baseline
      jp_gender_equality: { economic: -1, social: -1 }, // Jan 2020: Womenomics — female board targets, childcare expansion
      jp_work_culture_reform: { economic: 0, social: 0 }, // Jan 2020: overlaps with labor reform, captured there
      // ── Immigration ────────────────────────────────────────────────────────
      jp_foreign_worker_policy: { economic: -1, social: 0 }, // Jan 2020: new Specified Skilled Worker visa launched Apr 2019
      jp_visa_residency: { economic: 0, social: 0 }, // Jan 2020: covered under foreign workers
      jp_integration_programs: { economic: 0, social: 0 }, // Jan 2020: minimal, early stages
      // ── Agriculture ────────────────────────────────────────────────────────
      jp_agricultural_subsidies: { economic: -1, social: 0 }, // Jan 2020: continued rice subsidies, JA cooperative support
      jp_food_security: { economic: 0, social: 0 }, // Jan 2020: status quo
      jp_rural_development: { economic: 0, social: 0 }, // Jan 2020: regional revitalization ongoing
      // ── Governance ─────────────────────────────────────────────────────────
      jp_constitutional_reform: { economic: 0, social: 1 }, // Jan 2020: Abe wanted referendum on Article 96/9
      jp_regional_autonomy: { economic: 0, social: 0 }, // Jan 2020: status quo
      jp_electoral_reform: { economic: 0, social: 0 }, // Jan 2020: minor seat redistribution, no major reform
      // ── Foreign Policy / Trade ─────────────────────────────────────────────
      jp_foreign_aid_diplomacy: { economic: -1, social: 0 }, // Jan 2020: active ODA, Free and Open Indo-Pacific strategy
      jp_trade_agreements: { economic: -1, social: 0 }, // Jan 2020: CPTPP champion, EU-Japan EPA
      // ── Technology ─────────────────────────────────────────────────────────
      jp_robotics_ai: { economic: 0, social: 0 }, // Jan 2020: early strategy documents
      jp_rd_investment: { economic: -1, social: 0 }, // Jan 2020: Society 5.0, industrial R&D increases
      jp_digital_governance: { economic: -1, social: 0 }, // Jan 2020: My Number expansion, precursor to Digital Agency
      // ── Public Safety ──────────────────────────────────────────────────────
      jp_policing_public_safety: { economic: 0, social: 0 }, // Jan 2020: status quo (very low crime rate)
      jp_criminal_justice: { economic: 0, social: 0 }, // Jan 2020: status quo (hostage justice system unchanged)
    },
    optionIndexes: {
      // JP tax types — center indexes match real Jan 2020 rates accurately:
      // Income 25% (real: ~23% effective avg), Corp 23% (real: 23.2%),
      // Social Insurance 15%, Consumption 10%, Resident 10%, Fixed Asset 1.4%.
      // Tariffs intentionally start at 0% for the game baseline.
      jp_income_tax_rate: 5, // 25% — bracket array: 0,5,10,15,20,25,30,35,40,45,50
      jp_domestic_corporation_tax: 5, // 23% — bracket array: 0,5,9,14,18,23,28,32,37,41,46
      jp_foreign_corporation_tax: 3, // 19% — below-domestic parity (array: 0,6,13,19,26,32,...; domestic at 23%)
      jp_social_insurance: 5, // 15% — bracket array: 0,3,6,9,12,15,18,21,24,27,30
      jp_consumption_tax: 5, // 10% — bracket array: 0,3,5,8,9,10,13,15,18,22,25
      jp_resident_tax: 5, // 10% — bracket array: 0,2,4,6,8,10,12,14,16,18,20
      jp_fixed_asset_tax: 5, // 1.4% — bracket array: 0,0.2,0.5,0.8,1.1,1.4,1.8,2.2,3.0,4.0,5.0
      jp_customs_tariff: 0,
    },
    regions: jpRegions,
  },
  de: {
    nationalStateId: "de_national",
    defaults: {
      // ── Tax (8 types, all statutory baseline) ───────────────────────────
      de_income_tax_rate: { economic: 0, social: 0 }, // 42% statutory
      de_solidarity_surcharge: { economic: 0, social: 0 }, // 5.5% statutory
      de_vat_rate: { economic: 0, social: 0 }, // 19% statutory
      de_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // 15% statutory
      de_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // 15% day-one parity
      de_payroll_social_insurance: { economic: 0, social: 0 }, // 20% combined Beitragssatz
      de_customs_tariff_rate: { economic: 0, social: 0 }, // game-baseline 0%
      de_trade_tax: { economic: 0, social: 0 }, // 400% Hebesatz (regional)
      // ── Existing non-tax (reshape in PR2-PR4) ───────────────────────────
      de_minimum_wage: { economic: 1, social: 0 }, // PR4: pre-Ampel level (€9), below statutory €12 baseline
      de_renewable_energy_target: { economic: 0, social: -1 },
      de_immigration_policy: { economic: 0, social: 0 },
      // ── PR2 non-tax (Healthcare + Education + Social) ───────────────────
      de_health_insurance: { economic: 0, social: 0 }, // Merkel IV: GKV stable under Spahn
      de_elder_care: { economic: 0, social: 0 }, // GroKo Pflegestärkungsgesetze
      de_mental_health: { economic: 0, social: 0 }, // GroKo: modest awareness
      de_public_health: { economic: 0, social: 0 },
      de_education_funding: { economic: -1, social: 0 }, // GroKo: Digitalpakt expansion
      de_university_tuition: { economic: 0, social: 0 }, // Statutory: no tuition in most Länder
      de_academic_reform: { economic: 0, social: 0 },
      de_research_science: { economic: -1, social: 0 }, // GroKo: Hightech-Strategie active
      de_pension_system: { economic: -1, social: 0 }, // Doppelte Haltelinie active
      de_family_policy: { economic: -1, social: 0 }, // Gute-Kita-Gesetz active
      de_unemployment_welfare: { economic: 1, social: 0 }, // Hartz IV in force at canonical game-start
      de_gender_equality: { economic: 0, social: -1 }, // FüPoG II + Entgelttransparenzgesetz active
      // ── PR3 non-tax (Defense + Foreign + Tech + Public Safety) ──────────
      de_bundeswehr_funding: { economic: 1, social: 1 }, // Trendwende — slow expansion, NATO 2% not yet met
      de_defense_posture: { economic: 0, social: 0 }, // Statutory: NATO + UN peacekeeping
      de_cybersecurity: { economic: 0, social: 0 }, // IT-Sicherheitsgesetz 2.0, BSI operational
      de_eu_integration: { economic: -1, social: 0 }, // Merkel-era pro-EU integrationist consensus
      de_foreign_aid_diplomacy: { economic: -1, social: 0 }, // BMZ active, ~0.6%-of-GNI trajectory
      de_trade_agreements: { economic: 0, social: 0 },
      de_robotics_ai: { economic: 0, social: 0 },
      de_digital_governance: { economic: -1, social: 0 }, // OZG rollout active but lagging
      de_policing_public_safety: { economic: 0, social: 0 },
      de_criminal_justice: { economic: 0, social: 0 },
      de_constitutional_protection: { economic: 0, social: 0 },
      // ── PR4 non-tax (Economic + Infra + Env + Imm + Agri + Gov + Media) ─
      de_fiscal_stimulus_act: { economic: 1, social: 0 }, // Schwarze-Null era, strict Schuldenbremse
      de_labor_reform: { economic: 0, social: 0 }, // Hartz IV in force; no major reform pending
      de_sme_mittelstand: { economic: 0, social: 0 },
      de_rail_transport: { economic: 0, social: 0 }, // moderate DB funding; pre-Deutschlandticket
      de_digital_infrastructure: { economic: -1, social: 0 }, // Digitalpakt active, Gigabit-Strategie early
      de_housing: { economic: -1, social: 0 }, // Wohngipfel active; modest Sozialer Wohnungsbau
      de_nuclear_energy: { economic: 0, social: 0 }, // statutory phase-out
      de_carbon_pricing: { economic: 0, social: 0 }, // BEHG ~€25/tCO2 floor
      de_climate_targets: { economic: -1, social: 0 }, // GroKo-era KSG 2019 framework
      de_asylum_policy: { economic: 0, social: 1 }, // post-Geordnete-Rückkehr-Gesetz drift
      de_integration_programs: { economic: 0, social: 0 },
      de_agricultural_subsidies: { economic: -1, social: 0 }, // GAP + Bauernhilfen continued
      de_food_security: { economic: 0, social: 0 },
      de_animal_welfare: { economic: 0, social: 0 }, // statutory Tierschutzgesetz
      de_grundgesetz_reform: { economic: 0, social: 0 },
      de_electoral_reform: { economic: 0, social: 0 },
      de_government_ethics: { economic: 0, social: 0 },
      de_public_broadcasting: { economic: 0, social: 0 }, // Rundfunkbeitrag ~€18/month/household
      de_press_freedom: { economic: 0, social: 0 },
      // ── PR5 non-tax (Land-level, state-scope) ───────────────────────────
      de_land_education: { economic: -1, social: 0 }, // largest Land budget line
      de_land_police: { economic: 0, social: 0 },
      de_land_culture: { economic: 0, social: 0 },
      de_land_economic_development: { economic: -1, social: 0 }, // active Strukturpolitik
      de_land_health_services: { economic: 0, social: 0 },
      de_land_municipal_grants: { economic: -1, social: 0 }, // statutory Schlüsselzuweisungen
    },
    optionIndexes: {
      // Tax-type bracket overrides — point to the Jan 2020 statutory rate bracket
      de_income_tax_rate: 5, // 42% (bracket 5 of 0,10,20,28,35,42,45,50,55,60,65)
      de_solidarity_surcharge: 5, // 5.5% (bracket 5 of 0,0.5,1,2,4,5.5,6.5,7.5,8.5,9.5,10)
      de_vat_rate: 5, // 19% (bracket 5 of 0,5,7,10,16,19,20,22,24,25,28)
      de_domestic_corporate_tax_rate: 5, // 15% (bracket 5 of 0,3,5,8,12,15,18,20,22,25,30)
      de_foreign_corporate_tax_rate: 5, // 15% day-one parity with domestic
      de_payroll_social_insurance: 5, // 20% combined statutory
      de_customs_tariff_rate: 0, // 0% game baseline (all tariffs start at zero)
      de_trade_tax: 5, // 400% Hebesatz (bracket 5 of 200,240,280,320,360,400,440,480,520,560,600)
      // Existing non-tax — KEEP PRE-PR1 INDEXES; PR4 reshapes these types and
      // updates indexes alongside the new 7-option layout. Touching them now
      // would mis-resolve runtime lookups against the current 4-5 option arrays.
      de_minimum_wage: 2, // PR4 7-option layout: Pre-Reform Minimum Wage (€9, pre-Ampel) at index 2
      de_renewable_energy_target: 3, // PR4: statutory 65%-by-2030 at index 3
      de_immigration_policy: 3, // PR4: statutory Fachkräfteeinwanderungsgesetz at index 3
      // ── PR2 optionIndex overrides ─────────────────────────────────────
      de_gender_equality: 2, // Spec §14.7: optionIndex override 2 (Gender Equality Expansion Act)
      // ── PR4 optionIndex overrides ─────────────────────────────────────
      de_fiscal_stimulus_act: 4, // Schuldenbremse Compliance Act — Schwarze-Null era baseline
    },
    regions: deRegions,
  },

  // ── Ireland — PR1 (taxation phase, 2026-05-27) ──────────────────────────────
  ie: {
    nationalStateId: "ie_national",
    defaults: {
      // Tax (11 types, all Jan-2024 statutory baseline)
      ie_corporate_tax_rate: { economic: 0, social: 0 },
      ie_foreign_corporate_tax_rate: { economic: 0, social: 0 },
      ie_income_tax_rate: { economic: 0, social: 0 },
      ie_usc: { economic: 0, social: 0 },
      ie_prsi: { economic: 0, social: 0 },
      ie_vat_rate: { economic: 0, social: 0 },
      ie_customs_tariff_rate: { economic: 0, social: 0 },
      ie_local_property_tax: { economic: 0, social: 0 },
      ie_stamp_duty: { economic: 0, social: 0 },
      ie_capital_gains_tax: { economic: 0, social: 0 },
      ie_excise_duty: { economic: 0, social: 0 },
      // Existing 3 non-tax (housing, minwage, climate — later PRs rewrite)
      ie_housing_policy: { economic: 0, social: 0 },
      ie_minimum_wage: { economic: -1, social: 0 },
      ie_climate_policy: { economic: 0, social: 0 },
      // PR2 — Health & Education (8 types, 1 rewrite + 7 new)
      ie_healthcare_policy: { economic: 0, social: 0 },
      ie_public_health: { economic: 0, social: 0 },
      ie_mental_health: { economic: 0, social: 0 },
      ie_elder_care: { economic: 0, social: 0 },
      ie_education_funding: { economic: 0, social: 0 },
      ie_higher_education: { economic: 0, social: 0 },
      ie_research_science: { economic: -1, social: 0 },
      ie_curriculum_reform: { economic: 0, social: 0 },
      // PR3 — Welfare, Family, Social (7 new types)
      ie_state_pensions: { economic: 0, social: 0 },
      ie_unemployment_benefits: { economic: 0, social: 0 },
      ie_working_family_payment: { economic: 0, social: 0 },
      ie_parental_leave: { economic: 0, social: 0 },
      ie_childcare_policy: { economic: 0, social: 0 },
      ie_gender_equality: { economic: 0, social: 0 },
      ie_drug_policy: { economic: 0, social: 0 },
      // PR4 — Economy, Labour, Infra, Housing (7 new + 2 rewrites)
      ie_workers_rights: { economic: 0, social: 0 },
      ie_workforce_development: { economic: 0, social: 0 },
      ie_sme_support: { economic: 0, social: 0 },
      ie_fiscal_stimulus: { economic: 0, social: 0 },
      ie_transport_rail: { economic: 0, social: 0 },
      ie_digital_infrastructure: { economic: 0, social: 0 },
      ie_regional_economic_development: { economic: 0, social: 0 },
      // PR5 — Environment, Agriculture, Rural (5 new + 1 rewrite)
      ie_renewable_energy_target: { economic: 0, social: 0 },
      ie_agricultural_subsidies: { economic: 0, social: 0 },
      ie_food_security: { economic: 0, social: 0 },
      ie_rural_development: { economic: 0, social: 0 },
      ie_peat_bog_policy: { economic: 0, social: 0 },
      // PR6 — Defence, Foreign Affairs, Justice, Governance (8 new types)
      ie_defence_spending: { economic: 0, social: 0 },
      ie_neutrality_posture: { economic: 0, social: 0 },
      ie_foreign_aid_diplomacy: { economic: 0, social: 0 },
      ie_cybersecurity: { economic: 0, social: 0 },
      ie_garda_policing: { economic: 0, social: 0 },
      ie_criminal_justice: { economic: 0, social: 0 },
      ie_government_ethics: { economic: 0, social: 0 },
      ie_electoral_reform: { economic: 0, social: 0 },
      // PR7 — Immigration (3 new types)
      ie_immigration_asylum: { economic: 0, social: 0 },
      ie_work_visas: { economic: 0, social: 0 },
      ie_integration_programs: { economic: 0, social: 0 },
      // PR8 — Regional NUTS-III (4 new state-scoped types)
      ie_regional_health: { economic: 0, social: 0 },
      ie_regional_housing: { economic: 0, social: 0 },
      ie_regional_transport: { economic: 0, social: 0 },
      ie_regional_skills: { economic: 0, social: 0 },
    },
    optionIndexes: {
      ie_corporate_tax_rate: 3, // 12.5%
      ie_foreign_corporate_tax_rate: 3, // 12.5% day-one parity
      ie_income_tax_rate: 7, // 40% higher band
      ie_usc: 5, // 8% top USC band
      ie_prsi: 5, // 11% Class A combined
      ie_vat_rate: 6, // 23% standard
      ie_customs_tariff_rate: 0, // 0% game baseline
      ie_local_property_tax: 4, // 0.18% mid-band
      ie_stamp_duty: 3, // 2% averaged
      ie_capital_gains_tax: 6, // 33% statutory
      ie_excise_duty: 4, // 100 baseline multiplier
      // PR4 rewrites pinned to 7-option center idx 3 (housing + minwage)
      ie_minimum_wage: 3,
      ie_housing_policy: 3,
      // PR5 rewrite pinned to 7-option center idx 3 (climate)
      ie_climate_policy: 3,
      // PR2 — Health & Education (8 types, 7-option arrays, center idx 3)
      ie_healthcare_policy: 3,
      ie_public_health: 3,
      ie_mental_health: 3,
      ie_elder_care: 3,
      ie_education_funding: 3,
      ie_higher_education: 3,
      ie_research_science: 3,
      ie_curriculum_reform: 3,
      // PR3 — Welfare, Family, Social (7 types, 7-option arrays, center idx 3)
      ie_state_pensions: 3,
      ie_unemployment_benefits: 3,
      ie_working_family_payment: 3,
      ie_parental_leave: 3,
      ie_childcare_policy: 3,
      ie_gender_equality: 3,
      ie_drug_policy: 3,
      // PR4 — Economy, Labour, Infra (7 types, 7-option arrays, center idx 3)
      ie_workers_rights: 3,
      ie_workforce_development: 3,
      ie_sme_support: 3,
      ie_fiscal_stimulus: 3,
      ie_transport_rail: 3,
      ie_digital_infrastructure: 3,
      ie_regional_economic_development: 3,
      // PR5 — Environment, Agriculture, Rural (5 new; center idx 3)
      ie_renewable_energy_target: 3,
      ie_agricultural_subsidies: 3,
      ie_food_security: 3,
      ie_rural_development: 3,
      ie_peat_bog_policy: 3,
      // PR6 — Defence, Foreign Affairs, Justice, Governance (8 new; center idx 3)
      ie_defence_spending: 3,
      ie_neutrality_posture: 3,
      ie_foreign_aid_diplomacy: 3,
      ie_cybersecurity: 3,
      ie_garda_policing: 3,
      ie_criminal_justice: 3,
      ie_government_ethics: 3,
      ie_electoral_reform: 3,
      // PR7 — Immigration (3 new; center idx 3)
      ie_immigration_asylum: 3,
      ie_work_visas: 3,
      ie_integration_programs: 3,
      // PR8 — Regional NUTS-III (4 new state-scoped; center idx 3)
      ie_regional_health: 3,
      ie_regional_housing: 3,
      ie_regional_transport: 3,
      ie_regional_skills: 3,
    },
    regions: ieRegions,
  },

  // ── Brazil — econ-only stub (policy legislation not yet seeded; consumed by budgets.ts preset bundles) ─────────────
  br: {
    nationalStateId: "br_national",
    defaults: {},
    optionIndexes: {},
    regions: [],
  },

  // ── Nigeria — federal presidential republic baseline (NG legislation 5a) ─────
  ng: {
    nationalStateId: "ng_national",
    defaults: {
      // Tax (5a) — baseline stance is the statutory/center option (0/0).
      ng_vat_rate: { economic: 0, social: 0 },
      ng_companies_income_tax: { economic: 0, social: 0 },
      ng_personal_income_tax: { economic: 0, social: 0 },
      ng_petroleum_profit_tax: { economic: 0, social: 0 },
      ng_customs_tariff: { economic: 0, social: 0 },
      ng_capital_gains_tax: { economic: 0, social: 0 },
      ng_stamp_duty: { economic: 0, social: 0 },
      ng_excise_duty: { economic: 0, social: 0 },
      ng_paye: { economic: 0, social: 0 },
      // Economic / infrastructure / energy (5b) — baseline = center option.
      ng_petroleum_sector_reform: { economic: 0, social: 0 },
      ng_power_sector_reform: { economic: 0, social: 0 },
      ng_minimum_wage: { economic: 0, social: 0 },
      ng_industrial_policy: { economic: 0, social: 0 },
      ng_infrastructure_investment: { economic: 0, social: 0 },
      ng_agriculture_policy: { economic: 0, social: 0 },
      ng_renewable_energy: { economic: 0, social: 0 },
      ng_fiscal_framework: { economic: 0, social: 0 },
      // Social / health / education / foreign (5c) — baseline = center option.
      ng_health_insurance: { economic: 0, social: 0 },
      ng_primary_healthcare: { economic: 0, social: 0 },
      ng_public_health: { economic: 0, social: 0 },
      ng_basic_education: { economic: 0, social: 0 },
      ng_tertiary_education: { economic: 0, social: 0 },
      ng_technical_education: { economic: 0, social: 0 },
      ng_social_safety_net: { economic: 0, social: 0 },
      ng_pension_system: { economic: 0, social: 0 },
      ng_housing_policy: { economic: 0, social: 0 },
      ng_gender_equality: { economic: 0, social: 0 },
      ng_foreign_policy: { economic: 0, social: 0 },
      ng_regional_integration: { economic: 0, social: 0 },
      // Security / justice / governance / population (5c batch 2).
      ng_policing_reform: { economic: 0, social: 0 },
      ng_criminal_justice: { economic: 0, social: 0 },
      ng_counterinsurgency: { economic: 0, social: 0 },
      ng_defense_policy: { economic: 0, social: 0 },
      ng_anti_corruption: { economic: 0, social: 0 },
      ng_judiciary_reform: { economic: 0, social: 0 },
      ng_electoral_reform: { economic: 0, social: 0 },
      ng_federalism: { economic: 0, social: 0 },
      ng_civil_service_reform: { economic: 0, social: 0 },
      ng_press_freedom: { economic: 0, social: 0 },
      ng_digital_economy: { economic: 0, social: 0 },
      ng_water_sanitation: { economic: 0, social: 0 },
      ng_environmental_protection: { economic: 0, social: 0 },
      ng_population_policy: { economic: 0, social: 0 },
      // Additional domains (5c continued).
      ng_labor_rights: { economic: 0, social: 0 },
      ng_sme_support: { economic: 0, social: 0 },
      ng_trade_promotion: { economic: 0, social: 0 },
      ng_solid_minerals: { economic: 0, social: 0 },
      ng_youth_employment: { economic: 0, social: 0 },
      ng_land_reform: { economic: 0, social: 0 },
      ng_maternal_child_health: { economic: 0, social: 0 },
      ng_mental_health: { economic: 0, social: 0 },
      ng_disability_inclusion: { economic: 0, social: 0 },
      ng_immigration_policy: { economic: 0, social: 0 },
      ng_telecommunications: { economic: 0, social: 0 },
      ng_local_government: { economic: 0, social: 0 },
    },
    optionIndexes: {
      // Index of the seeded center (baseline) bracket in each type's policyOptions.
      ng_vat_rate: 3, // 7.5% statutory standard rate
      ng_companies_income_tax: 4, // 30% statutory headline
      ng_personal_income_tax: 4, // 24% statutory top band
      ng_petroleum_profit_tax: 3, // blended statutory petroleum take
      ng_customs_tariff: 3, // ECOWAS common-external-tariff average
      ng_capital_gains_tax: 2, // 10% statutory
      ng_stamp_duty: 2, // statutory documented-transaction rate
      ng_excise_duty: 3, // 100 = baseline excise calibration
      ng_paye: 3, // statutory combined payroll-contribution rate
      // Economic / infrastructure / energy (5b) — center option at index 2.
      ng_petroleum_sector_reform: 2,
      ng_power_sector_reform: 2,
      ng_minimum_wage: 2,
      ng_industrial_policy: 2,
      ng_infrastructure_investment: 2,
      ng_agriculture_policy: 2,
      ng_renewable_energy: 2,
      ng_fiscal_framework: 2,
      // Social / health / education / foreign (5c) — center option at index 2.
      ng_health_insurance: 2,
      ng_primary_healthcare: 2,
      ng_public_health: 2,
      ng_basic_education: 2,
      ng_tertiary_education: 2,
      ng_technical_education: 2,
      ng_social_safety_net: 2,
      ng_pension_system: 2,
      ng_housing_policy: 2,
      ng_gender_equality: 2,
      ng_foreign_policy: 2,
      ng_regional_integration: 2,
      // Security / justice / governance / population (5c batch 2) — center at index 2.
      ng_policing_reform: 2,
      ng_criminal_justice: 2,
      ng_counterinsurgency: 2,
      ng_defense_policy: 2,
      ng_anti_corruption: 2,
      ng_judiciary_reform: 2,
      ng_electoral_reform: 2,
      ng_federalism: 2,
      ng_civil_service_reform: 2,
      ng_press_freedom: 2,
      ng_digital_economy: 2,
      ng_water_sanitation: 2,
      ng_environmental_protection: 2,
      ng_population_policy: 2,
      // Additional domains (5c continued) — center option at index 2.
      ng_labor_rights: 2,
      ng_sme_support: 2,
      ng_trade_promotion: 2,
      ng_solid_minerals: 2,
      ng_youth_employment: 2,
      ng_land_reform: 2,
      ng_maternal_child_health: 2,
      ng_mental_health: 2,
      ng_disability_inclusion: 2,
      ng_immigration_policy: 2,
      ng_telecommunications: 2,
      ng_local_government: 2,
    },
    regions: [],
  },

  // ── China — Xi-era 2020-2023 baseline (added 2026-05-27 with CN legislation overhaul) ─────
  cn: {
    nationalStateId: "cn_national",
    defaults: {
      cn_enterprise_income_tax: { economic: 0, social: 0 },
      cn_individual_income_tax: { economic: 0, social: 0 },
      cn_value_added_tax: { economic: 0, social: 0 },
      cn_land_value_added_tax: { economic: 0, social: 0 },
      cn_urban_maintenance_construction_tax: { economic: 0, social: 0 },
      cn_stamp_duty: { economic: 0, social: 0 },
      cn_social_insurance_contribution: { economic: 0, social: 0 },
      cn_customs_tariff: { economic: 0, social: 0 },
      cn_provincial_resource_tax: { economic: 0, social: 0 },
      // PR2 — Healthcare (§15)
      cn_medical_insurance: { economic: 0, social: 0 },
      cn_elder_care: { economic: 0, social: 1 },
      cn_mental_health: { economic: 0, social: 1 },
      cn_public_health: { economic: 0, social: 1 },
      // PR2 — Education (§16)
      cn_education_funding: { economic: -1, social: 0 },
      cn_gaokao_reform: { economic: 0, social: 1 },
      cn_academic_pressure_reform: { economic: 0, social: 1 },
      cn_research_science: { economic: -1, social: 0 },
      // PR2 — Social Policy (§21)
      cn_pension_system: { economic: -1, social: 1 },
      cn_family_policy: { economic: -1, social: 0 },
      cn_gender_equality: { economic: 0, social: 1 },
      cn_common_prosperity: { economic: -1, social: 1 },
      // PR3 — Defense (§17)
      cn_pla_modernization: { economic: -1, social: 1 },
      cn_taiwan_strait_doctrine: { economic: 0, social: 2 },
      cn_cybersecurity: { economic: 0, social: 2 },
      // PR3 — Foreign Policy (§25)
      cn_belt_and_road: { economic: -1, social: 1 },
      cn_us_china_relations: { economic: 0, social: 1 },
      cn_un_security_council_posture: { economic: 0, social: 1 },
      // PR3 — Technology (§26)
      cn_ai_strategy: { economic: -1, social: 1 },
      cn_semiconductor_strategy: { economic: -2, social: 1 },
      // PR3 — Public Safety (§27)
      cn_public_security: { economic: 0, social: 2 },
      cn_criminal_justice: { economic: 0, social: 1 },
      cn_internet_governance: { economic: 0, social: 2 },
      // PR4 — Economic (§18)
      cn_state_enterprises: { economic: -1, social: 1 },
      cn_industrial_strategy: { economic: -1, social: 0 },
      cn_minimum_wage: { economic: -1, social: 0 },
      cn_fiscal_stimulus: { economic: 0, social: 0 },
      // PR4 — Infrastructure (§19)
      cn_rail_transport: { economic: -1, social: 0 },
      cn_digital_infrastructure: { economic: -1, social: 0 },
      cn_housing: { economic: -1, social: 1 },
      // PR4 — Environment & Energy (§20)
      cn_renewable_energy_target: { economic: -1, social: 0 },
      cn_nuclear_energy: { economic: -1, social: 0 },
      cn_emissions_trading_scheme: { economic: 0, social: 0 },
      cn_climate_targets: { economic: -1, social: 0 },
      // PR4 — Immigration & Hukou (§22)
      cn_hukou_reform: { economic: 1, social: -1 },
      cn_skilled_immigration: { economic: 0, social: 0 },
      cn_diaspora_engagement: { economic: 0, social: 1 },
      // PR4 — Agriculture (§23)
      cn_agricultural_subsidies: { economic: -1, social: 0 },
      cn_food_security: { economic: 0, social: 1 },
      cn_rural_revitalization: { economic: -1, social: 1 },
      // PR4 — Governance (§24)
      cn_anticorruption_campaign: { economic: 0, social: 2 },
      cn_npc_reform: { economic: 0, social: 1 },
      cn_hk_macao_affairs: { economic: 0, social: 2 },
      // PR4 — Media (§28)
      cn_state_media_funding: { economic: -1, social: 1 },
      cn_press_freedom: { economic: 0, social: 2 },
      // PR5 — Provincial (§29)
      cn_provincial_education: { economic: -1, social: 0 },
      cn_provincial_public_security: { economic: 0, social: 2 },
      cn_provincial_economic_development: { economic: -1, social: 0 },
      cn_provincial_health_services: { economic: -1, social: 0 },
      cn_provincial_culture_propaganda: { economic: 0, social: 1 },
      cn_provincial_environmental_policy: { economic: -1, social: 0 },
      cn_provincial_infrastructure_investment: { economic: -1, social: 0 },
    },
    optionIndexes: {
      cn_enterprise_income_tax: 5, // 25% statutory headline
      cn_individual_income_tax: 7, // 45% statutory top bracket
      cn_value_added_tax: 5, // 13% headline statutory
      cn_land_value_added_tax: 5, // 40% progressive midpoint
      cn_urban_maintenance_construction_tax: 5, // 7% urban statutory
      cn_stamp_duty: 5, // 0.05% documented-transaction statutory
      cn_social_insurance_contribution: 5, // 28% employer-side statutory combined
      cn_customs_tariff: 0, // 0% game baseline (tariffs start at zero)
      cn_provincial_resource_tax: 5, // 6% statutory ad-valorem
      // PR2 — Healthcare (§15) — all sit at center option 3
      cn_medical_insurance: 3,
      cn_elder_care: 3,
      cn_mental_health: 3,
      cn_public_health: 3,
      // PR2 — Education (§16) — all sit at center option 3
      cn_education_funding: 3,
      cn_gaokao_reform: 3,
      cn_academic_pressure_reform: 3,
      cn_research_science: 3,
      // PR2 — Social Policy (§21) — all sit at center option 3
      cn_pension_system: 3,
      cn_family_policy: 3,
      cn_gender_equality: 3,
      cn_common_prosperity: 3,
      // PR3 — Defense (§17) — all sit at center option 3
      cn_pla_modernization: 3,
      cn_taiwan_strait_doctrine: 3,
      cn_cybersecurity: 3,
      // PR3 — Foreign Policy (§25) — all sit at center option 3
      cn_belt_and_road: 3,
      cn_us_china_relations: 3,
      cn_un_security_council_posture: 3,
      // PR3 — Technology (§26) — all sit at center option 3
      cn_ai_strategy: 3,
      cn_semiconductor_strategy: 3,
      // PR3 — Public Safety (§27) — all sit at center option 3
      cn_public_security: 3,
      cn_criminal_justice: 3,
      cn_internet_governance: 3,
      // PR4 — Economic (§18) — all sit at center option 3
      cn_state_enterprises: 3,
      cn_industrial_strategy: 3,
      cn_minimum_wage: 3,
      cn_fiscal_stimulus: 3,
      // PR4 — Infrastructure (§19) — all sit at center option 3
      cn_rail_transport: 3,
      cn_digital_infrastructure: 3,
      cn_housing: 3,
      // PR4 — Environment & Energy (§20) — all sit at center option 3
      cn_renewable_energy_target: 3,
      cn_nuclear_energy: 3,
      cn_emissions_trading_scheme: 3,
      cn_climate_targets: 3,
      // PR4 — Immigration & Hukou (§22) — all sit at center option 3
      cn_hukou_reform: 3,
      cn_skilled_immigration: 3,
      cn_diaspora_engagement: 3,
      // PR4 — Agriculture (§23) — all sit at center option 3
      cn_agricultural_subsidies: 3,
      cn_food_security: 3,
      cn_rural_revitalization: 3,
      // PR4 — Governance (§24) — all sit at center option 3
      cn_anticorruption_campaign: 3,
      cn_npc_reform: 3,
      cn_hk_macao_affairs: 3,
      // PR4 — Media (§28) — state media center, press freedom uses optionIndex 4 per spec inverted direction
      cn_state_media_funding: 3,
      cn_press_freedom: 4,
      // PR5 — Provincial (§29) — all sit at center option 3
      cn_provincial_education: 3,
      cn_provincial_public_security: 3,
      cn_provincial_economic_development: 3,
      cn_provincial_health_services: 3,
      cn_provincial_culture_propaganda: 3,
      cn_provincial_environmental_policy: 3,
      cn_provincial_infrastructure_investment: 3,
    },
    regions: cnRegions,
  },

  // ── USSR (1979 command-economy / one-party defaults) ───────────────────────
  // defaults sit on the state-control / authoritarian end; the reform options
  // (privatization, multiparty, glasnost) are the player's liberalization path.
  su: {
    nationalStateId: "su_national",
    defaults: {
      su_enterprise_levy: { economic: -3, social: 0 },
      su_individual_income_tax: { economic: 0, social: 0 },
      su_turnover_tax: { economic: 0, social: 0 },
      su_social_insurance: { economic: 0, social: 0 },
      su_customs_tariff: { economic: -3, social: 0 },
      su_economic_system: { economic: -4, social: 0 },
      su_political_system: { economic: 0, social: 3 },
      su_price_controls: { economic: -3, social: 0 },
      su_agriculture: { economic: -3, social: 0 },
      su_civil_liberties: { economic: 0, social: 3 },
      su_defense_spending: { economic: -2, social: 1 },
      su_housing: { economic: -3, social: 0 },
    },
    optionIndexes: {
      su_enterprise_levy: 4, // Enterprise Profit Remittance Statute
      su_individual_income_tax: 1, // Flat Citizens' Levy
      su_turnover_tax: 2, // Turnover Tax Schedule
      su_social_insurance: 1, // Unified Social Insurance Statute
      su_customs_tariff: 2, // Foreign Trade Monopoly Statute
      su_economic_system: 4, // Economic Organization Law (orthodox Gosplan)
      su_political_system: 3, // Article 6 Statute (one-party)
      su_price_controls: 2, // State Price Regulation Statute
      su_agriculture: 2, // Collective Agriculture Statute
      su_civil_liberties: 2, // State Information & Order Statute
      su_defense_spending: 2, // Defense and Military-Industrial Statute
      su_housing: 2, // State Housing Allocation Statute
    },
    regions: ruRegions,
  },

  // ── France (1979 Fifth Republic — market economy + large welfare state) ─────
  fr: {
    nationalStateId: "fr_national",
    defaults: {
      fr_income_tax: { economic: 0, social: 0 },
      fr_corporate_tax: { economic: 0, social: 0 },
      fr_vat: { economic: 0, social: 0 },
      fr_social_charges: { economic: 0, social: 0 },
      fr_customs_tariff: { economic: 0, social: 0 },
      fr_nationalization: { economic: 1, social: 0 }, // 1979: dirigiste mixed economy (centre-right govt)
      fr_labor_law: { economic: -1, social: 0 }, // strong Code du Travail
      fr_welfare_state: { economic: -1, social: 0 }, // comprehensive Sécurité sociale
    },
    optionIndexes: {
      fr_income_tax: 3, // Impôt sur le Revenu Statute (standard progressive)
      fr_corporate_tax: 3, // Impôt sur les Sociétés Statute
      fr_vat: 2, // TVA Schedule
      fr_social_charges: 1, // Cotisations Sociales Statute
      fr_customs_tariff: 1, // Customs Tariff Statute (EEC CET)
      fr_nationalization: 2, // Mixed Economy Statute
      fr_labor_law: 2, // Code du Travail Statute
      fr_welfare_state: 2, // Sécurité Sociale Statute
      // Spending-category defaults (1979): nearest-fit index on the same cost
      // ladder authored for 1953 (fiscal-scale audit follow-up, 2026-07-28) —
      // not independently re-calibrated to the 1979 baseline to the same
      // tolerance as 1953; see FR budgets1953.test.ts coverage for the tuned side.
      fr_health_insurance: 2,
      fr_education_funding: 1,
      fr_infrastructure_investment: 1,
      fr_defense_appropriations: 0,
      fr_economic_subsidies: 1,
      fr_local_grants: 3,
    },
    regions: frRegions,
  },

  // ── Italy (1979 First Republic — mixed economy + IRI/ENI state holdings) ─────
  it: {
    nationalStateId: "it_national",
    defaults: {
      it_income_tax: { economic: 0, social: 0 },
      it_corporate_tax: { economic: 0, social: 0 },
      it_vat: { economic: 0, social: 0 },
      it_social_charges: { economic: 0, social: 0 },
      it_customs_tariff: { economic: 0, social: 0 },
      it_state_holdings: { economic: -2, social: 0 }, // IRI/ENI mixed economy
      it_labor_law: { economic: -2, social: 0 }, // Statuto dei Lavoratori
      it_welfare_state: { economic: -2, social: 0 }, // generous pensions + new SSN
    },
    optionIndexes: {
      it_income_tax: 3, // IRPEF Statute
      it_corporate_tax: 3, // IRPEG Statute
      it_vat: 2, // IVA Schedule
      it_social_charges: 1, // Contributi INPS Statute
      it_customs_tariff: 1, // Customs Tariff Statute (EEC CET)
      it_state_holdings: 2, // Partecipazioni Statali Law
      it_labor_law: 2, // Statuto dei Lavoratori Statute
      it_welfare_state: 2, // Stato Sociale Statute
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above.
      it_health_insurance: 3,
      it_education_funding: 2,
      it_infrastructure_investment: 2,
      it_defense_appropriations: 1,
      it_economic_subsidies: 3,
      it_local_grants: 3,
    },
    regions: itRegions,
  },

  // ── Spain (1979 Transition — modernising mixed economy + INI state holdings) ─
  es: {
    nationalStateId: "es_national",
    defaults: {
      es_income_tax: { economic: 0, social: 0 },
      es_corporate_tax: { economic: 0, social: 0 },
      es_consumption_tax: { economic: 0, social: 0 },
      es_social_charges: { economic: 0, social: 0 },
      es_customs_tariff: { economic: 0, social: 0 },
      es_state_holdings: { economic: -2, social: 0 }, // INI mixed economy
      es_labor_law: { economic: -1, social: 0 },
      es_welfare_state: { economic: -1, social: 0 }, // welfare state being built
    },
    optionIndexes: {
      es_income_tax: 3, // IRPF Statute
      es_corporate_tax: 3, // Impuesto de Sociedades Statute
      es_consumption_tax: 2, // ITE Schedule
      es_social_charges: 1, // Seguridad Social Statute
      es_customs_tariff: 1, // Customs Tariff Statute
      es_state_holdings: 2, // Patrimonio del Estado Law
      es_labor_law: 2, // Estatuto de los Trabajadores Statute
      es_welfare_state: 2, // Estado del Bienestar Statute
    },
    regions: esRegions,
  },

  // ── Sweden (1979 the Swedish model — high-tax, high-welfare, strong unions) ──
  se: {
    nationalStateId: "se_national",
    defaults: {
      se_income_tax: { economic: 0, social: 0 },
      se_corporate_tax: { economic: 0, social: 0 },
      se_vat: { economic: 0, social: 0 },
      se_social_charges: { economic: 0, social: 0 },
      se_customs_tariff: { economic: 0, social: 0 },
      se_wage_earner_funds: { economic: 1, social: 0 }, // 1979: private ownership (status quo); funds not yet enacted
      se_labor_law: { economic: -2, social: 0 }, // MBL codetermination
      se_welfare_state: { economic: -2, social: 0 }, // universal folkhem
    },
    optionIndexes: {
      se_income_tax: 3, // Statlig Inkomstskatt Statute
      se_corporate_tax: 3, // Bolagsskatt Statute
      se_vat: 2, // Moms Schedule
      se_social_charges: 1, // Arbetsgivaravgift Statute
      se_customs_tariff: 1, // Customs Tariff Statute
      se_wage_earner_funds: 2, // Status Quo Ownership Statute (private)
      se_labor_law: 2, // Medbestämmandelagen Statute
      se_welfare_state: 2, // Folkhemmet Statute
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above.
      se_health_insurance: 3,
      se_education_funding: 3,
      se_infrastructure_investment: 3,
      se_defense_appropriations: 1,
      se_economic_subsidies: 3,
      se_local_grants: 3,
    },
    regions: seRegions,
  },

  // ── Turkey (1979 étatist import-substitution economy in crisis) ─────────────
  gr: {
    nationalStateId: "gr_national",
    defaults: {
      gr_income_tax: { economic: 0, social: 0 }, // 1979: progressive schedule; evasion endemic
      gr_corporate_tax: { economic: 0, social: 0 }, // 1979: standard rate; shipping exempt via tonnage regime
      gr_sales_tax: { economic: 0, social: 0 }, // 1979: turnover/stamp taxes; VAT only in 1987
      gr_social_charges: { economic: 0, social: 0 }, // 1979: IKA + occupational funds expanding
      gr_customs_tariff: { economic: -1, social: 0 }, // 1979: EEC accession treaty commits to dismantling; still protective
      gr_state_enterprises: { economic: -1, social: 0 }, // 1979: state banks + DEI/OTE + problematic enterprises; left
      gr_labor_law: { economic: 0, social: 0 }, // 1979: post-junta labor mobilisation; GSEE militancy
      gr_welfare_state: { economic: 0, social: 0 }, // 1979: fragmented pensions; farm supports
    },
    optionIndexes: {
      gr_income_tax: 3,
      gr_corporate_tax: 3,
      gr_sales_tax: 2,
      gr_social_charges: 2,
      gr_customs_tariff: 2,
      gr_state_enterprises: 2,
      gr_labor_law: 2,
      gr_welfare_state: 2,
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above.
      gr_health_insurance: 3,
      gr_education_funding: 3,
      gr_infrastructure_investment: 2,
      gr_defense_appropriations: 2,
      gr_economic_subsidies: 3,
      gr_local_grants: 3,
    },
    regions: grRegions,
  },

  at: {
    nationalStateId: "at_national",
    defaults: {
      at_income_tax: { economic: 0, social: 0 }, // 1979: 62% top rate; broad, well-collected wage-tax base
      at_corporate_tax: { economic: 0, social: 0 }, // 1979: Körperschaftsteuer standard rate
      at_sales_tax: { economic: 0, social: 0 }, // 1979: VAT since 1973; standard 18%
      at_social_charges: { economic: 0, social: 0 }, // 1979: ASVG contributions heavy but consensual
      at_customs_tariff: { economic: 1, social: 0 }, // 1979: EFTA + 1972 EEC FTA — industrial tariffs dismantled; right
      at_state_enterprises: { economic: -2, social: 0 }, // 1979: ÖIAG — the largest nationalised sector in the West; left
      at_labor_law: { economic: -1, social: 0 }, // 1979: ArbVG 1974 + Parity Commission; strong co-determination
      at_welfare_state: { economic: -1, social: 0 }, // 1979: Kreisky welfare expansion at its peak
    },
    optionIndexes: {
      at_income_tax: 3,
      at_corporate_tax: 3,
      at_sales_tax: 2,
      at_social_charges: 1,
      at_customs_tariff: 0,
      at_state_enterprises: 2,
      at_labor_law: 2,
      at_welfare_state: 2,
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above. Even
      // with the Bundesheer founded (1955), AT's authored 1979 defense share
      // (1.2% GDP) is still nearest the ladder's minimum rung.
      at_health_insurance: 2,
      at_education_funding: 2,
      at_infrastructure_investment: 1,
      at_defense_appropriations: 0,
      at_economic_subsidies: 1,
      at_local_grants: 2,
    },
    regions: atRegions,
  },

  fi: {
    nationalStateId: "fi_national",
    defaults: {
      fi_income_tax: { economic: 0, social: 0 }, // 1979: steep Nordic progressive schedule
      fi_corporate_tax: { economic: 0, social: 0 }, // 1979: standard rate, investment reserves shelter industry
      fi_sales_tax: { economic: 0, social: 0 }, // 1979: liikevaihtovero turnover tax; VAT only in 1994
      fi_social_charges: { economic: 0, social: 0 }, // 1979: KELA + TEL earnings-related pensions expanding
      fi_customs_tariff: { economic: 1, social: 0 }, // 1979: FINEFTA + 1973 EEC FTA — industrial tariffs falling; right
      fi_state_enterprises: { economic: -2, social: 0 }, // 1979: Valmet/Neste/Enso state-industrial core; left
      fi_labor_law: { economic: -1, social: 0 }, // 1979: comprehensive tulopolitiikka settlements
      fi_welfare_state: { economic: -1, social: 0 }, // 1979: Nordic welfare state still building out
    },
    optionIndexes: {
      fi_income_tax: 3,
      fi_corporate_tax: 3,
      fi_sales_tax: 2,
      fi_social_charges: 1,
      fi_customs_tariff: 0,
      fi_state_enterprises: 2,
      fi_labor_law: 2,
      fi_welfare_state: 2,
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above.
      fi_health_insurance: 3,
      fi_education_funding: 3,
      fi_infrastructure_investment: 3,
      fi_defense_appropriations: 2,
      fi_economic_subsidies: 3,
      fi_local_grants: 3,
    },
    regions: fiRegions,
  },

  tr: {
    nationalStateId: "tr_national",
    defaults: {
      tr_income_tax: { economic: 0, social: 0 },
      tr_corporate_tax: { economic: 0, social: 0 },
      tr_sales_tax: { economic: 0, social: 0 },
      tr_social_charges: { economic: 0, social: 0 },
      tr_customs_tariff: { economic: -1, social: 0 }, // heavy import-substitution protection
      tr_state_enterprises: { economic: -2, social: 0 }, // KİT étatism
      tr_labor_law: { economic: -1, social: 0 },
      tr_welfare_state: { economic: -1, social: 0 },
    },
    optionIndexes: {
      tr_income_tax: 3, // Gelir Vergisi Statute
      tr_corporate_tax: 3, // Kurumlar Vergisi Statute
      tr_sales_tax: 2, // Production Tax Schedule
      tr_social_charges: 1, // SSK Contribution Statute
      tr_customs_tariff: 2, // Import-Substitution Act (heavy protection)
      tr_state_enterprises: 2, // KİT Étatism Law
      tr_labor_law: 2, // Labor Code Statute
      tr_welfare_state: 2, // Social Provision Statute
      // Spending-category defaults (1979): nearest-fit index on the 1953 ladder
      // (fiscal-scale audit follow-up, 2026-07-28) — see FR block above.
      tr_health_insurance: 1,
      tr_education_funding: 1,
      tr_infrastructure_investment: 0,
      tr_defense_appropriations: 0,
      tr_economic_subsidies: 3,
      tr_local_grants: 3,
    },
    regions: trRegions,
  },

  // ── East Germany (1979 GDR — SED planned economy; defaults on the state end) ─
  dd: {
    nationalStateId: "dd_national",
    defaults: {
      dd_enterprise_levy: { economic: -3, social: 0 },
      dd_income_tax: { economic: 0, social: 0 },
      dd_product_tax: { economic: 0, social: 0 },
      dd_social_insurance: { economic: 0, social: 0 },
      dd_foreign_trade: { economic: -3, social: 0 },
      dd_economic_system: { economic: -4, social: 0 },
      dd_political_system: { economic: 0, social: 3 }, // SED leading role
      dd_price_controls: { economic: -3, social: 0 },
      dd_civil_liberties: { economic: 0, social: 3 }, // Stasi security state
      dd_housing: { economic: -2, social: 0 },
    },
    optionIndexes: {
      dd_enterprise_levy: 3, // VEB Surplus Remittance Statute
      dd_income_tax: 1, // Citizens' Income Tax Statute
      dd_product_tax: 2, // Product Tax Schedule
      dd_social_insurance: 1, // Unified Social Insurance Statute
      dd_foreign_trade: 2, // Foreign Trade Monopoly Statute
      dd_economic_system: 3, // Economic Order Law (orthodox plan)
      dd_political_system: 3, // Leading Role Statute (SED monopoly)
      dd_price_controls: 2, // Price Regulation Statute
      dd_civil_liberties: 2, // State Security Statute
      dd_housing: 2, // Housing Allocation Statute
    },
    regions: ddRegions,
  },

  // ── Hungary (1979 — MSZMP "goulash communism"; shared Eastern-bloc set) ──────
  hu: {
    nationalStateId: "hu_national",
    defaults: easternBlocPolicyConfig("hu").defaults,
    optionIndexes: easternBlocPolicyConfig("hu").optionIndexes,
    regions: huRegions,
  },

  // ── Batch-A Eastern-bloc one-party states (shared planned-economy set) ───────
  pl: {
    nationalStateId: "pl_national",
    defaults: easternBlocPolicyConfig("pl").defaults,
    optionIndexes: easternBlocPolicyConfig("pl").optionIndexes,
    regions: plRegions,
  },
  ro: {
    nationalStateId: "ro_national",
    defaults: easternBlocPolicyConfig("ro").defaults,
    optionIndexes: easternBlocPolicyConfig("ro").optionIndexes,
    regions: roRegions,
  },
  yu: {
    nationalStateId: "yu_national",
    defaults: easternBlocPolicyConfig("yu").defaults,
    optionIndexes: easternBlocPolicyConfig("yu").optionIndexes,
    regions: yuRegions,
  },
  bg: {
    nationalStateId: "bg_national",
    defaults: easternBlocPolicyConfig("bg").defaults,
    optionIndexes: easternBlocPolicyConfig("bg").optionIndexes,
    regions: bgRegions,
  },
  blr: {
    nationalStateId: "blr_national",
    defaults: easternBlocPolicyConfig("blr").defaults,
    optionIndexes: easternBlocPolicyConfig("blr").optionIndexes,
    regions: blrRegions,
  },
  ukr: {
    nationalStateId: "ukr_national",
    defaults: easternBlocPolicyConfig("ukr").defaults,
    optionIndexes: easternBlocPolicyConfig("ukr").optionIndexes,
    regions: uaRegions,
  },
  cs: {
    nationalStateId: "cs_national",
    defaults: easternBlocPolicyConfig("cs").defaults,
    optionIndexes: easternBlocPolicyConfig("cs").optionIndexes,
    regions: csRegions,
  },
  bal: {
    nationalStateId: "bal_national",
    defaults: easternBlocPolicyConfig("bal").defaults,
    optionIndexes: easternBlocPolicyConfig("bal").optionIndexes,
    regions: balRegions,
  },
};

// ── Backward-compatible re-exports for budgets.ts and other consumers ────────
export const NATIONAL_DEFAULTS = COUNTRY_POLICY_CONFIGS.us.defaults;
export const UK_NATIONAL_DEFAULTS = COUNTRY_POLICY_CONFIGS.uk.defaults;
export const NATIONAL_DEFAULT_OPTION_INDEXES = COUNTRY_POLICY_CONFIGS.us.optionIndexes;
export const UK_NATIONAL_DEFAULT_OPTION_INDEXES = COUNTRY_POLICY_CONFIGS.uk.optionIndexes;

// ═════════════════════════════════════════════════════════════════════════════
//  State-level policy derivation
// ═════════════════════════════════════════════════════════════════════════════

function clampScore(n: number): number {
  return Math.max(-3, Math.min(3, Math.round(n)));
}

/** State base: from politicalLean (-4..+5). Types with strong social dimension use social axis; else economic. */
function stateDefault(
  legislationTypeId: string,
  politicalLean: number
): { economic: number; social: number } {
  const score = clampScore(politicalLean * 0.6);
  if (
    legislationTypeId === "us_law_enforcement_criminal_justice" ||
    legislationTypeId === "us_reproductive_rights" ||
    legislationTypeId === "us_gun_control"
  ) {
    return { economic: 0, social: score };
  }
  if (
    legislationTypeId === "us_school_standards" ||
    legislationTypeId === "us_housing" ||
    legislationTypeId === "us_state_housing"
  ) {
    return { economic: score, social: score };
  }
  return { economic: score, social: 0 };
}

// ═════════════════════════════════════════════════════════════════════════════
//  Build base policy records for all countries
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the full `BasePolicyRecord[]` set from a country-config map.
 *
 * Originally read `COUNTRY_POLICY_CONFIGS` directly; parameterised in
 * Phase 5 so a preset-specific config (e.g. `COUNTRY_POLICY_CONFIGS_1991`)
 * can be passed in instead. The output shape and semantics are unchanged —
 * national + regional records per country, regional records derived from
 * `getStateLean` × `stateDefault` for non-tax types.
 *
 * Callers: `getBasePolicies(preset)` selects the right config map.
 */
function buildBasePolicies(
  configs: Record<string, CountryPolicyConfig> = COUNTRY_POLICY_CONFIGS,
  /**
   * Preset starting year. When provided, applies the era policy vacuum: types
   * whose window postdates this year seed NO default policy (an old-era world
   * boots empty for domains that do not exist yet). Undefined ⇒ no vacuum
   * (byte-identical legacy — the module-level `basePolicies` export).
   */
  startYear?: number
): BasePolicyRecord[] {
  const now = new Date();
  const out: BasePolicyRecord[] = [];

  for (const [countryScope, config] of Object.entries(configs)) {
    // Filter legislation types for this country
    // US also picks up types with undefined countryScope (legacy)
    const countryTypes = legislationTypes.filter(
      (lt) =>
        lt.countryScope === countryScope || (countryScope === "us" && lt.countryScope === undefined)
    );

    // National records (exclude state-only types)
    for (const lt of countryTypes) {
      if (lt.allowedScope === "state") continue;
      // Policy vacuum (preset-keyed): skip domains that do not exist yet.
      if (startYear !== undefined && !isLegislationTypeActive(lt._id, startYear)) continue;

      const d = config.defaults[lt._id] ?? { economic: 0, social: 0 };
      const overrideIdx = config.optionIndexes[lt._id];
      const optIndex = overrideIdx ?? 3;
      const option = lt.policyOptions?.[optIndex];
      out.push({
        scope: "national",
        stateId: config.nationalStateId,
        legislationTypeId: lt._id,
        economic: d.economic,
        social: d.social,
        policyOptionId: option?.id,
        policyOptionIndex: option ? optIndex : undefined,
        effectDirection: option?.effectDirection ?? 0,
        updatedAt: now,
      });
    }

    // Regional records — for types scoped to state level.
    // US/UK use allowedScope: "state". JP uses effectTarget.scope/taxRateChange.scope.
    const regionalTypes = countryTypes.filter(
      (lt) =>
        lt.allowedScope === "state" ||
        (countryScope === "jp" &&
          !lt.nationalOnly &&
          (lt.effectTarget?.scope === "state" || lt.taxRateChange?.scope === "state"))
    );

    for (const region of config.regions) {
      for (const lt of regionalTypes) {
        // Policy vacuum (preset-keyed): skip state domains that do not exist yet.
        if (startYear !== undefined && !isLegislationTypeActive(lt._id, startYear)) continue;
        const centerIndex = Math.floor((lt.policyOptions?.length ?? 0) / 2);
        const centerOption = lt.policyOptions?.[centerIndex];
        const d =
          lt.policyDomain === "tax"
            ? { economic: 0, social: 0 }
            : stateDefault(lt._id, getStateLean(region));
        out.push({
          scope: "state",
          stateId: region._id,
          legislationTypeId: lt._id,
          economic: d.economic,
          social: d.social,
          policyOptionId: centerOption?.id,
          policyOptionIndex: centerIndex,
          effectDirection: centerOption?.effectDirection ?? 0,
          updatedAt: now,
        });
      }
    }
  }

  return out;
}

export const basePolicies = buildBasePolicies(COUNTRY_POLICY_CONFIGS);
export default basePolicies;

/**
 * Preset-aware accessor. `2019-default` (and any unknown / "empty" /
 * "no-parties" variant) returns the canonical `basePolicies` array.
 * `1991-default` returns a parallel array built from
 * `COUNTRY_POLICY_CONFIGS_1991`.
 *
 * Used by `seedStatePolicies` on bootstrap + reset so a 1991 game starts
 * with era-correct policy positions (Bush-era US, Major-era UK, Kaifu-era
 * JP, Kohl-era DE, Haughey-era IE, post-Tiananmen CN) rather than the
 * Jan 2020 snapshot baked into `basePolicies`.
 */
export async function getBasePolicies(preset: string): Promise<BasePolicyRecord[]> {
  if (preset === "1953-default") {
    const { COUNTRY_POLICY_CONFIGS_1953 } = await import("./basePolicies1953");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1953, 1953);
  }
  if (preset === "1979-default") {
    const { COUNTRY_POLICY_CONFIGS_1979 } = await import("./basePolicies1979");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1979, 1979);
  }
  if (preset === "1991-default") {
    const { COUNTRY_POLICY_CONFIGS_1991 } = await import("./basePolicies1991");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1991, 1991);
  }
  if (preset === "1999-default") {
    const { COUNTRY_POLICY_CONFIGS_1999 } = await import("./basePolicies1999");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_1999, 1999);
  }
  if (preset === "2007-default") {
    const { COUNTRY_POLICY_CONFIGS_2007 } = await import("./basePolicies2007");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2007, 2007);
  }
  if (preset === "2023-default") {
    const { COUNTRY_POLICY_CONFIGS_2023 } = await import("./basePolicies2023");
    return buildBasePolicies(COUNTRY_POLICY_CONFIGS_2023, 2023);
  }
  // Default ("2019-default" and any unknown / empty / no-parties variant): vacuum
  // at 2019 so a modern world doesn't seed a domain that opens after it (e.g.
  // cn_common_prosperity 2021). The raw `basePolicies` export stays un-vacuumed
  // for any lower-level consumer; the seeding path always comes through here.
  return buildBasePolicies(COUNTRY_POLICY_CONFIGS, 2019);
}
