/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data (e.g. the 2019 COUNTRY_POLICY_CONFIGS). All values are
 * authored for 2023 directly. Changing the 2019 (or any other) seed must never
 * alter 2023. Same-era imports (states2023) and type-only imports are allowed.
 */

/**
 * US national + regional base policy positions for the 2023-default preset
 * (Jan 2023 / 118th Congress). Calibrated to real-world Jan 2023 policy:
 *
 *   US — Biden administration, 118th Congress (Republican House, Democrat Senate).
 *     Key 2023 deltas vs 2019 (Trump):
 *       - IRA (Inflation Reduction Act, Aug 2022): major clean-energy investment
 *         → us_clean_energy economic shifts left (more spending / less fossil-only)
 *       - Dobbs v. Jackson (Jun 2022): Roe overturned → no federal abortion protection;
 *         conservative framing at national level (state-level divergence via stateDefault)
 *       - TCJA rates still in effect: income, corporate, payroll option indexes unchanged
 *       - ARP (American Rescue Plan, Mar 2021): expanded Child Tax Credit (expired),
 *         boosted food assistance temporarily
 *       - CHIPS Act (Aug 2022): major semiconductor/broadband/infra investment
 *       - Infrastructure Investment and Jobs Act (Nov 2021): bipartisan infra boost
 *       - Student-loan-relief executive actions (blocked by courts Jan 2023)
 *       - Border security: Title 42 ongoing through Jan 2023, elevated enforcement
 *       - No federal minimum wage increase (still $7.25, stalled in Senate)
 *       - Gun: Bipartisan Safer Communities Act signed Jun 2022 (first gun law in 30y)
 *       - Defense: $858B National Defense Authorization Act FY2023 (record)
 *
 * Tax `optionIndexes` unchanged from 2019 (TCJA rates in force throughout 2023).
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states2023 } from "./states2023";

export const COUNTRY_POLICY_CONFIGS_2023: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Biden administration, January 2023 (118th Congress)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: -1, social: 0 }, // Jan 2023: Biden FY2023 budget proposed +$13.6B for Education; actual spending flat after sequestration, but direction clearly left vs 2019 DeVos-era cuts
      us_federal_science_funding: { economic: -1, social: 0 }, // Jan 2023: CHIPS Act (Aug 2022) added $52B for semiconductor R&D; NSF funded at record levels; meaningful leftward shift
      us_school_standards: { economic: 0, social: 0 }, // Jan 2023: no major federal shift; Every Student Succeeds Act framework unchanged
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: -1, social: 0 }, // Jan 2023: ARP expanded ACA subsidies (extended by IRA through 2025); CMS expanding Medicaid access — clearly more spending vs 2019
      us_drug_pricing_medicare: { economic: -1, social: 0 }, // Jan 2023: IRA (Aug 2022) authorized Medicare drug-price negotiation for first time — historic leftward shift
      us_public_health: { economic: -1, social: 0 }, // Jan 2023: COVID-era CDC/NIH investment; Biden restored CDC authority
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: -2, social: 0 }, // Jan 2023: IRA (Aug 2022) = $369B clean-energy investment; rejoin Paris Agreement; EPA regulations restored — strongest 2023 delta
      us_conservation: { economic: -1, social: 0 }, // Jan 2023: Biden "30×30" conservation executive order; restored national monuments Trump had reduced
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: 0, social: 0 }, // Jan 2023: TCJA rates still in effect
      us_federal_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // Jan 2023: 21% TCJA corporate rate unchanged (IRA 15% alt-minimum enacted but primary rate 21%)
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity with domestic; TCJA GILTI still in effect
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // Jan 2023: standard 15.3% combined SS + Medicare unchanged
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline: tariffs start at 0%; Biden largely kept Trump-era China tariffs but game baseline unchanged
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // Jan 2023: no federal sales tax (unchanged)
      us_federal_spending_stimulus: { economic: -1, social: 0 }, // Jan 2023: ARP ($1.9T, 2021) and IIJA ($1.2T, 2021) both active spending — clear left vs 2019 austerity posture
      us_transportation: { economic: -1, social: 0 }, // Jan 2023: IIJA (Nov 2021) = $550B new transport investment (roads, bridges, rail, transit) — major bipartisan infra push
      us_broadband_energy: { economic: -1, social: 0 }, // Jan 2023: IIJA includes $65B broadband + CHIPS Act semiconductor investment; clear federal expansion
      us_minimum_wage: { economic: 2, social: 0 }, // Jan 2023: still $7.25 (frozen since 2009); Biden proposed $15 federally but blocked in Senate; status quo = right-of-center
      us_workforce_development: { economic: -1, social: 0 }, // Jan 2023: CHIPS Act workforce provisions; expanded apprenticeship programs under DOL
      us_housing: { economic: 0, social: 0 }, // Jan 2023: HUD active under Fudge; supply-side housing exec actions proposed but limited impact — center
      us_food_nutrition: { economic: 0, social: 0 }, // Jan 2023: SNAP temporary boosted (pandemic P-EBT), normal benefit levels restored Jan 2023; roughly center vs 2019
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // Jan 2023: no major changes; bipartisan commitment to no cuts
      us_medicaid: { economic: -1, social: 0 }, // Jan 2023: ARP maintained expanded Medicaid; Biden opposing work requirements; left vs 2019 Trump push
      us_medicaid_expansion: { economic: -1, social: 0 }, // Jan 2023: ARP incentivized remaining holdout states to expand; federal match rate boosted
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: -1 }, // Jan 2023: Biden pushed "fund the police" after 2020 BLM backlash; signed PLCAA; reform rhetoric but law enforcement investment up
      us_prison_rehabilitation: { economic: 0, social: 0 }, // Jan 2023: First Step Act (2018) still operating; modest Biden DOJ reform efforts; bipartisan center
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: 1, social: 0 }, // Jan 2023: $858B NDAA FY2023 — record defense budget, 10% YoY increase (right of center)
      us_foreign_policy: { economic: 0, social: 0 }, // Jan 2023: multilateral engagement (rejoined WHO, Paris); Ukraine aid ($50B+ in 2022); NATO reinvigoration — center-left
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 1, social: 1 }, // Jan 2023: Title 42 still active; record-high SW border encounters; Biden expanded Title 42 in Dec 2022; DHS enforcement ongoing
      us_legal_immigration_visas: { economic: 0, social: 0 }, // Jan 2023: Biden reversed Muslim ban, expanded H-1B; but legal immigration backlog unchanged; roughly center
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: 2 }, // Jan 2023: post-Dobbs (Jun 2022) Roe overturned; no federal protection; Biden's abortion-rights exec orders limited; national conservative position locked in
      us_paid_family_leave: { economic: 0, social: 0 }, // Jan 2023: Biden proposed 4-week national paid leave (Build Back Better) but stalled; no change to status quo
      us_gun_control: { economic: 0, social: -1 }, // Jan 2023: Bipartisan Safer Communities Act (Jun 2022) — first federal gun law in ~30y (enhanced background checks, red flag funding); mild leftward shift from 2019
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: -1 }, // Jan 2023: Biden signed EO restoring ethics pledges, lobbying bans; left vs 2019
      us_civics_voting_rights: { economic: 0, social: -1 }, // Jan 2023: Biden pushed Freedom to Vote Act (stalled); EO expanding ballot access; left vs 2019 restrictive trend
      us_media_communications: { economic: 0, social: 0 }, // Jan 2023: FCC evenly split, net neutrality effort stalled; center
      us_emergency_services: { economic: -1, social: 0 }, // Jan 2023: FEMA budget expanded; major disaster declarations up; active disaster response posture
    },
    optionIndexes: {
      us_federal_income_tax_rate: 4, // 20% — TCJA effective rates unchanged in Jan 2023
      us_federal_domestic_corporate_tax_rate: 5, // 20% — TCJA 21% statutory rate still primary (IRA corporate AMT is supplemental)
      us_federal_foreign_corporate_tax_rate: 3, // 18% — GILTI/TCJA foreign treatment; closest option to domestic day-one parity
      us_federal_payroll_tax_rate: 5, // 15% — 15.3% combined SS + Medicare (unchanged from 2019)
      us_federal_tariff_rate: 0, // 0% — game baseline starts all tariffs at zero on reset
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax (unchanged)
      us_social_security: 5,
    },
    regions: states2023,
  },
};
