/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's COUNTRY_POLICY_CONFIGS. All values are authored for 1999
 * directly. Same-era imports (states1999) and type-only imports are allowed.
 */

/**
 * US national + regional base policy positions for the 1999-default preset
 * (late-1999 / 106th Congress). Calibrated to real-world 1999 policy:
 *
 *   US — Clinton 2nd term, 106th Congress (Republican House under Hastert +
 *     Republican Senate; New Democrat triangulation). Defining 1999 anchors:
 *       - Budget SURPLUS (Balanced Budget Act 1997); "save Social Security
 *         first" — bipartisan fiscal restraint, debt paydown
 *       - Welfare reform (PRWORA 1996): work requirements, food-stamp cuts — a
 *         rightward safety-net move under a Democratic president
 *       - NAFTA (1994) / WTO (1995) / PNTR debate — New Democrat free trade
 *       - Gramm-Leach-Bliley (Nov 1999) repealed Glass-Steagall — financial
 *         DEREGULATION; Telecom Act 1996 deregulation
 *       - Federal Assault Weapons Ban (1994–2004) IN EFFECT + Brady Bill — the
 *         high-water mark of federal gun control (LEFT of every later era)
 *       - Roe INTACT; Clinton vetoed partial-birth bans (pro-choice federal posture)
 *       - DOMA (1996) + Don't Ask Don't Tell — same-sex marriage federally barred
 *       - Post-Cold-War defense drawdown — the "peace dividend" (defense share low)
 *       - H-1B cap raised (ACWIA 1998) for the tech boom; NVRA "Motor Voter" (1993)
 *       - 1993 OBRA top marginal rate 39.6% (higher than the later Bush-cut era)
 *
 * Tax `optionIndexes` reflect the post-OBRA-1993 / pre-Bush-cut rate regime.
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states1999 } from "./states1999";

export const COUNTRY_POLICY_CONFIGS_1999: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Clinton administration, late 1999 (106th Congress)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: -1, social: 0 }, // 1999: Clinton class-size/100k-teachers push, federal investment up — left
      us_federal_science_funding: { economic: -1, social: 0 }, // 1999: NIH doubling underway (1998–2003); strong federal R&D — left
      us_school_standards: { economic: 0, social: 0 }, // 1999: Goals 2000 standards-based reform, pre-NCLB; center
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 0, social: 0 }, // 1999: post-HillaryCare failure; SCHIP (1997) modest expansion — center
      us_drug_pricing_medicare: { economic: 0, social: 0 }, // 1999: no Medicare drug benefit yet (Part D is 2003); center
      us_public_health: { economic: 0, social: 0 }, // 1999: standard CDC/NIH posture; center
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 1, social: 0 }, // 1999: Kyoto signed (1998) but unratified; coal/gas economy, little clean-energy action — mildly right in practice
      us_conservation: { economic: -1, social: 0 }, // 1999: Clinton's national-monument designations (Antiquities Act) — left
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: 0, social: 0 }, // 1999: OBRA-1993 rates in force (level in optionIndex)
      us_federal_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // 1999: 35% statutory (level in optionIndex)
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity below domestic; worldwide-with-deferral
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // 1999: 15.3% combined SS + Medicare (unchanged)
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline: tariffs start at 0% (and the NAFTA/WTO era is low-tariff)
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // 1999: no federal sales tax (unchanged)
      us_federal_spending_stimulus: { economic: 1, social: 0 }, // 1999: surplus / balanced-budget restraint, debt paydown — right
      us_transportation: { economic: 0, social: 0 }, // 1999: TEA-21 (1998) highway program; center
      us_broadband_energy: { economic: 0, social: 0 }, // 1999: E-rate (1996) school connectivity, but broadband barely exists; center
      us_minimum_wage: { economic: 0, social: 0 }, // 1999: raised to $5.15 in 1996–97; recently increased — center
      us_workforce_development: { economic: 0, social: 0 }, // 1999: Workforce Investment Act (1998); center
      us_housing: { economic: 0, social: 0 }, // 1999: market-led, pre-bubble; center
      us_food_nutrition: { economic: 1, social: 0 }, // 1999: PRWORA food-stamp restrictions — right
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // 1999: "save Social Security first" — protect, no cuts; center
      us_medicaid: { economic: 0, social: 0 }, // 1999: welfare reform delinked Medicaid from cash welfare; SCHIP added — center
      us_medicaid_expansion: { economic: 0, social: 0 }, // 1999: SCHIP modest expansion; center
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: -1 }, // 1999: 1994 Crime Bill / COPS 100k-officers, tough-on-crime peak (order lean)
      us_prison_rehabilitation: { economic: 0, social: 0 }, // 1999: mass-incarceration era, minimal rehab emphasis; center
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: -1, social: 0 }, // 1999: post-Cold-War "peace dividend" — defense share at its modern low (left)
      us_foreign_policy: { economic: 0, social: 0 }, // 1999: Clinton multilateralism, Kosovo intervention, NATO expansion; center
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 0, social: 0 }, // 1999: IIRIRA-1996 enforcement baseline; moderate salience — center
      us_legal_immigration_visas: { economic: -1, social: 0 }, // 1999: ACWIA (1998) raised H-1B caps for the tech boom — pro-legal-immigration (left)
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: -1 }, // 1999: Roe intact; Clinton vetoed partial-birth bans — pro-choice federal posture (left)
      us_paid_family_leave: { economic: 0, social: 0 }, // 1999: FMLA (1993, unpaid); no paid leave; center
      us_gun_control: { economic: 0, social: -1 }, // 1999: Assault Weapons Ban + Brady Bill in force — federal gun-control high-water mark (left)
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: 0 }, // 1999: post-impeachment, mixed; center
      us_civics_voting_rights: { economic: 0, social: -1 }, // 1999: NVRA "Motor Voter" (1993) expanded registration access — left
      us_media_communications: { economic: 1, social: 0 }, // 1999: Telecom Act 1996 deregulation / media-ownership loosening — right
      us_emergency_services: { economic: 0, social: 0 }, // 1999: standard FEMA posture (Witt-era reform); center
    },
    optionIndexes: {
      us_federal_income_tax_rate: 5, // higher than the Bush-cut era: OBRA-1993 top rate 39.6%; individual income tax peaked ≈10% of GDP at the 2000 surplus
      us_federal_domestic_corporate_tax_rate: 8, // 35% statutory pre-TCJA
      us_federal_foreign_corporate_tax_rate: 6, // Day-one parity below domestic, proportional to the higher pre-TCJA domestic rate
      us_federal_payroll_tax_rate: 5, // 15% — SS + Medicare, identical across eras
      us_federal_tariff_rate: 0, // 0% game baseline
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax
      us_social_security: 5,
    },
    regions: states1999,
  },
};
