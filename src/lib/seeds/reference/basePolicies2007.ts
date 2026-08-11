/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data (e.g. the 2019/2023 COUNTRY_POLICY_CONFIGS). All
 * values are authored for 2007 directly. Same-era imports (states2007) and
 * type-only imports are allowed.
 */

/**
 * US national + regional base policy positions for the 2007-default preset
 * (mid-2007 / 110th Congress). Calibrated to real-world 2007 policy:
 *
 *   US — George W. Bush administration, 110th Congress (Democratic House AND
 *     Senate after the 2006 midterms — divided government, Bush vetoes).
 *     Defining 2007 anchors vs the 2019/2023 baselines:
 *       - Iraq "surge" (Jan 2007) + Afghanistan → record war-era defense outlays
 *       - Bush tax cuts (EGTRRA 2001 / JGTRRA 2003) in force; 35% statutory
 *         corporate rate (pre-TCJA) → corporate optionIndex higher than 2019/23
 *       - Medicare Part D (2006) with the *non-interference clause* — Medicare
 *         is statutorily BARRED from negotiating drug prices (right)
 *       - Pre-ACA: market-based healthcare, no Medicaid expansion, DRA-2005 cuts
 *       - Energy Policy Act 2005 (fossil/nuclear favoring); Kyoto rejected; EISA
 *         2007 (Dec) raised CAFE but clean-energy posture is right of 2019/23
 *       - Fair Minimum Wage Act 2007: first federal min-wage rise since 1997
 *         (phasing $5.85→$7.25) — a leftward move, but level still low
 *       - Roe v. Wade INTACT (Gonzales v. Carhart, Apr 2007, upheld the
 *         partial-birth ban but left Roe standing) — federal abortion protection
 *         still exists, unlike the post-Dobbs 2023 seed
 *       - Pre-Heller (2008): assault-weapons ban expired 2004, permissive guns
 *       - Honest Leadership & Open Government Act 2007 (post-Abramoff ethics
 *         reform by the new Democratic majority)
 *       - Housing bubble cresting/cracking; no federal stimulus yet (the
 *         Economic Stimulus Act is Feb 2008, after this snapshot)
 *
 * Tax `optionIndexes` reflect the pre-TCJA rate regime (corporate 35%).
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states2007 } from "./states2007";

export const COUNTRY_POLICY_CONFIGS_2007: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — G.W. Bush administration, mid-2007 (110th Congress)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: 0, social: 0 }, // 2007: NCLB (2002) raised the federal role but funding flat under Bush; center
      us_federal_science_funding: { economic: 0, social: 0 }, // 2007: America COMPETES Act (Aug 2007) boosted R&D bipartisanly; center
      us_school_standards: { economic: 0, social: 1 }, // 2007: NCLB high-stakes testing / accountability regime at its peak (traditional-standards lean)
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 1, social: 0 }, // 2007: pre-ACA, market-based; Bush vetoed SCHIP expansion twice — right
      us_drug_pricing_medicare: { economic: 1, social: 0 }, // 2007: Medicare Part D non-interference clause BARS price negotiation — right
      us_public_health: { economic: 0, social: 0 }, // 2007: post-9/11 biodefense build-out but otherwise modest; center
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 2, social: 0 }, // 2007: Kyoto rejected, Energy Policy Act 2005 favors fossil/nuclear; strongest right anchor of the era
      us_conservation: { economic: 1, social: 0 }, // 2007: Bush-era drilling/leasing emphasis over new conservation — right
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: 0, social: 0 }, // 2007: Bush tax cuts in force (level in optionIndex)
      us_federal_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // 2007: 35% statutory (level in optionIndex)
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity below domestic; pre-GILTI worldwide-with-deferral
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // 2007: 15.3% combined SS + Medicare (unchanged across eras)
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline: tariffs start at 0%
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // 2007: no federal sales tax (unchanged)
      us_federal_spending_stimulus: { economic: 1, social: 0 }, // Mid-2007: pre-crisis, no stimulus yet (ESA is Feb 2008); fiscal-restraint posture — right
      us_transportation: { economic: 0, social: 0 }, // 2007: SAFETEA-LU (2005) highway program active; center
      us_broadband_energy: { economic: 1, social: 0 }, // 2007: market-led broadband, minimal federal build-out — right
      us_minimum_wage: { economic: 1, social: 0 }, // 2007: Fair Minimum Wage Act just raised it (first since 1997), but level still low — mildly right
      us_workforce_development: { economic: 0, social: 0 }, // 2007: WIA-era programs, modest; center
      us_housing: { economic: 1, social: 0 }, // 2007: bubble cresting under a deregulated, market-led posture — right
      us_food_nutrition: { economic: 0, social: 0 }, // 2007: Food Stamp Program standard benefits; center
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // 2007: Bush's 2005 privatization push had failed; status quo
      us_medicaid: { economic: 1, social: 0 }, // 2007: Deficit Reduction Act 2005 trimmed Medicaid; pre-expansion — right
      us_medicaid_expansion: { economic: 1, social: 0 }, // 2007: no ACA, no expansion pathway — right
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: -1 }, // 2007: tough-on-crime, post-9/11 enforcement emphasis (order lean)
      us_prison_rehabilitation: { economic: 0, social: 0 }, // 2007: incarceration near historical peak; Second Chance Act is 2008 — center
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: 2, social: 0 }, // 2007: Iraq surge + Afghanistan; war-era outlays peak — strong right
      us_foreign_policy: { economic: 0, social: 1 }, // 2007: Bush-doctrine unilateral interventionism / "war on terror" — interventionist lean
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 1, social: 1 }, // 2007: Secure Fence Act (2006), heightened enforcement amid the CIR debate
      us_legal_immigration_visas: { economic: 0, social: 1 }, // 2007: comprehensive immigration reform (McCain-Kennedy) collapsed June 2007; restrictive status quo
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: 1 }, // 2007: Roe INTACT; Gonzales v. Carhart upheld the partial-birth ban — conservative but federal protection still stands (less right than post-Dobbs 2023)
      us_paid_family_leave: { economic: 0, social: 0 }, // 2007: FMLA (unpaid) only; no paid-leave movement; center
      us_gun_control: { economic: 0, social: 1 }, // 2007: pre-Heller, assault-weapons ban expired 2004, permissive — right
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: -1 }, // 2007: Honest Leadership & Open Government Act (post-Abramoff reform by the new Dem majority) — left
      us_civics_voting_rights: { economic: 0, social: 0 }, // 2007: voter-ID expansion debates both directions; center
      us_media_communications: { economic: 0, social: 0 }, // 2007: FCC media-ownership relaxation under Martin; center
      us_emergency_services: { economic: 0, social: 0 }, // 2007: post-Katrina FEMA reform (PKEMRA 2006) rebuilding capacity; center
    },
    optionIndexes: {
      us_federal_income_tax_rate: 4, // ~20% effective revenue knob (individual income tax ≈ 7.9% of GDP in 2007); matches the cross-era calibration
      us_federal_domestic_corporate_tax_rate: 8, // 35% statutory pre-TCJA (same regime as the 1991 seed's 34%)
      us_federal_foreign_corporate_tax_rate: 6, // Day-one parity below domestic, proportional to the higher pre-TCJA domestic rate
      us_federal_payroll_tax_rate: 5, // 15% — SS + Medicare, identical across eras
      us_federal_tariff_rate: 0, // 0% game baseline (all tariffs start at zero on reset)
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax
      us_social_security: 5,
    },
    regions: states2007,
  },
};
