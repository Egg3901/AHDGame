/**
 * 1991-era base policy positions per country. Mirrors the SHAPE of
 * `COUNTRY_POLICY_CONFIGS` in `basePolicies.ts` exactly — same
 * legislation-type keys, same `{ economic, social }` scoring scale
 * (-3 left/lib … +3 right/trad), same `optionIndexes` map — but
 * calibrated to real-world January 1991 policy:
 *
 *   US — Bush admin (Sr.), post-1990 OBRA budget deal, Desert Storm,
 *     ADA just signed (Jul 1990), Clean Air Act amendments (Nov 1990),
 *     Immigration Act 1990, ISTEA 1991, FLSA min-wage step to $4.25.
 *     Tax shape: 31% top bracket (1990 OBRA), 34% corporate (1986 TRA),
 *     SS+Medicare 15.3% (rate identical to 2020 — schedule reached its
 *     modern level in 1990). Tariffs intentionally start at 0% — same
 *     game-baseline convention as the 2019 preset.
 *
 *   UK — Major (Nov 1990 - …). Council Tax announced (replacing Poll
 *     Tax), ERM membership (Oct 1990) pinning rates high, NHS internal
 *     market reforms (Working for Patients) in flight. Tax shape: 25%
 *     basic income tax, 17.5% VAT (Mar 1991 budget), 33-35% corporation
 *     tax. Tariffs 0% (game baseline).
 *
 *   JP — Kaifu cabinet (Nov 1989 - Nov 1991, then Miyazawa). Bubble peak
 *     just past (Nikkei -39% in 1990), heavy LDP fiscal expansion
 *     reflex still active. Article 9 not on the agenda. Consumption
 *     tax introduced Apr 1989 at 3%, social insurance ~12% combined.
 *     Pre-Womenomics, pre-Specified-Skilled-Worker visa, pre-Society-5.0.
 *
 *   DE — Kohl, first all-German Bundestag (Dec 1990). Aufbau Ost in
 *     full swing. Solidaritätszuschlag introduced FY1991. Pre-Maastricht.
 *     Tax shape: ~53% top income (pre-1990 reform brackets), 50/56%
 *     corporate (Körperschaftsteuer was 36% retained / 50% distributed),
 *     14% VAT (pre-1993 Mehrwertsteuer step). Schuldenbremse doesn't
 *     exist; pension stable; Kita coverage low in the new Länder.
 *
 *   IE — Haughey FF/PD coalition through Feb 1992, then Reynolds. Pre-
 *     Celtic-Tiger, Robinson is Uachtarán (Dec 1990). PRSI floor raised
 *     in 1991 budget; corporate tax was 40% (the 12.5% IDA rate didn't
 *     arrive until 2003). VAT 21%, income 27%/48% bracket structure.
 *
 *   CN — Post-Tiananmen tightening, pre-1992 Southern Tour. Reform
 *     paused; SOEs dominant; pre-WTO; no internet governance regime
 *     yet. Common-prosperity / Belt-and-Road / social-credit are
 *     anachronistic — positions sit at the most-statist option indexes
 *     to reflect the era's planned-economy posture.
 *
 *   BR — empty stub; matches the 2019 stub (BR is 1991-only and its
 *     policy positions aren't budgeted for at the `basePolicies` level).
 *
 *   FR/IT/ES/SE/TR — NPP-tier democracies seeded in 1991 worlds (see
 *     seedCountryGameStates PRESET_ENABLEMENT). Blocks follow the same
 *     8-lever structure as their 1979/2019 configs, era-adjusted to Jan
 *     1991: Mitterrand "ni-ni" FR, pre-Tangentopoli deficit-era IT,
 *     González-expansion ES, post-tax-reform pre-crisis SE, Özal-era TR.
 *
 * Consumed by `getBasePolicies("1991-default")` in `basePolicies.ts`,
 * which feeds `seedStatePolicies` on bootstrap + reset when the active
 * preset is `1991-default`.
 *
 * Source notes for tax `optionIndexes` shifts vs the 2019 baseline:
 *   - US income 4→2 (effective ≈ 9-10% per capita in 1991 vs ≈ 18% by
 *     2019 — both well below top statutory; the game's flat-rate model
 *     follows effective).
 *   - US corporate 5→8 (34% statutory vs 21% TCJA-era).
 *   - UK income 5→6 (25% basic in 1991 vs 20% in 2020).
 *   - UK VAT 5→4 (17.5% in 1991 vs 20% in 2020 — VAT was raised in
 *     2011, not lowered, so 1991 sits below 2020).
 *   - UK domestic corp 4→8 (33-35% in 1991 vs 19% in 2020).
 *   - JP consumption 5→1 (3% in 1991 vs 10% in 2020 — introduced Apr
 *     1989, raised to 5% in 1997).
 *   - JP income 5→7 (75% top in 1991 vs 25% effective in 2020 — the
 *     game's flat model still tracks effective; pick something
 *     materially above the 2020 baseline to reflect the bubble-era
 *     heavy load).
 *   - DE income 5→7 (53% top statutory pre-1990 reform).
 *   - DE soli 5→3 (introduced FY1991 at 7.5% temporarily then 5.5%
 *     statutory; pick mid-range).
 *   - DE VAT 5→3 (14% in 1991 vs 19% in 2020).
 *   - DE corp 5→9 (50% distributed-profit Körperschaftsteuer rate).
 *   - IE corp 3→9 (40% standard, pre-IDA-12.5%).
 *   - IE VAT 6→6 (23% in 2024 vs 21% in 1991 — close enough; one step
 *     down).
 *   - IE income 7→6 (48% top in 1991 vs 40% in 2024 — both above the
 *     mid-range; tighter clustering than corp).
 *   - CN individual 7→0 (small taxable population in 1991 — the
 *     individual income tax wasn't broadly enforced until the 1994
 *     reform).
 *   - CN VAT 5→0 (introduced 1994 — pre-VAT 1991 used a turnover tax).
 *   - CN enterprise 5→9 (55% statutory pre-1994).
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states1991 } from "./states1991";
import { ukRegions1991 } from "@/lib/seeds/uk/ukRegions1991";
import { deRegions1991 } from "@/lib/seeds/de/deRegions1991";
import { jpRegions1991 } from "@/lib/seeds/jp/jpRegions1991";
import { cnRegions1991 } from "@/lib/seeds/cn/cnRegions1991";
import { ieRegions1991 } from "@/lib/seeds/ie/ieRegions1991";
// FR/IT/ES/SE/TR have no dedicated 1991 region bundles — the 1991 preset seeds
// their modern region files via the selectPresetBundle 2019-default fallback
// (see seedFR.ts etc.), so the policy configs reference the same region arrays.
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";

export const COUNTRY_POLICY_CONFIGS_1991: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Bush Sr. administration, January 1991
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: 1, social: 0 }, // 1991: "Education President" rhetoric, flat funding, no major increases
      us_federal_science_funding: { economic: 0, social: 0 }, // 1991: bipartisan NIH/NSF support, steady growth
      us_school_standards: { economic: 0, social: 1 }, // 1991: America 2000 goals announced — accountability push
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 2, social: 0 }, // 1991: no major federal expansion; pre-HillaryCare debate
      us_drug_pricing_medicare: { economic: 1, social: 0 }, // 1991: OBRA 1990 Medicaid drug rebates active
      us_public_health: { economic: 0, social: 0 }, // 1991: CDC neutral baseline; HIV/AIDS funding climbing
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 0, social: 0 }, // 1991: Clean Air Act 1990 amendments just signed — bipartisan
      us_conservation: { economic: -1, social: 0 }, // 1991: Bush "no net loss" wetlands policy
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: 0, social: 0 }, // 1991: OBRA 1990 raised top bracket to 31% — recent change
      us_federal_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // 1991: 34% from 1986 TRA, stable
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity with domestic
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // 1991: 15.3% combined (12.4% SS + 2.9% Medicare) — same as 2020
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline: tariffs start at 0%
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // 1991: no federal sales tax (unchanged)
      us_federal_spending_stimulus: { economic: 1, social: 0 }, // 1991: Gramm-Rudman caps + Desert Storm supplemental constrain stimulus
      us_transportation: { economic: -1, social: 0 }, // 1991: ISTEA enacted Dec 1991 — major bipartisan infra
      us_broadband_energy: { economic: 0, social: 0 }, // 1991: no internet / broadband; placeholder neutral
      us_minimum_wage: { economic: 0, social: 0 }, // 1991: FLSA raised $3.80 → $4.25 in April 1991, recent change
      us_workforce_development: { economic: 0, social: 0 }, // 1991: JTPA + Carl Perkins active, status quo
      us_housing: { economic: 1, social: 0 }, // 1991: HUD Kemp + Cranston-Gonzalez Act 1990, modest tilt
      us_food_nutrition: { economic: 0, social: 0 }, // 1991: WIC + SNAP at established levels
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // 1991: post-1983 amendments, status quo
      us_medicaid: { economic: 0, social: 0 }, // 1991: OBRA 1990 mandated pregnancy/child expansions
      us_medicaid_expansion: { economic: -1, social: 0 }, // 1991: OBRA 1990 expansions of mandatory coverage
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: 1 }, // 1991: Bush 1991 crime bill push (failed), tough-on-crime peak
      us_prison_rehabilitation: { economic: 1, social: 1 }, // 1991: war-on-drugs peak, mass-incarceration ramp beginning
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: 1, social: 0 }, // 1991: $300B+ baseline + Desert Storm supplemental, peak Cold War spending
      us_foreign_policy: { economic: 0, social: 0 }, // 1991: "New World Order" multilateralism, Gulf coalition
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 1, social: 1 }, // 1991: IRCA 1986 sanctions in force, NAFTA negotiations underway
      us_legal_immigration_visas: { economic: 0, social: 0 }, // 1991: Immigration Act 1990 raised legal immigration (700k cap, diversity visa)
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: 1 }, // 1991: Mexico City gag in place, Casey decision 1992 pending (Roe still law)
      us_paid_family_leave: { economic: 1, social: 0 }, // 1991: no paid leave; even unpaid FMLA not passed until 1993 — market-reliant
      us_gun_control: { economic: 0, social: 0 }, // 1991: Brady Bill debated, not yet passed (1993)
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: 0 }, // 1991: post-Iran-Contra era, Office of Government Ethics established 1989
      us_civics_voting_rights: { economic: 0, social: 0 }, // 1991: Motor Voter Act being debated (NVRA 1993)
      us_media_communications: { economic: 0, social: 0 }, // 1991: FCC pre-1996 Telecom Act era, Fairness Doctrine recently repealed (1987)
      us_emergency_services: { economic: 0, social: 0 }, // 1991: FEMA + Stafford Act, status quo
    },
    optionIndexes: {
      us_federal_income_tax_rate: 4, // 20% — calibration knob, not statutory: revenue = taxableIncome(0.3537·GDP) × rate, so 20% yields ~7.1% of GDP, matching real 1991 individual income tax (~7.4% of GDP). The prior 10% produced only ~3.5% and left an implausible deficit.
      us_federal_domestic_corporate_tax_rate: 8, // 34% statutory pre-TCJA (vs 21% in 2020)
      us_federal_foreign_corporate_tax_rate: 6, // Day-one parity below domestic (proportional shift up from 2020's 3)
      us_federal_payroll_tax_rate: 5, // 15% — Social Security + Medicare rate identical to 2020
      us_federal_tariff_rate: 0, // 0% game baseline (all tariffs start at zero on reset)
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax (unchanged across eras)
      us_social_security: 5,
    },
    regions: states1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED KINGDOM — Major Conservative govt, January 1991
  // ═══════════════════════════════════════════════════════════════════════════
  uk: {
    nationalStateId: "uk_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      uk_nhs_funding: { economic: 0, social: 0 }, // 1991: NHS internal market (Working for Patients) just enacted, contested but not yet defunded
      uk_social_care: { economic: 1, social: 0 }, // 1991: NHS and Community Care Act 1990 shifting care to local authorities
      uk_mental_health: { economic: 0, social: 0 }, // 1991: care-in-the-community shift underway
      uk_public_health: { economic: 0, social: 0 }, // 1991: pre-NICE, pre-PHE
      // ── Education ──────────────────────────────────────────────────────────
      uk_tuition_fees: { economic: 0, social: 0 }, // 1991: no tuition fees yet (introduced 1998); university expansion underway
      uk_education_standards: { economic: 0, social: 1 }, // 1991: National Curriculum + GCSE-era standards push
      uk_education_funding: { economic: 1, social: 0 }, // 1991: tight Treasury control under Lamont
      uk_research_science: { economic: 0, social: 0 }, // 1991: Research Council reform underway
      // ── Economic ───────────────────────────────────────────────────────────
      uk_fiscal_spending: { economic: 1, social: 0 }, // 1991: ERM membership pins rates high — tight fiscal stance
      uk_local_government_funding: { economic: 0, social: 0 }, // 1991: Poll Tax → Council Tax transition (announced Mar 1991)
      // ── Infrastructure ─────────────────────────────────────────────────────
      uk_transport_rail: { economic: 0, social: 0 }, // 1991: BR pre-privatisation, modest investment
      uk_energy_grid: { economic: 1, social: 0 }, // 1991: post-1990 electricity privatisation, market-led
      // ── Environment ────────────────────────────────────────────────────────
      uk_climate_net_zero: { economic: 1, social: 0 }, // 1991: pre-Kyoto, pre-net-zero — no statutory climate target
      uk_north_sea_energy: { economic: 1, social: 0 }, // 1991: peak North Sea production, heavy licensing
      // ── Law & Justice ──────────────────────────────────────────────────────
      uk_policing_crime: { economic: 0, social: 1 }, // 1991: Criminal Justice Act 1991 — community sentences + tougher mandatory
      uk_prison_rehabilitation: { economic: 0, social: 0 }, // 1991: Woolf Report 1991 pushed reform, status quo
      // ── Defence ────────────────────────────────────────────────────────────
      uk_defence_spending: { economic: 1, social: 0 }, // 1991: Options for Change cuts underway, but Gulf War boosting short-term
      uk_trident_defence: { economic: 0, social: 0 }, // 1991: Trident programme on schedule, bipartisan
      // ── Foreign Policy ─────────────────────────────────────────────────────
      uk_foreign_policy: { economic: 0, social: 0 }, // 1991: Gulf coalition partner, EU integration debates ahead of Maastricht
      // ── Welfare ────────────────────────────────────────────────────────────
      uk_universal_credit: { economic: 0, social: 0 }, // 1991: UC didn't exist — predecessor income support / family credit
      uk_state_pensions: { economic: 0, social: 0 }, // 1991: SERPS reforms continuing; no triple lock
      uk_childcare: { economic: 1, social: 0 }, // 1991: minimal state childcare provision — market/family reliant
      // ── Immigration ────────────────────────────────────────────────────────
      uk_immigration_asylum: { economic: 0, social: 1 }, // 1991: Asylum Bill drafted, tighter controls
      uk_work_visas: { economic: 0, social: 0 }, // 1991: pre-EU-free-movement-cleanup, points system not yet
      // ── Labour ─────────────────────────────────────────────────────────────
      uk_workers_rights: { economic: 1, social: 0 }, // 1991: Thatcher-era trade union laws still active; opt-outs from EU Social Chapter
      uk_workforce_development: { economic: 0, social: 0 }, // 1991: Training and Enterprise Councils launched 1990
      // ── Housing ────────────────────────────────────────────────────────────
      uk_housing_planning: { economic: 1, social: 0 }, // 1991: Right to Buy ongoing, low social housing build
      uk_leasehold_reform: { economic: 0, social: 0 }, // 1991: Leasehold Reform Act 1993 pending
      // ── Governance ─────────────────────────────────────────────────────────
      uk_devolution_local_powers: { economic: 1, social: 0 }, // 1991: pre-devolution (1997-99); rate-capping era
      uk_government_ethics: { economic: 0, social: 0 }, // 1991: pre-Nolan principles (1995)
      uk_electoral_reform: { economic: 0, social: 0 }, // 1991: FPTP unchallenged
      // ── Media ──────────────────────────────────────────────────────────────
      uk_bbc_public_media: { economic: 0, social: 0 }, // 1991: licence fee stable; Broadcasting Act 1990 just enacted
      uk_digital_broadband: { economic: 0, social: 0 }, // 1991: no commercial internet yet
      // ── Civil Liberties ────────────────────────────────────────────────────
      uk_surveillance_privacy: { economic: 0, social: 1 }, // 1991: Security Service Act 1989 active
      uk_drug_policy: { economic: 0, social: 1 }, // 1991: Misuse of Drugs Act unchallenged, war-on-drugs aligned with US
    },
    optionIndexes: {
      uk_income_tax_rate: 6, // 25% basic in 1991 (vs 20% in 2020); option array indexed up
      uk_national_insurance: 4, // ~10% employee Class 1 in 1991 (vs 12% in 2020), slight step down
      uk_vat: 4, // 17.5% in 1991 (raised Mar 1991; vs 20% in 2020 — VAT was raised in 2011)
      uk_excise_customs: 0, // 0% game baseline (tariffs start at zero)
      uk_domestic_corporation_tax: 8, // 33-35% in 1991 (vs 19% in 2020)
      uk_foreign_corporation_tax: 7, // Day-one parity below domestic 8
      uk_nhs_funding: 3,
      uk_tuition_fees: 0, // No tuition fees in 1991 (introduced 1998); index 0 = lowest
      uk_state_pensions: 3,
      uk_fiscal_spending: 3,
    },
    regions: ukRegions1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  JAPAN — Kaifu cabinet, January 1991
  // ═══════════════════════════════════════════════════════════════════════════
  jp: {
    nationalStateId: "jp_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      jp_national_health_insurance: { economic: 0, social: 0 }, // 1991: universal coverage stable
      jp_elder_care: { economic: 1, social: 0 }, // 1991: pre-Long-Term-Care-Insurance (2000), family-based care assumption
      jp_mental_health: { economic: 0, social: 1 }, // 1991: stigma still high, modest awareness
      jp_public_health: { economic: 0, social: 0 }, // 1991: status quo
      // ── Education ──────────────────────────────────────────────────────────
      jp_education_funding: { economic: 0, social: 0 }, // 1991: stable
      jp_university_tuition: { economic: 1, social: 0 }, // 1991: no low-income tuition programme until 2020
      jp_academic_reform: { economic: 0, social: 0 }, // 1991: status quo
      jp_research_science: { economic: 0, social: 0 }, // 1991: pre-Society-5.0, modest growth
      // ── Defense & Security ─────────────────────────────────────────────────
      jp_article9_sdf: { economic: 0, social: 0 }, // 1991: post-Gulf-War Japan paid $13B but no SDF deployment; Article 9 not on Kaifu agenda
      jp_defense_spending: { economic: 1, social: 0 }, // 1991: 1% of GDP cap maintained; pre-Izumo
      jp_cybersecurity: { economic: 0, social: 0 }, // 1991: no cyber framework
      // ── Economic ───────────────────────────────────────────────────────────
      jp_fiscal_stimulus: { economic: -1, social: 0 }, // 1991: bubble-era expansion reflex still active; ¥30T+ stimulus pipeline
      jp_minimum_wage: { economic: 0, social: 0 }, // 1991: prefectural min wages low (~¥500/hr in Tokyo)
      jp_labor_reform: { economic: 0, social: 0 }, // 1991: pre-Work-Style-Reform (2018); permanent employment dominant
      jp_sme_support: { economic: -1, social: 0 }, // 1991: heavy SME subsidies for keiretsu networks
      jp_local_allocation_tax: { economic: 0, social: 0 }, // 1991: standard fiscal transfers
      // ── Infrastructure ─────────────────────────────────────────────────────
      jp_disaster_preparedness: { economic: 0, social: 0 }, // 1991: pre-Kobe (1995); standard preparedness
      jp_rail_transport: { economic: -1, social: 0 }, // 1991: Shinkansen extension to Yamagata (1992) underway
      jp_digital_infrastructure: { economic: 0, social: 0 }, // 1991: no commercial internet
      // ── Environment & Energy ───────────────────────────────────────────────
      jp_nuclear_energy: { economic: -1, social: 0 }, // 1991: heavy nuclear buildout pre-Fukushima
      jp_climate_emissions: { economic: 0, social: 0 }, // 1991: pre-Kyoto (1997)
      jp_renewable_energy: { economic: 1, social: 0 }, // 1991: minimal renewables, fossil-fuel + nuclear dominant
      // ── Social Policy ──────────────────────────────────────────────────────
      jp_family_policy: { economic: 1, social: 1 }, // 1991: traditional family model; pre-Womenomics
      jp_pension: { economic: 0, social: 0 }, // 1991: pensionable age 60 era, phased rise to 65 legislated 1994 — centrist baseline
      jp_gender_equality: { economic: 1, social: 1 }, // 1991: Equal Employment Opportunity Act 1985 in force, weak enforcement
      jp_work_culture_reform: { economic: 0, social: 0 }, // 1991: bubble-era overwork norm, no reform
      // ── Immigration ────────────────────────────────────────────────────────
      jp_foreign_worker_policy: { economic: 1, social: 2 }, // 1991: ICRRA Dec 1990 — closed doors to unskilled, exception for nikkeijin
      jp_visa_residency: { economic: 0, social: 1 }, // 1991: restrictive
      jp_integration_programs: { economic: 0, social: 0 }, // 1991: minimal
      // ── Agriculture ────────────────────────────────────────────────────────
      jp_agricultural_subsidies: { economic: -1, social: 0 }, // 1991: heavy rice subsidies, food-control system pre-1995-WTO
      jp_food_security: { economic: 0, social: 0 }, // 1991: status quo, autarky aspirational
      jp_rural_development: { economic: 0, social: 0 }, // 1991: pre-regional-revitalization
      // ── Governance ─────────────────────────────────────────────────────────
      jp_constitutional_reform: { economic: 0, social: 0 }, // 1991: not on Kaifu's agenda (he was reformist on electoral system, not the constitution)
      jp_regional_autonomy: { economic: 0, social: 0 }, // 1991: status quo
      jp_electoral_reform: { economic: 0, social: 0 }, // 1991: Kaifu's signature push (SNTV → SMD), introduced 1994
      // ── Foreign Policy / Trade ─────────────────────────────────────────────
      jp_foreign_aid_diplomacy: { economic: -1, social: 0 }, // 1991: Japan was the world's #1 ODA donor
      jp_trade_agreements: { economic: 1, social: 0 }, // 1991: pre-WTO (1995); US-Japan trade frictions peak
      // ── Technology ─────────────────────────────────────────────────────────
      jp_robotics_ai: { economic: 0, social: 0 }, // 1991: world-leading industrial robotics; AI early
      jp_rd_investment: { economic: -1, social: 0 }, // 1991: peak corporate R&D, bubble-era
      jp_digital_governance: { economic: 0, social: 0 }, // 1991: no digital government
      // ── Public Safety ──────────────────────────────────────────────────────
      jp_policing_public_safety: { economic: 0, social: 0 }, // 1991: very low crime rate, status quo
      jp_criminal_justice: { economic: 0, social: 1 }, // 1991: same hostage-justice norms
    },
    optionIndexes: {
      jp_income_tax_rate: 7, // 1991: top bracket 50%, effective per-capita higher than 2020 (post-bubble); index up from 2020's 5
      jp_domestic_corporation_tax: 8, // 1991: 37.5% basic + local = ~50% effective vs 23% in 2020
      jp_foreign_corporation_tax: 6, // 1991: same as domestic statutory; below-domestic parity option
      jp_social_insurance: 4, // 1991: ~12% combined (vs 15% in 2020); social insurance climbed with aging
      jp_consumption_tax: 1, // 3% in 1991 (introduced Apr 1989); raised to 5% in 1997, 8% in 2014, 10% in 2019
      jp_resident_tax: 5, // 10% in 1991 — stable across eras
      jp_fixed_asset_tax: 5, // 1.4% in 1991 — stable across eras
      jp_customs_tariff: 0, // 0% game baseline
    },
    regions: jpRegions1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  GERMANY — Kohl, first all-German Bundestag, January 1991
  // ═══════════════════════════════════════════════════════════════════════════
  de: {
    nationalStateId: "de_national",
    defaults: {
      // ── Tax (statutory baseline) ────────────────────────────────────────
      de_income_tax_rate: { economic: 0, social: 0 }, // 53% top pre-1990 reform brackets
      de_solidarity_surcharge: { economic: 0, social: 0 }, // Introduced FY1991 (Aufbau Ost financing)
      de_vat_rate: { economic: 0, social: 0 }, // 14% statutory (pre-1993 step to 15%)
      de_domestic_corporate_tax_rate: { economic: 0, social: 0 }, // 50% distributed / 36% retained (pre-2008 reform)
      de_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity with domestic
      de_payroll_social_insurance: { economic: 0, social: 0 }, // ~17% combined Beitragssatz in 1991 (lower than 2020's ~20%)
      de_customs_tariff_rate: { economic: 0, social: 0 }, // 0% game baseline
      de_trade_tax: { economic: 0, social: 0 }, // 380% Hebesatz typical mid-range
      // ── Existing non-tax ────────────────────────────────────────────────
      de_minimum_wage: { economic: 2, social: 0 }, // 1991: no statutory minimum wage (introduced 2015); collective bargaining dominant
      de_renewable_energy_target: { economic: 1, social: 0 }, // 1991: pre-Energiewende, coal + nuclear dominant
      de_immigration_policy: { economic: 0, social: 1 }, // 1991: asylum law amended 1993 (Asylkompromiss) pending
      // ── PR2 (Healthcare + Education + Social) ───────────────────────────
      de_health_insurance: { economic: 0, social: 0 }, // 1991: GKV stable, GSG 1992 (Seehofer reform) pending
      de_elder_care: { economic: 1, social: 0 }, // 1991: pre-Pflegeversicherung (1995)
      de_mental_health: { economic: 0, social: 0 }, // 1991: status quo
      de_public_health: { economic: 0, social: 0 }, // 1991: status quo
      de_education_funding: { economic: 0, social: 0 }, // 1991: Aufbau-Ost school investment (East), West stable
      de_university_tuition: { economic: 0, social: 0 }, // 1991: no tuition (statutory)
      de_academic_reform: { economic: 0, social: 0 }, // 1991: Hochschulrahmengesetz stable
      de_research_science: { economic: 0, social: 0 }, // 1991: heavy Aufbau-Ost research-infrastructure transfers
      de_pension_system: { economic: -1, social: 0 }, // 1991: pre-Riester (2001), post-Norbert-Blüm "die Rente ist sicher"
      de_family_policy: { economic: -1, social: 1 }, // 1991: Erziehungsgeld 1986 in force, traditional family model
      de_unemployment_welfare: { economic: 0, social: 0 }, // 1991: pre-Hartz (2005); BfA active
      de_gender_equality: { economic: 0, social: 0 }, // 1991: GG Art 3 baseline, FüPoG II is 2021
      // ── PR3 (Defense + Foreign + Tech + Public Safety) ──────────────────
      de_bundeswehr_funding: { economic: 1, social: 1 }, // 1991: post-reunification peace dividend; force reduction to 370k
      de_defense_posture: { economic: 0, social: 1 }, // 1991: post-Gulf-War debate on out-of-area deployments
      de_cybersecurity: { economic: 0, social: 0 }, // 1991: pre-internet, no cyber posture
      de_eu_integration: { economic: -1, social: 0 }, // 1991: Maastricht negotiations underway (Dec 1991); pro-integrationist
      de_foreign_aid_diplomacy: { economic: -1, social: 0 }, // 1991: heavy BMZ + Aufbau-Ost transfers
      de_trade_agreements: { economic: -1, social: 0 }, // 1991: GATT Uruguay Round championing
      de_robotics_ai: { economic: 0, social: 0 }, // 1991: industrial robotics established, AI early
      de_digital_governance: { economic: 0, social: 0 }, // 1991: no digital government
      de_policing_public_safety: { economic: 0, social: 0 }, // 1991: Länder police, status quo
      de_criminal_justice: { economic: 0, social: 0 }, // 1991: status quo
      de_constitutional_protection: { economic: 0, social: 1 }, // 1991: post-reunification BfV expansion to former GDR
      // ── PR4 (Economic + Infra + Env + Imm + Agri + Gov + Media) ─────────
      de_fiscal_stimulus_act: { economic: -1, social: 0 }, // 1991: heavy Aufbau-Ost deficit spending, pre-Schuldenbremse
      de_labor_reform: { economic: 0, social: 0 }, // 1991: status quo, pre-Hartz
      de_sme_mittelstand: { economic: -1, social: 0 }, // 1991: Treuhand restructuring of East-German SOEs
      de_rail_transport: { economic: -1, social: 0 }, // 1991: pre-Bahnreform (1994), unified DR + DB pending
      de_digital_infrastructure: { economic: 0, social: 0 }, // 1991: ISDN expansion, no commercial internet
      de_housing: { economic: -1, social: 0 }, // 1991: heavy Wohnungsbau, Aufbau-Ost
      de_nuclear_energy: { economic: 1, social: 0 }, // 1991: pre-Atomausstieg (decided 2001, accelerated 2011); pro-nuclear baseline
      de_carbon_pricing: { economic: 1, social: 0 }, // 1991: pre-BEHG (2021), no carbon pricing
      de_climate_targets: { economic: 1, social: 0 }, // 1991: pre-Kyoto, modest targets
      de_asylum_policy: { economic: 0, social: 1 }, // 1991: Asylkompromiss pending (1993), tightening trend
      de_integration_programs: { economic: 0, social: 0 }, // 1991: minimal
      de_agricultural_subsidies: { economic: -1, social: 0 }, // 1991: pre-MacSharry reform (1992), heavy CAP support
      de_food_security: { economic: 0, social: 0 }, // 1991: status quo
      de_animal_welfare: { economic: 0, social: 0 }, // 1991: Tierschutzgesetz 1972 baseline
      de_grundgesetz_reform: { economic: 0, social: 0 }, // 1991: post-reunification revisions
      de_electoral_reform: { economic: 0, social: 0 }, // 1991: 5% Sperrklausel debate after PDS entry
      de_government_ethics: { economic: 0, social: 0 }, // 1991: pre-Parteispendenaffäre fallout
      de_public_broadcasting: { economic: 0, social: 0 }, // 1991: ARD + ZDF + new private channels (RTL 1984)
      de_press_freedom: { economic: 0, social: 0 }, // 1991: GG Art 5 baseline
      // ── PR5 (Land-level) ────────────────────────────────────────────────
      de_land_education: { economic: -1, social: 0 }, // 1991: largest Land budget line, East-rebuilding investment
      de_land_police: { economic: 0, social: 0 }, // 1991: status quo
      de_land_culture: { economic: 0, social: 0 }, // 1991: status quo
      de_land_economic_development: { economic: -1, social: 0 }, // 1991: heavy Strukturpolitik, Aufbau-Ost
      de_land_health_services: { economic: 0, social: 0 }, // 1991: status quo
      de_land_municipal_grants: { economic: -1, social: 0 }, // 1991: Schlüsselzuweisungen up to support East
    },
    optionIndexes: {
      de_income_tax_rate: 7, // 53% top statutory pre-1990 reform (vs 42% in 2020)
      de_solidarity_surcharge: 3, // Introduced FY1991 — initial 7.5% temporary then 5.5%; pick mid-range
      de_vat_rate: 3, // 14% in 1991 (vs 19% in 2020)
      de_domestic_corporate_tax_rate: 9, // 50% distributed-profit Körperschaftsteuer
      de_foreign_corporate_tax_rate: 8, // Day-one parity slightly below domestic
      de_payroll_social_insurance: 4, // ~17% combined in 1991 (vs 20% in 2020)
      de_customs_tariff_rate: 0, // 0% game baseline
      de_trade_tax: 4, // 380% Hebesatz mid-range pre-reunification
      // Non-tax — keep at center options
      de_minimum_wage: 0, // No statutory minimum in 1991 — pick the lowest (0%) option
      de_renewable_energy_target: 0, // Pre-Energiewende, lowest target
      de_immigration_policy: 5, // Restrictive option index (placeholder; the 7-option array goes restrictive→permissive)
      de_gender_equality: 5, // Lower-engagement option (placeholder for PR2)
      de_fiscal_stimulus_act: 1, // Heavy spending — opposite end from Schwarze-Null (2020 was 4)
    },
    regions: deRegions1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  IRELAND — Haughey FF/PD coalition, January 1991
  // ═══════════════════════════════════════════════════════════════════════════
  ie: {
    nationalStateId: "ie_national",
    defaults: {
      // Tax — neutral baselines (option indexes carry the era difference)
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
      // Non-tax — 1991-era stances
      ie_housing_policy: { economic: 1, social: 0 }, // 1991: pre-Celtic-Tiger, low social-housing build
      ie_minimum_wage: { economic: 1, social: 0 }, // 1991: no statutory minimum (introduced 2000)
      ie_climate_policy: { economic: 1, social: 0 }, // 1991: pre-Kyoto, no climate framework
      ie_healthcare_policy: { economic: 0, social: 0 }, // 1991: pre-HSE (2005), two-tier system entrenched
      ie_public_health: { economic: 0, social: 0 }, // 1991: status quo
      ie_mental_health: { economic: 0, social: 1 }, // 1991: institutional model dominant
      ie_elder_care: { economic: 1, social: 1 }, // 1991: family + church care, low public funding
      ie_education_funding: { economic: 0, social: 0 }, // 1991: stable, Vocational + secondary
      ie_higher_education: { economic: 0, social: 0 }, // 1991: free fees from 1996, low subsidies in 1991
      ie_research_science: { economic: 0, social: 0 }, // 1991: pre-SFI (2003)
      ie_curriculum_reform: { economic: 0, social: 0 }, // 1991: status quo
      ie_state_pensions: { economic: 0, social: 0 }, // 1991: status quo
      ie_unemployment_benefits: { economic: 1, social: 0 }, // 1991: 14% unemployment, system under strain
      ie_working_family_payment: { economic: 0, social: 0 }, // 1991: precursor "Family Income Supplement"
      ie_parental_leave: { economic: 1, social: 1 }, // 1991: no statutory parental leave (introduced 1998)
      ie_childcare_policy: { economic: 1, social: 1 }, // 1991: family + church childcare, low public provision
      ie_gender_equality: { economic: 0, social: 1 }, // 1991: pre-divorce-referendum (1995), abortion-info ban active
      ie_drug_policy: { economic: 0, social: 1 }, // 1991: heroin epidemic in Dublin, criminalisation focus
      ie_workers_rights: { economic: 0, social: 0 }, // 1991: Social Partnership PNR active
      ie_workforce_development: { economic: 0, social: 0 }, // 1991: FÁS established 1987, active
      ie_sme_support: { economic: 0, social: 0 }, // 1991: IDA + Enterprise Ireland precursors
      ie_fiscal_stimulus: { economic: 1, social: 0 }, // 1991: post-1987 stabilisation programme, tight fiscal
      ie_transport_rail: { economic: 0, social: 0 }, // 1991: CIÉ + Iarnród Éireann, modest investment
      ie_digital_infrastructure: { economic: 0, social: 0 }, // 1991: pre-internet
      ie_regional_economic_development: { economic: -1, social: 0 }, // 1991: EU structural funds active
      ie_renewable_energy_target: { economic: 1, social: 0 }, // 1991: pre-renewables push
      ie_agricultural_subsidies: { economic: -1, social: 0 }, // 1991: pre-MacSharry CAP reform, heavy support
      ie_food_security: { economic: 0, social: 0 }, // 1991: status quo
      ie_rural_development: { economic: -1, social: 0 }, // 1991: pre-Celtic-Tiger urban migration, depopulation push
      ie_peat_bog_policy: { economic: -1, social: 0 }, // 1991: Bord na Móna at peak production
      ie_defence_spending: { economic: 1, social: 0 }, // 1991: UN-peacekeeping focus, lowest in OECD
      ie_neutrality_posture: { economic: 0, social: -1 }, // 1991: post-Cold-War neutrality reaffirmed; PfP joining 1999
      ie_foreign_aid_diplomacy: { economic: 0, social: 0 }, // 1991: Irish Aid programme stable
      ie_cybersecurity: { economic: 0, social: 0 }, // 1991: no cyber framework
      ie_garda_policing: { economic: 0, social: 1 }, // 1991: Troubles spillover, heavy border policing
      ie_criminal_justice: { economic: 0, social: 1 }, // 1991: 1991 Criminal Damage Act, status quo punitive
      ie_government_ethics: { economic: 0, social: 0 }, // 1991: pre-McCracken Tribunal (1997), GUBU era under Haughey
      ie_electoral_reform: { economic: 0, social: 0 }, // 1991: PR-STV stable
      ie_immigration_asylum: { economic: 0, social: 0 }, // 1991: net emigration, asylum negligible
      ie_work_visas: { economic: 0, social: 0 }, // 1991: status quo, emigration outflows
      ie_integration_programs: { economic: 0, social: 0 }, // 1991: minimal
      ie_regional_health: { economic: 0, social: 0 }, // Regional placeholder
      ie_regional_housing: { economic: 0, social: 0 }, // Regional placeholder
      ie_regional_transport: { economic: 0, social: 0 }, // Regional placeholder
      ie_regional_skills: { economic: 0, social: 0 }, // Regional placeholder
    },
    optionIndexes: {
      ie_corporate_tax_rate: 9, // 40% standard 1991 (vs 12.5% in 2024) — top of array
      ie_foreign_corporate_tax_rate: 8, // Day-one parity below domestic
      ie_income_tax_rate: 6, // 48% top in 1991 (vs 40% higher band in 2024)
      ie_usc: 0, // USC didn't exist in 1991 (introduced 2011) — 0% baseline
      ie_prsi: 4, // ~7.75% Class A in 1991 (vs 11% in 2024)
      ie_vat_rate: 5, // 21% in 1991 (vs 23% in 2024)
      ie_customs_tariff_rate: 0, // 0% game baseline
      ie_local_property_tax: 0, // LPT didn't exist in 1991 (introduced 2013) — 0% baseline
      ie_stamp_duty: 4, // 6% in 1991 (vs 2% averaged in 2024)
      ie_capital_gains_tax: 5, // 50% top in 1991 (vs 33% in 2024)
      ie_excise_duty: 4, // 100 baseline multiplier
      ie_minimum_wage: 0, // No statutory minimum in 1991 — index 0
      ie_housing_policy: 3,
      ie_climate_policy: 0, // No climate framework in 1991 — index 0
      ie_healthcare_policy: 3,
      ie_public_health: 3,
      ie_mental_health: 3,
      ie_elder_care: 3,
      ie_education_funding: 3,
      ie_higher_education: 3,
      ie_research_science: 3,
      ie_curriculum_reform: 3,
      ie_state_pensions: 3,
      ie_unemployment_benefits: 3,
      ie_working_family_payment: 3,
      ie_parental_leave: 0, // No statutory parental leave in 1991 — index 0
      ie_childcare_policy: 3,
      ie_gender_equality: 3,
      ie_drug_policy: 3,
      ie_workers_rights: 3,
      ie_workforce_development: 3,
      ie_sme_support: 3,
      ie_fiscal_stimulus: 3,
      ie_transport_rail: 3,
      ie_digital_infrastructure: 0, // Pre-internet in 1991 — index 0
      ie_regional_economic_development: 3,
      ie_renewable_energy_target: 0, // Pre-renewables in 1991 — index 0
      ie_agricultural_subsidies: 3,
      ie_food_security: 3,
      ie_rural_development: 3,
      ie_peat_bog_policy: 3,
      ie_defence_spending: 3,
      ie_neutrality_posture: 3,
      ie_foreign_aid_diplomacy: 3,
      ie_cybersecurity: 0, // No cyber framework in 1991 — index 0
      ie_garda_policing: 3,
      ie_criminal_justice: 3,
      ie_government_ethics: 3,
      ie_electoral_reform: 3,
      ie_immigration_asylum: 3,
      ie_work_visas: 3,
      ie_integration_programs: 3,
      ie_regional_health: 3,
      ie_regional_housing: 3,
      ie_regional_transport: 3,
      ie_regional_skills: 3,
    },
    regions: ieRegions1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  Brazil — empty stub (1991-only country, no policy positions seeded
  //  at this level; budgets feed via `NATIONAL_BUDGET_SEED_CONFIGS_1991`)
  // ═══════════════════════════════════════════════════════════════════════════
  br: {
    nationalStateId: "br_national",
    defaults: {},
    optionIndexes: {},
    regions: [],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  Nigeria — Babangera military transition era (1991 baseline)
  // ═══════════════════════════════════════════════════════════════════════════
  ng: {
    nationalStateId: "ng_national",
    defaults: {},
    optionIndexes: {},
    regions: [],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  China — Post-Tiananmen tightening, pre-1992 Southern Tour
  // ═══════════════════════════════════════════════════════════════════════════
  cn: {
    nationalStateId: "cn_national",
    defaults: {
      // Tax baselines (neutral; era difference is in optionIndexes)
      cn_enterprise_income_tax: { economic: 0, social: 0 },
      cn_individual_income_tax: { economic: 0, social: 0 },
      cn_value_added_tax: { economic: 0, social: 0 },
      cn_land_value_added_tax: { economic: 0, social: 0 },
      cn_urban_maintenance_construction_tax: { economic: 0, social: 0 },
      cn_stamp_duty: { economic: 0, social: 0 },
      cn_social_insurance_contribution: { economic: 0, social: 0 },
      cn_customs_tariff: { economic: 0, social: 0 },
      cn_provincial_resource_tax: { economic: 0, social: 0 },
      // Healthcare — 1991: pre-1997 reform, work-unit-based health
      cn_medical_insurance: { economic: -1, social: 1 },
      cn_elder_care: { economic: 0, social: 2 }, // Confucian filial-piety norms strongly held
      cn_mental_health: { economic: 0, social: 2 }, // High stigma, institutional model
      cn_public_health: { economic: 0, social: 1 },
      // Education
      cn_education_funding: { economic: -1, social: 1 }, // 1991: 9-year compulsory education law 1986, expansion
      cn_gaokao_reform: { economic: 0, social: 1 }, // 1991: gaokao restored 1977, status quo
      cn_academic_pressure_reform: { economic: 0, social: 1 }, // 1991: rote-learning model entrenched
      cn_research_science: { economic: -1, social: 1 }, // 1991: 863 Programme (1986) active
      // Social Policy
      cn_pension_system: { economic: -1, social: 1 }, // 1991: work-unit-based pensions
      cn_family_policy: { economic: 0, social: 2 }, // 1991: one-child policy strict
      cn_gender_equality: { economic: 0, social: 1 }, // 1991: 1992 Women's Rights Protection Law pending
      cn_common_prosperity: { economic: -1, social: 2 }, // 1991: pre-Xi (2021); high state-redistribution emphasis
      // Defense
      cn_pla_modernization: { economic: 0, social: 1 }, // 1991: post-Gulf-War PLA modernization debate
      cn_taiwan_strait_doctrine: { economic: 0, social: 2 }, // 1991: post-1979 peaceful reunification rhetoric + threat doctrine
      cn_cybersecurity: { economic: 0, social: 0 }, // 1991: no cyber framework
      // Foreign Policy
      cn_belt_and_road: { economic: 0, social: 0 }, // 1991: BRI is 2013 — placeholder
      cn_us_china_relations: { economic: 0, social: 2 }, // 1991: post-Tiananmen sanctions, MFN debate annual
      cn_un_security_council_posture: { economic: 0, social: 1 }, // 1991: cautious permanent-member posture
      // Technology
      cn_ai_strategy: { economic: 0, social: 0 }, // 1991: AI strategy is 2017 — placeholder
      cn_semiconductor_strategy: { economic: -1, social: 1 }, // 1991: 863 Programme microelectronics line
      // Public Safety
      cn_public_security: { economic: 0, social: 2 }, // 1991: post-1989 tightening, heavy public-security spending
      cn_criminal_justice: { economic: 0, social: 2 }, // 1991: "Strike Hard" campaigns
      cn_internet_governance: { economic: 0, social: 0 }, // 1991: no commercial internet
      // Economic
      cn_state_enterprises: { economic: -2, social: 1 }, // 1991: SOEs absolutely dominant, pre-1992 Southern Tour reforms
      cn_industrial_strategy: { economic: -1, social: 0 }, // 1991: 7th Five-Year Plan industrialisation
      cn_minimum_wage: { economic: -1, social: 0 }, // 1991: pre-1993 minimum wage regulation
      cn_fiscal_stimulus: { economic: 0, social: 0 }, // 1991: tight post-Tiananmen monetary policy
      // Infrastructure
      cn_rail_transport: { economic: -1, social: 0 }, // 1991: pre-high-speed-rail
      cn_digital_infrastructure: { economic: 0, social: 0 }, // 1991: no commercial internet
      cn_housing: { economic: -1, social: 1 }, // 1991: pre-1998 housing reform, work-unit-based housing
      // Environment & Energy
      cn_renewable_energy_target: { economic: 0, social: 0 }, // 1991: pre-renewables, coal dominant
      cn_nuclear_energy: { economic: -1, social: 0 }, // 1991: first commercial plant 1991 (Daya Bay), early
      cn_emissions_trading_scheme: { economic: 0, social: 0 }, // 1991: no ETS
      cn_climate_targets: { economic: 0, social: 0 }, // 1991: pre-Kyoto
      // Immigration & Hukou
      cn_hukou_reform: { economic: 1, social: -1 }, // 1991: hukou strict — rural→urban mobility tightly controlled
      cn_skilled_immigration: { economic: 0, social: 1 }, // 1991: pre-skilled-immigration regime
      cn_diaspora_engagement: { economic: 0, social: 1 }, // 1991: diaspora outreach via Qiaowu Office
      // Agriculture
      cn_agricultural_subsidies: { economic: -1, social: 0 }, // 1991: household-responsibility-system support
      cn_food_security: { economic: 0, social: 1 }, // 1991: state-grain-procurement core priority
      cn_rural_revitalization: { economic: -1, social: 1 }, // 1991: pre-revitalization label; township-enterprise era
      // Governance
      cn_anticorruption_campaign: { economic: 0, social: 1 }, // 1991: pre-Xi (2012), CCDI baseline
      cn_npc_reform: { economic: 0, social: 1 }, // 1991: status quo, no reform
      cn_hk_macao_affairs: { economic: 0, social: 1 }, // 1991: pre-1997 handover, Basic Law (1990) framework
      // Media
      cn_state_media_funding: { economic: -1, social: 2 }, // 1991: heavy CCTV/Xinhua state media investment
      cn_press_freedom: { economic: 0, social: 2 }, // 1991: post-1989 tightening, intense censorship
      // Provincial
      cn_provincial_education: { economic: -1, social: 0 },
      cn_provincial_public_security: { economic: 0, social: 2 }, // Post-1989 tightening
      cn_provincial_economic_development: { economic: -1, social: 0 },
      cn_provincial_health_services: { economic: -1, social: 0 },
      cn_provincial_culture_propaganda: { economic: 0, social: 2 }, // Heavy CCP cultural management
      cn_provincial_environmental_policy: { economic: 0, social: 0 }, // 1991: minimal
      cn_provincial_infrastructure_investment: { economic: -1, social: 0 },
    },
    optionIndexes: {
      cn_enterprise_income_tax: 9, // 55% standard pre-1994 tax reform (vs 25% in 2020)
      cn_individual_income_tax: 0, // Pre-1994 reform: tiny taxable population, near-0% effective
      cn_value_added_tax: 9, // 22% — calibration knob (not literal VAT, which began 1994): the consumption-tax line proxies 1991 China's combined turnover taxes (product + business tax), its largest revenue source. At 22% × the 0.5 taxableSales base it raises ~11% of GDP. A higher-than-statutory rate stands in for the broad cascading turnover base via a single line.
      cn_land_value_added_tax: 0, // Pre-1994 reform — 0%
      cn_urban_maintenance_construction_tax: 5, // Stable
      cn_stamp_duty: 5, // Stable
      cn_social_insurance_contribution: 0, // Pre-1997 unified system; SOE work-unit covered most workers
      cn_customs_tariff: 0, // 0% game baseline
      cn_provincial_resource_tax: 5, // Stable
      // Healthcare — center
      cn_medical_insurance: 3,
      cn_elder_care: 3,
      cn_mental_health: 3,
      cn_public_health: 3,
      // Education — center
      cn_education_funding: 3,
      cn_gaokao_reform: 3,
      cn_academic_pressure_reform: 3,
      cn_research_science: 3,
      // Social — center
      cn_pension_system: 3,
      cn_family_policy: 5, // Strict one-child policy in 1991 — pick a more restrictive option index
      cn_gender_equality: 3,
      cn_common_prosperity: 3,
      // Defense — center
      cn_pla_modernization: 3,
      cn_taiwan_strait_doctrine: 3,
      cn_cybersecurity: 0, // Pre-cyber-framework
      // Foreign — center
      cn_belt_and_road: 0, // BRI 2013 — pre-BRI baseline
      cn_us_china_relations: 3,
      cn_un_security_council_posture: 3,
      // Tech
      cn_ai_strategy: 0, // Pre-AI-strategy (2017)
      cn_semiconductor_strategy: 3,
      // Public Safety
      cn_public_security: 5, // Post-Tiananmen tightening — more authoritarian option
      cn_criminal_justice: 5, // Strike Hard campaigns
      cn_internet_governance: 0, // Pre-internet
      // Economic
      cn_state_enterprises: 5, // Heavily SOE-dominant
      cn_industrial_strategy: 3,
      cn_minimum_wage: 0, // Pre-1993 minimum wage
      cn_fiscal_stimulus: 3,
      // Infrastructure
      cn_rail_transport: 3,
      cn_digital_infrastructure: 0, // Pre-internet
      cn_housing: 3,
      // Environment
      cn_renewable_energy_target: 0,
      cn_nuclear_energy: 3,
      cn_emissions_trading_scheme: 0, // No ETS
      cn_climate_targets: 0, // Pre-Kyoto
      // Immigration & Hukou
      cn_hukou_reform: 5, // Strict hukou in 1991 — restrictive option
      cn_skilled_immigration: 3,
      cn_diaspora_engagement: 3,
      // Agriculture
      cn_agricultural_subsidies: 3,
      cn_food_security: 3,
      cn_rural_revitalization: 3,
      // Governance
      cn_anticorruption_campaign: 3,
      cn_npc_reform: 3,
      cn_hk_macao_affairs: 3,
      // Media
      cn_state_media_funding: 3,
      cn_press_freedom: 5, // Post-Tiananmen restrictive
      // Provincial — center
      cn_provincial_education: 3,
      cn_provincial_public_security: 3,
      cn_provincial_economic_development: 3,
      cn_provincial_health_services: 3,
      cn_provincial_culture_propaganda: 3,
      cn_provincial_environmental_policy: 3,
      cn_provincial_infrastructure_investment: 3,
    },
    regions: cnRegions1991,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  FRANCE — Mitterrand presidency, Rocard government, January 1991
  //  Post-1988 re-election "ni-ni" doctrine (no new nationalisations, no
  //  privatisations); franc fort disinflation succeeded (~3.2% inflation);
  //  RMI (1988) added to a mature Sécurité sociale; CSG introduced Feb 1991.
  //  Tax shape: TVA standard 18.6%, IS cut 50%→34% across 1986-91, very high
  //  cotisations sociales.
  // ═══════════════════════════════════════════════════════════════════════════
  fr: {
    nationalStateId: "fr_national",
    defaults: {
      fr_income_tax: { economic: 0, social: 0 }, // 1991: progressive IR, top ~56.8%; low yield by design (CSG just created to broaden the base)
      fr_corporate_tax: { economic: 0, social: 0 }, // 1991: IS cut to 34% (from 50% in 1985) — Bérégovoy competitiveness line
      fr_vat: { economic: 0, social: 0 }, // 1991: TVA standard 18.6%, mature system
      fr_social_charges: { economic: -1, social: 0 }, // 1991: very high cotisations funding the Sécu; left
      fr_customs_tariff: { economic: 0, social: 0 }, // 1991: EC common external tariff, single market ramping to 1993
      fr_nationalization: { economic: -1, social: 0 }, // 1991: 1982 nationalisations partly reversed 1986-88, then frozen by "ni-ni"; state sector still large
      fr_labor_law: { economic: -1, social: 0 }, // 1991: Code du Travail + 1982 Auroux laws in force
      fr_welfare_state: { economic: -1, social: 0 }, // 1991: mature Sécu + RMI (1988), but "rigueur" cost discipline since 1983
    },
    optionIndexes: {
      fr_income_tax: 3, // 45% — standard progressive schedule (top statutory 56.8% in 1991, effective far lower)
      fr_corporate_tax: 2, // 30% — closest to the 34% IS rate reached in 1991 (1979 preset sits at 4 = 60%)
      fr_vat: 2, // 18% ≈ the 18.6% 1991 standard TVA rate
      fr_social_charges: 2, // 38% — very high cotisations (employer+employee ~40% of wages by 1991)
      fr_customs_tariff: 1, // 8% — EC CET proxy (same index as the 1979/2019 presets)
      fr_nationalization: 3, // Partial-nationalisation statute — post-1982 state sector held under the "ni-ni" freeze
      fr_labor_law: 2, // Code du Travail Statute
      fr_welfare_state: 2, // Sécurité Sociale Statute (mature, cost-constrained — below the 1979 expansion index)
    },
    regions: frRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ITALY — Andreotti VII (DC-PSI pentapartito), January 1991
  //  Pre-Tangentopoli First Republic at its fiscal worst: deficit ~10% of GDP,
  //  debt ~100% of GDP, interest bill ~11% of GDP; IRI/ENI state holdings still
  //  intact (privatisations start 1992-93); scala mobile being wound down.
  //  Tax shape: IRPEG 36%, IVA standard 19%, very high INPS contributions.
  // ═══════════════════════════════════════════════════════════════════════════
  it: {
    nationalStateId: "it_national",
    defaults: {
      it_income_tax: { economic: -1, social: 0 }, // 1991: IRPEF progressive, top 50%; high pressure to chase the deficit
      it_corporate_tax: { economic: 0, social: 0 }, // 1991: IRPEG 36% (+ILOR); center-high
      it_vat: { economic: 0, social: 0 }, // 1991: IVA standard 19%
      it_social_charges: { economic: -1, social: 0 }, // 1991: INPS contributions among Europe's highest
      it_customs_tariff: { economic: 0, social: 0 }, // 1991: EC CET
      it_state_holdings: { economic: -2, social: 0 }, // 1991: IRI/ENI/EFIM still huge; EFIM collapse + privatisation wave is 1992+
      it_labor_law: { economic: -2, social: 0 }, // 1991: Statuto dei Lavoratori intact; scala mobile phase-out agreed 1992
      it_welfare_state: { economic: -2, social: 0 }, // 1991: pension generosity at its pre-Amato-reform (1992) peak
    },
    optionIndexes: {
      it_income_tax: 3, // 45% — IRPEF top 50% in 1991
      it_corporate_tax: 3, // 36% — the exact 1991 IRPEG rate
      it_vat: 3, // 22% ≈ the 19% 1991 standard IVA rate (nearest option)
      it_social_charges: 2, // 40% — very high INPS employer+employee load
      it_customs_tariff: 1, // 8% — EC CET proxy
      it_state_holdings: 2, // Partecipazioni Statali Law — still pre-privatisation
      it_labor_law: 2, // Statuto dei Lavoratori Statute
      it_welfare_state: 2, // Stato Sociale Statute (pension-heavy baseline)
    },
    regions: itRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SPAIN — González III (PSOE majority), January 1991
  //  EC member since 1986; post-Franco welfare state expanding fast (universal
  //  healthcare 1989, non-contributory pensions 1990); Seville Expo + Barcelona
  //  Olympics + AVE infrastructure buildout for 1992; INI restructuring but
  //  pre-privatisation. Tax shape: IRPF top 56%, Sociedades 35%, IVA 12%.
  // ═══════════════════════════════════════════════════════════════════════════
  es: {
    nationalStateId: "es_national",
    defaults: {
      es_income_tax: { economic: -1, social: 0 }, // 1991: IRPF matured into the main revenue pillar; top 56%
      es_corporate_tax: { economic: 0, social: 0 }, // 1991: Impuesto de Sociedades 35%
      es_consumption_tax: { economic: 0, social: 0 }, // 1991: IVA (introduced 1986 with EC entry) standard 12%
      es_social_charges: { economic: -1, social: 0 }, // 1991: high Seguridad Social contributions funding the expansion
      es_customs_tariff: { economic: 0, social: 0 }, // 1991: EC CET replaced the old protectionist schedule in 1986
      es_state_holdings: { economic: -1, social: 0 }, // 1991: INI still large (Teneo reorg 1992; privatisations mid-90s)
      es_labor_law: { economic: -1, social: 0 }, // 1991: Estatuto de los Trabajadores + strong UGT/CCOO (1988 general strike won concessions)
      es_welfare_state: { economic: -2, social: 0 }, // 1991: post-Franco welfare state at peak expansion under González
    },
    optionIndexes: {
      es_income_tax: 3, // 44% — IRPF top 56% statutory, effective well below
      es_corporate_tax: 3, // 35% — the exact 1991 Sociedades rate
      es_consumption_tax: 2, // 9% ≈ the 12% 1991 standard IVA rate (nearest option)
      es_social_charges: 2, // 38% — high cotizaciones sociales
      es_customs_tariff: 1, // 12% — EC CET proxy (down from the 1979 preset's protectionist 2)
      es_state_holdings: 2, // Patrimonio del Estado Law — INI intact, pre-privatisation
      es_labor_law: 2, // Estatuto de los Trabajadores Statute
      es_welfare_state: 3, // Universal Welfare Expansion — the González buildout (healthcare 1989, pensions 1990)
    },
    regions: esRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SWEDEN — Carlsson SAP government, January 1991 (Bildt wins Sept 1991)
  //  The "tax reform of the century" (1990/91) just cut top marginal rates from
  //  ~80% to ~50% and corporate tax to 30%, paid for by broadening VAT to 25%.
  //  Folkhem welfare state still at its apex; wage-earner funds (1984) exist
  //  and are abolished by Bildt in Dec 1991; financial crisis beginning.
  // ═══════════════════════════════════════════════════════════════════════════
  se: {
    nationalStateId: "se_national",
    defaults: {
      se_income_tax: { economic: -1, social: 0 }, // 1991: post-reform top ~50% (30% local + 20% state) — down from the 1979 apex
      se_corporate_tax: { economic: 0, social: 0 }, // 1991: reform cut the corporate rate to 30%
      se_vat: { economic: -1, social: 0 }, // 1991: Moms raised/broadened to 25% to fund the income-tax cuts
      se_social_charges: { economic: -2, social: 0 }, // 1991: arbetsgivaravgifter ~38-39% — still the system's backbone
      se_customs_tariff: { economic: 0, social: 0 }, // 1991: EFTA member, EEA negotiations underway
      se_wage_earner_funds: { economic: -1, social: 0 }, // 1991: the (capped) löntagarfonder of 1984 still exist; abolished Dec 1991
      se_labor_law: { economic: -2, social: 0 }, // 1991: MBL codetermination + ~80% union density
      se_welfare_state: { economic: -2, social: 0 }, // 1991: folkhem apex — the 1990s retrenchment hasn't hit yet
    },
    optionIndexes: {
      se_income_tax: 2, // 45% ≈ post-1991-reform top ~50% (the 1979 preset's 6 = 85% pre-reform apex)
      se_corporate_tax: 2, // 35% ≈ the 30% post-reform corporate rate
      se_vat: 3, // 28% ≈ the 25% 1991 Moms rate
      se_social_charges: 1, // 33% ≈ ~38% employer fees (index 2 = 45% overshoots)
      se_customs_tariff: 1, // 6% — EFTA-era low external tariff
      se_wage_earner_funds: 3, // Wage-Earner Funds (Partial) — the capped 1984 funds, pre-abolition
      se_labor_law: 2, // Medbestämmandelagen Statute
      se_welfare_state: 2, // Folkhemmet Statute
    },
    regions: seRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TURKEY — Akbulut ANAP government, Özal presidency, January 1991
  //  Post-1980 Özal liberalisation: import-substitution dismantled, KDV (VAT)
  //  introduced 1985, capital account opened 1989 — but the KİT state-enterprise
  //  sector is still dominant, inflation runs ~60-66%, and the Gulf War is an
  //  immediate economic shock. Demirel (DYP) wins the October 1991 election.
  // ═══════════════════════════════════════════════════════════════════════════
  gr: {
    nationalStateId: "gr_national",
    defaults: {
      gr_income_tax: { economic: 0, social: 0 }, // 1991: post-stabilisation schedule
      gr_corporate_tax: { economic: 0, social: 0 }, // 1991: rate converging on EEC norms
      gr_sales_tax: { economic: 0, social: 0 }, // 1991: VAT (1987) standard 18% game-mapped
      gr_social_charges: { economic: 0, social: 0 }, // 1991: IKA contributions heavy
      gr_customs_tariff: { economic: -1, social: 0 }, // 1991: EEC member — external tariff gone
      gr_state_enterprises: { economic: -1, social: 0 }, // 1991: Mitsotakis privatisation drive begins; still large
      gr_labor_law: { economic: 0, social: 0 }, // 1991: labor law contested
      gr_welfare_state: { economic: 0, social: 0 }, // 1991: welfare heavy post-PASOK decade
    },
    optionIndexes: {
      gr_income_tax: 3,
      gr_corporate_tax: 3,
      gr_sales_tax: 2,
      gr_social_charges: 2,
      gr_customs_tariff: 1,
      gr_state_enterprises: 2,
      gr_labor_law: 2,
      gr_welfare_state: 2,
    },
    regions: grRegions,
  },

  at: {
    nationalStateId: "at_national",
    defaults: {
      at_income_tax: { economic: 0, social: 0 }, // 1991: post-1988 reform schedule (top 50%)
      at_corporate_tax: { economic: 0, social: 0 }, // 1991: 30% post-reform Körperschaftsteuer
      at_sales_tax: { economic: 0, social: 0 }, // 1991: VAT standard 20%
      at_social_charges: { economic: 0, social: 0 }, // 1991: ASVG contributions heavy
      at_customs_tariff: { economic: 1, social: 0 }, // 1991: EEA/EU accession path — free trade
      at_state_enterprises: { economic: -1, social: 0 }, // 1991: post-1986 VOEST crisis; ÖIAG partial privatisations begin
      at_labor_law: { economic: -1, social: 0 }, // 1991: Sozialpartnerschaft intact
      at_welfare_state: { economic: -1, social: 0 }, // 1991: mature welfare state
    },
    optionIndexes: {
      at_income_tax: 2,
      at_corporate_tax: 2,
      at_sales_tax: 2,
      at_social_charges: 1,
      at_customs_tariff: 0,
      at_state_enterprises: 2,
      at_labor_law: 2,
      at_welfare_state: 2,
    },
    regions: atRegions,
  },

  fi: {
    nationalStateId: "fi_national",
    defaults: {
      fi_income_tax: { economic: 0, social: 0 }, // 1991: pre-crisis schedule
      fi_corporate_tax: { economic: 0, social: 0 }, // 1991: reformed lower rate
      fi_sales_tax: { economic: 0, social: 0 }, // 1991: turnover tax; VAT with EU in 1994
      fi_social_charges: { economic: 0, social: 0 }, // 1991: mature contribution system
      fi_customs_tariff: { economic: 1, social: 0 }, // 1991: EEA path — free trade
      fi_state_enterprises: { economic: -1, social: 0 }, // 1991: corporatisation begun; still large
      fi_labor_law: { economic: -1, social: 0 }, // 1991: incomes-policy machinery intact
      fi_welfare_state: { economic: -1, social: 0 }, // 1991: full Nordic welfare state, pre-depression cuts
    },
    optionIndexes: {
      fi_income_tax: 2,
      fi_corporate_tax: 2,
      fi_sales_tax: 2,
      fi_social_charges: 1,
      fi_customs_tariff: 0,
      fi_state_enterprises: 2,
      fi_labor_law: 2,
      fi_welfare_state: 2,
    },
    regions: fiRegions,
  },

  tr: {
    nationalStateId: "tr_national",
    defaults: {
      tr_income_tax: { economic: 0, social: 0 }, // 1991: top ~50% statutory; bracket creep + weak collection under high inflation
      tr_corporate_tax: { economic: 0, social: 0 }, // 1991: Kurumlar Vergisi 46%
      tr_sales_tax: { economic: 0, social: 0 }, // 1991: KDV (VAT, introduced 1985) standard 12%
      tr_social_charges: { economic: 0, social: 0 }, // 1991: SSK/Bağ-Kur/Emekli Sandığı — coverage still partial
      tr_customs_tariff: { economic: 0, social: 0 }, // 1991: Özal liberalisation slashed the import-substitution wall; center
      tr_state_enterprises: { economic: -1, social: 0 }, // 1991: KİTs still dominant; privatisation rhetoric far ahead of execution
      tr_labor_law: { economic: 0, social: 1 }, // 1991: restrictive post-coup 1983 labor law; strikes resuming (Zonguldak miners 1990-91)
      tr_welfare_state: { economic: 0, social: 0 }, // 1991: minimal formal welfare; family/informal safety net
    },
    optionIndexes: {
      tr_income_tax: 2, // 35% — below the 50% statutory top, reflecting weak effective collection
      tr_corporate_tax: 3, // 40% ≈ the 46% 1991 Kurumlar rate
      tr_sales_tax: 2, // 12% — the exact 1991 standard KDV rate
      tr_social_charges: 1, // 20% ≈ combined SSK contributions
      tr_customs_tariff: 1, // 15% — liberalised but still protective (1979 preset's heavy-protection 2 no longer fits)
      tr_state_enterprises: 2, // KİT Étatism Law — SEEs still dominant
      tr_labor_law: 2, // Labor Code Statute
      tr_welfare_state: 2, // Social Provision Statute (minimal baseline)
    },
    regions: trRegions,
  },
};
