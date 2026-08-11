/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's COUNTRY_POLICY_CONFIGS. All values are authored for 1979
 * directly. Same-era imports (states1979) and type-only imports are allowed.
 */

/**
 * US national + regional base policy positions for the 1979-default preset
 * (Carter administration, 96th Congress). Calibrated to real-world 1979 policy:
 *
 *   US — Carter / 96th Congress (Democratic House AND Senate; the New Deal
 *     coalition at its last high-water mark, on the eve of the 1980 Reagan
 *     realignment). Defining 1979 anchors:
 *       - **70% top marginal income-tax rate** (pre-1981 ERTA) and a **46%
 *         statutory corporate rate** — the high-rate redistributive regime
 *         (LEFT of every later era; the income/corporate `optionIndexes` are the
 *         highest in the cross-era set)
 *       - Stagflation + the 1979 energy crisis: National Energy Act (1978),
 *         phased oil-price decontrol, the Synfuels program, Dept. of Energy
 *         (1977) — energy salient but split between conservation and domestic
 *         production
 *       - Labor at peak strength (union density ~24%); CETA public-service jobs;
 *         FLSA minimum wage rising ($2.90→$3.10); Humphrey-Hawkins (1978) — left
 *       - Safety net expanding: Food Stamp Act 1977 (purchase requirement
 *         eliminated); 1977 Social Security financing amendments — left
 *       - Post-Watergate reform: Ethics in Government Act (1978), FEC, Inspectors
 *         General Act (1978); FEMA created (1979)
 *       - Regulated economy: the Fairness Doctrine and the pre-1984 AT&T/Bell
 *         monopoly under FCC rate regulation — left; BUT airline (1978) and
 *         trucking deregulation underway, and the Tokyo Round (1979) cut tariffs
 *       - Roe (1973) intact, but the Hyde Amendment (1976) restricts funding;
 *         the Moral Majority (1979) and the social-conservative backlash are only
 *         just beginning — so SOCIALLY more traditional than 1999 (guns,
 *         culture near center, not left)
 *       - Defense RISING — Carter's post-Afghanistan FY1980 buildup ends the
 *         post-Vietnam drawdown (center, not the 1999 "peace dividend" low)
 *       - Cold War hardening: Camp David (1978) and SALT II (1979), but the Iran
 *         hostage crisis (Nov 1979) and the Soviet invasion of Afghanistan
 *         (Dec 1979) collapse détente
 *
 * Tax `optionIndexes` reflect the pre-Reagan high-rate regime (the highest in
 * the era set), tuned so FY1979 receipts land near the real ≈18% of GDP.
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states1979 } from "./states1979";
import { ukRegions1979 } from "@/lib/seeds/uk/ukRegions1979";
import { deRegions1979 } from "@/lib/seeds/de/deRegions1979";
import { jpRegions1979 } from "@/lib/seeds/jp/jpRegions1979";
import { cnRegions1979 } from "@/lib/seeds/cn/cnRegions1979";
import { brRegions1979 } from "@/lib/seeds/br/brRegions1979";
import { ieRegions1979 } from "@/lib/seeds/ie/ieRegions1979";
import { ngRegions1979 } from "@/lib/seeds/ng/ngRegions1979";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";

export const COUNTRY_POLICY_CONFIGS_1979: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Carter administration, 1979 (96th Congress)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: -1, social: 0 }, // 1979: Dept. of Education created; federal investment up — left
      us_federal_science_funding: { economic: -1, social: 0 }, // 1979: post-Apollo NSF/NASA + DOE energy R&D — left
      us_school_standards: { economic: 0, social: 0 }, // 1979: pre-standards movement; local control; center
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 0, social: 0 }, // 1979: Medicare/Medicaid (1965) baseline; Kennedy–Carter NHI debate unresolved; center
      us_drug_pricing_medicare: { economic: 0, social: 0 }, // 1979: no Medicare drug benefit; center
      us_public_health: { economic: 0, social: 0 }, // 1979: standard CDC/NIH posture; center
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 0, social: 0 }, // 1979: National Energy Act + Synfuels + solar push, but the energy crisis favored coal/domestic oil — mixed, center
      us_conservation: { economic: -1, social: 0 }, // 1979: ANILCA (Alaska Lands), Superfund pending, strong EPA — left
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: -1, social: 0 }, // 1979: 70% top marginal rate — the high-rate redistributive regime (left)
      us_federal_domestic_corporate_tax_rate: { economic: -1, social: 0 }, // 1979: 46% statutory corporate rate — left
      us_federal_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // Day-one parity below domestic
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // 1979: combined OASDI+HI ≈ 12.26% (1977 amendments ramping toward the 1990 level)
      us_federal_tariff_rate: { economic: 0, social: 0 }, // Game baseline 0%; the Tokyo Round (1979) cut tariffs — low-tariff era
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // 1979: no federal sales tax
      us_federal_spending_stimulus: { economic: -1, social: 0 }, // 1979: Keynesian fiscal posture, CETA jobs, FY1979 deficit — left
      us_transportation: { economic: 0, social: 0 }, // 1979: Interstate maintenance; airline/trucking deregulation underway; center
      us_broadband_energy: { economic: 0, social: 0 }, // 1979: no broadband; National Energy Act on the energy side; center
      us_minimum_wage: { economic: -1, social: 0 }, // 1979: FLSA minimum wage rising ($2.90→$3.10) — left
      us_workforce_development: { economic: -1, social: 0 }, // 1979: CETA public-service employment near its peak — left
      us_housing: { economic: 0, social: 0 }, // 1979: HUD Section 8, but high mortgage rates; center
      us_food_nutrition: { economic: -1, social: 0 }, // 1979: Food Stamp Act 1977 eliminated the purchase requirement, expanding access — left
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // 1979: 1977 financing amendments shored up the trust fund; protect — center
      us_medicaid: { economic: 0, social: 0 }, // 1979: 1965 program, pre-reform; center
      us_medicaid_expansion: { economic: 0, social: 0 }, // 1979: no expansion mechanism; center
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 0, social: 0 }, // 1979: LEAA era, pre-1980s "tough on crime" / war-on-drugs escalation; center
      us_prison_rehabilitation: { economic: 0, social: 0 }, // 1979: the rehabilitative ideal still alive before the punitive turn; center
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: 0, social: 0 }, // 1979: Carter's post-Afghanistan FY1980 buildup ends the post-Vietnam drawdown — rising, center (not the 1999 peace-dividend low)
      us_foreign_policy: { economic: 0, social: 0 }, // 1979: Camp David / SALT II, but Iran hostages + Soviet Afghanistan collapse détente; center
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 0, social: 0 }, // 1979: pre-IRCA (1986); low salience; center
      us_legal_immigration_visas: { economic: 0, social: 0 }, // 1979: Refugee Act (1980) for Indochinese/Cuban arrivals; pre-tech-visa; center
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: -1 }, // 1979: Roe intact, but the Hyde Amendment (1976) restricts funding — net mildly pro-choice federal posture (left)
      us_paid_family_leave: { economic: 0, social: 0 }, // 1979: no leave law (FMLA is 1993); center
      us_gun_control: { economic: 0, social: 0 }, // 1979: GCA-1968 baseline, no AWB, pre-radicalization NRA, low salience — center (right of 1999)
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 0, social: 0 }, // 1979: post-Watergate Ethics in Government Act (1978) + FEC; reformist but coded center
      us_civics_voting_rights: { economic: 0, social: -1 }, // 1979: VRA in force + 1975 language-minority expansion — left
      us_media_communications: { economic: -1, social: 0 }, // 1979: Fairness Doctrine + the regulated AT&T/Bell monopoly (pre-1984 breakup) — left (opposite of 1999 deregulation)
      us_emergency_services: { economic: 0, social: 0 }, // 1979: FEMA newly created; center
    },
    optionIndexes: {
      us_federal_income_tax_rate: 6, // 70% top marginal rate — the highest-tax era; revenue knob (30% × taxableIncome ratio) tuned to ≈8.5% of GDP individual income tax
      us_federal_domestic_corporate_tax_rate: 9, // 46% statutory in 1979 — above the 34/35% of the 1991/2007 seeds (index 8)
      us_federal_foreign_corporate_tax_rate: 7, // Day-one parity below domestic, proportional to the higher pre-Reagan domestic rate
      us_federal_payroll_tax_rate: 4, // ≈12.26% combined OASDI+HI in 1979 (below the 15.3% modern level reached in 1990)
      us_federal_tariff_rate: 0, // 0% game baseline
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax
      us_social_security: 5,
    },
    regions: states1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED KINGDOM — Thatcher / Conservative government, 1979
  //  Elected May 3, 1979. First budget doubled VAT to 15%; top income tax cut
  //  83%→60%, basic 33%→30%. Monetarism begins. Anti-union posture. NATO Cold
  //  War commitments. NHS maintained but under budget pressure. No privatisation
  //  yet (that comes 1984+). VAT existed since 1973.
  // ═══════════════════════════════════════════════════════════════════════════
  uk: {
    nationalStateId: "uk_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      uk_nhs_funding: { economic: 1, social: 0 }, // 1979: Thatcher first budget imposed NHS cuts; underfunded but maintained; right of center
      uk_social_care: { economic: 1, social: 0 }, // 1979: local authority social care; Conservatives skeptical; right
      uk_mental_health: { economic: 0, social: 0 }, // 1979: deinstitutionalisation beginning (Mental Health Act 1983 approaching); center
      uk_public_health: { economic: 0, social: 0 }, // 1979: NHS baseline; center
      // ── Education ──────────────────────────────────────────────────────────
      uk_tuition_fees: { economic: 0, social: 0 }, // 1979: no tuition fees (grants for students); maintenance grants
      uk_education_standards: { economic: 0, social: 1 }, // 1979: Black Papers on education; back-to-basics sentiment; conservative
      uk_education_funding: { economic: 1, social: 0 }, // 1979: Thatcher cutting public spending; education budget squeezed; right
      uk_research_science: { economic: 0, social: 0 }, // 1979: MRC/SRC active; center
      // ── Economic ───────────────────────────────────────────────────────────
      uk_fiscal_spending: { economic: 1, social: 0 }, // 1979: MTFS (Medium Term Financial Strategy); monetarist austerity; right
      uk_local_government_funding: { economic: 1, social: 0 }, // 1979: Thatcher squeezing council budgets; Rate Support Grant cuts; right
      // ── Infrastructure ─────────────────────────────────────────────────────
      uk_transport_rail: { economic: 0, social: 0 }, // 1979: British Rail still nationalised; no privatisation yet; center
      uk_energy_grid: { economic: 0, social: 0 }, // 1979: CEGB/British Gas still nationalised; Thatcher era privatisation not yet; center
      // ── Environment ────────────────────────────────────────────────────────
      uk_climate_net_zero: { economic: 0, social: 0 }, // 1979: no climate framework; center
      uk_north_sea_energy: { economic: -1, social: 0 }, // 1979: North Sea oil at 1.6M bbl/day; BNOC active; Thatcher later privatises but not yet; left
      // ── Law & Justice ──────────────────────────────────────────────────────
      uk_policing_crime: { economic: 0, social: 1 }, // 1979: "law and order" manifesto; Police Federation support for Tories; conservative
      uk_prison_rehabilitation: { economic: 0, social: 1 }, // 1979: rising crime; punitive sentiment growing; conservative
      // ── Defence ────────────────────────────────────────────────────────────
      uk_defence_spending: { economic: -1, social: 0 }, // 1979: NATO commitment (3% real increase pledge); Cold War; left-leaning spend
      uk_trident_defence: { economic: -1, social: 0 }, // 1979: nuclear deterrent committed; Chevaline upgrade; high priority
      // ── Foreign Policy ─────────────────────────────────────────────────────
      uk_foreign_policy: { economic: -1, social: 0 }, // 1979: Thatcher Atlanticist; Special Relationship; anti-Soviet; NATO hawk
      // ── Welfare ────────────────────────────────────────────────────────────
      uk_universal_credit: { economic: 0, social: 0 }, // 1979: National Insurance / DHSS benefits; Supplementary Benefit; center
      uk_state_pensions: { economic: 0, social: 0 }, // 1979: SERPS just introduced (1978); basic plus earnings-related pension; center
      uk_childcare: { economic: 1, social: 0 }, // 1979: minimal state childcare; Thatcher hostile to nursery expansion; right
      // ── Immigration ────────────────────────────────────────────────────────
      uk_immigration_asylum: { economic: 0, social: 2 }, // 1979: British Nationality Act 1981 being prepared; tightening; right
      uk_work_visas: { economic: 0, social: 1 }, // 1979: Commonwealth immigration now controlled; tighter than 1953; right of center
      // ── Labour ─────────────────────────────────────────────────────────────
      uk_workers_rights: { economic: 1, social: 0 }, // 1979: Employment Act 1980 approaching; Thatcher anti-union; Winter of Discontent just past; right
      uk_workforce_development: { economic: 0, social: 0 }, // 1979: MSC (Manpower Services Commission) active; center
      // ── Housing ────────────────────────────────────────────────────────────
      uk_housing_planning: { economic: 0, social: 0 }, // 1979: Right to Buy announced (Housing Act 1980 approaching); shift from council building; center transitioning right
      uk_leasehold_reform: { economic: 0, social: 0 }, // 1979: leasehold unchanged; center
      // ── Governance ─────────────────────────────────────────────────────────
      uk_devolution_local_powers: { economic: 1, social: 0 }, // 1979: devolution referenda failed (March 1979); Thatcher anti-devolution; right
      uk_government_ethics: { economic: 0, social: 0 }, // 1979: center
      uk_electoral_reform: { economic: 0, social: 0 }, // 1979: FPTP unchallenged; center
      // ── Media ──────────────────────────────────────────────────────────────
      uk_bbc_public_media: { economic: 0, social: 0 }, // 1979: BBC licence fee; ITV franchise system; center
      uk_digital_broadband: { economic: 0, social: 0 }, // 1979: no digital; center
      // ── Civil Liberties ────────────────────────────────────────────────────
      uk_surveillance_privacy: { economic: 0, social: 1 }, // 1979: MI5/Special Branch; IRA threat; conservative
      uk_drug_policy: { economic: 0, social: 1 }, // 1979: Misuse of Drugs Act 1971 framework; conservative
    },
    optionIndexes: {
      uk_income_tax_rate: 4, // 1979: top rate 60% (cut from 83%); basic 30% — much lower than 1953's 97.5% (index 9); Thatcher's first budget
      uk_national_insurance: 4, // 1979: rising NI contributions; SERPS funded; above 1953's index 3
      uk_vat: 7, // 1979: VAT doubled to 15% in first budget (from 10%); high index
      uk_excise_customs: 0, // 0% game baseline
      uk_domestic_corporation_tax: 6, // 1979: standard rate 52% → being cut; above modern rates
      uk_foreign_corporation_tax: 5, // day-one parity below domestic
      uk_nhs_funding: 3, // 1979: slightly higher than 1953 (NHS more established); underfunded by Thatcher
      uk_tuition_fees: 0, // 1979: no tuition fees; student grants
      uk_state_pensions: 4, // 1979: SERPS just introduced; higher than 1953's index 2
      uk_fiscal_spending: 2, // 1979: MTFS austerity; same tight stance as 1953
    },
    regions: ukRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  WEST GERMANY — Schmidt / SPD-FDP coalition, 1979
  //  Social market economy; NATO dual-track decision Dec 1979; Bundesbank hard
  //  DM; codetermination (1976); strong welfare state; VAT 13%; Ostpolitik.
  // ═══════════════════════════════════════════════════════════════════════════
  de: {
    nationalStateId: "de_national",
    defaults: {
      de_income_tax_rate: { economic: -1, social: 0 }, // 1979: top marginal ~56%; SPD progressive tax; left of center
      de_solidarity_surcharge: { economic: 0, social: 0 }, // 1979: no Soli (introduced 1991); center
      de_vat_rate: { economic: 0, social: 0 }, // 1979: VAT at 13% (standard); center
      de_domestic_corporate_tax_rate: { economic: -1, social: 0 }, // 1979: ~56% combined corporate tax rate; high
      de_foreign_corporate_tax_rate: { economic: -1, social: 0 }, // day-one parity
      de_payroll_social_insurance: { economic: -1, social: 0 }, // 1979: comprehensive Bismarckian social insurance; high employer/employee contributions; left
      de_defence_spending: { economic: -1, social: 0 }, // 1979: NATO dual-track Dec 1979; 3% of GDP target; Bundeswehr at Cold War peak; left-leaning spend
      de_nhs_equivalent: { economic: -1, social: 0 }, // 1979: statutory health insurance universal; comprehensive Krankenversicherung; left
      de_welfare_state: { economic: -1, social: 0 }, // 1979: mature Soziale Marktwirtschaft; generous but Schmidt tightening; left of center
      de_education_funding: { economic: -1, social: 0 }, // 1979: Länder control; comprehensive (Gesamtschule) vs gymnasium debate; left
      de_infrastructure: { economic: -1, social: 0 }, // 1979: Bundesbahn still nationalised; Autobahn maintained; left
      de_housing: { economic: 0, social: 0 }, // 1979: social housing less dominant than 1953; market emerging; center
    },
    optionIndexes: {
      de_income_tax: 7, // 1979: ~56% top marginal; below 1953's ~85% (index 8) but above 1991's 53% (index 7, same)
      de_solidarity_surcharge: 0, // 1979: no Soli
      de_vat: 4, // 1979: 13% VAT; above 0 (1953 pre-VAT); below later increases
      de_domestic_corporate_tax: 8, // 1979: high combined rate; below 1953's index 9
      de_foreign_corporate_tax: 7, // day-one below domestic
      de_payroll_social_insurance: 6, // 1979: peak social insurance contributions; above 1953's index 4
    },
    regions: deRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  JAPAN — Ohira / LDP, 1979
  //  Second oil shock; export-led growth; MITI industrial policy; lifetime
  //  employment system peak; national health insurance universal since 1961;
  //  no consumption tax (debate started but withdrawn); defense <1% GDP.
  // ═══════════════════════════════════════════════════════════════════════════
  jp: {
    nationalStateId: "jp_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      jp_national_health_insurance: { economic: -1, social: 0 }, // 1979: universal NHI since 1961; comprehensive; left of center
      jp_elder_care: { economic: 0, social: 0 }, // 1979: Gold Plan not until 1989; family-based but some state; center
      jp_mental_health: { economic: 0, social: 1 }, // 1979: institutionalisation dominant; Mental Health Law (1950) conservative
      jp_public_health: { economic: 0, social: 0 }, // 1979: center
      // ── Education ──────────────────────────────────────────────────────────
      jp_education_funding: { economic: -1, social: 0 }, // 1979: heavy investment in education; LDP policy; left
      jp_university_tuition: { economic: 1, social: 0 }, // 1979: rising national university fees; right
      jp_academic_reform: { economic: 0, social: 0 }, // 1979: MEXT control; center
      jp_research_science: { economic: -1, social: 0 }, // 1979: MITI R&D direction; heavy investment; left
      // ── Defense & Security ─────────────────────────────────────────────────
      jp_article9_sdf: { economic: 0, social: -1 }, // 1979: Article 9 still constraining; SDF below 1% GDP; left-leaning
      jp_defense_spending: { economic: 0, social: 0 }, // 1979: <1% GDP ceiling; US treaty covers defense; center
      jp_cybersecurity: { economic: 0, social: 0 }, // 1979: no cyber; center
      // ── Economic ───────────────────────────────────────────────────────────
      jp_fiscal_stimulus: { economic: -1, social: 0 }, // 1979: MITI-directed investment; oil shock response; left of center
      jp_minimum_wage: { economic: 0, social: 0 }, // 1979: regional minimum wages in place since 1959; center
      jp_labor_reform: { economic: 0, social: 0 }, // 1979: lifetime employment norm; enterprise union system; center
      jp_sme_support: { economic: -1, social: 0 }, // 1979: MITI SME support programs; left
      jp_local_allocation_tax: { economic: 0, social: 0 }, // 1979: fiscal equalization active; center
      // ── Infrastructure ─────────────────────────────────────────────────────
      jp_disaster_preparedness: { economic: 0, social: 0 }, // 1979: center
      jp_rail_transport: { economic: -1, social: 0 }, // 1979: JNR (Japanese National Railways) dominant; pre-privatisation (1987); left
      jp_digital_infrastructure: { economic: 0, social: 0 }, // 1979: NTT monopoly; center
      // ── Environment & Energy ───────────────────────────────────────────────
      jp_nuclear_energy: { economic: -1, social: 0 }, // 1979: nuclear program expanding post-oil-shock; left (state investment)
      jp_climate_emissions: { economic: 0, social: 0 }, // 1979: no climate framework; center
      jp_renewable_energy: { economic: 0, social: 0 }, // 1979: minimal; center
      // ── Social Policy ──────────────────────────────────────────────────────
      jp_family_policy: { economic: 0, social: 1 }, // 1979: traditional family model; some softening vs 1953; conservative
      jp_pension: { economic: -1, social: 0 }, // 1979: national pension since 1961; expanded; left of center
      jp_gender_equality: { economic: 1, social: 1 }, // 1979: deeply patriarchal; women in workforce low; right
      jp_work_culture_reform: { economic: 0, social: 1 }, // 1979: long hours; company loyalty; conservative
      // ── Immigration ────────────────────────────────────────────────────────
      jp_foreign_worker_policy: { economic: 1, social: 2 }, // 1979: essentially closed to labor immigration; right
      jp_visa_residency: { economic: 0, social: 1 }, // 1979: restrictive; right of center
      jp_integration_programs: { economic: 0, social: 0 }, // 1979: minimal; center
      // ── Agriculture ────────────────────────────────────────────────────────
      jp_agricultural_subsidies: { economic: -2, social: 0 }, // 1979: heavy rice subsidies; food self-sufficiency obsession; very left
      jp_food_security: { economic: 0, social: 1 }, // 1979: autarky aspiration; conservative
      jp_rural_development: { economic: -1, social: 0 }, // 1979: LDP rural pork-barrel spending; left
      // ── Governance ─────────────────────────────────────────────────────────
      jp_constitutional_reform: { economic: 0, social: 0 }, // 1979: Article 9 debate continuing; center
      jp_regional_autonomy: { economic: 0, social: 0 }, // 1979: center
      jp_electoral_reform: { economic: 0, social: 0 }, // 1979: SNTV system; no reform; center
      // ── Foreign Policy / Trade ─────────────────────────────────────────────
      jp_foreign_aid_diplomacy: { economic: -1, social: 0 }, // 1979: Japan becoming major ODA donor; left of center
      jp_trade_agreements: { economic: -1, social: 0 }, // 1979: MITI export-promotion; GATT Tokyo Round 1979; protectionist on agriculture
      // ── Technology ─────────────────────────────────────────────────────────
      jp_robotics_ai: { economic: -1, social: 0 }, // 1979: MITI robot research beginning; left (state directed)
      jp_rd_investment: { economic: -1, social: 0 }, // 1979: heavy MITI R&D in steel/electronics/auto; left
      jp_digital_governance: { economic: 0, social: 0 }, // 1979: no digital governance; center
      // ── Public Safety ──────────────────────────────────────────────────────
      jp_policing_public_safety: { economic: 0, social: 1 }, // 1979: NPA; conservative policing
      jp_criminal_justice: { economic: 0, social: 1 }, // 1979: hostage-justice norms; conservative
    },
    optionIndexes: {
      jp_income_tax_rate: 7, // 1979: top bracket ~75% (below 1953's ~85%, index 9; above 1991's index 7 — same, so set same)
      jp_domestic_corporation_tax: 8, // 1979: ~52% combined corporate rate; below 1953's index 9 but still high
      jp_foreign_corporation_tax: 6, // day-one parity below domestic
      jp_social_insurance: 5, // 1979: comprehensive NHI + national pension + unemployment; well above 1953's index 2
      jp_consumption_tax: 0, // 1979: no consumption tax (debate in 1979, withdrawn, introduced 1989 at 3%)
      jp_resident_tax: 4, // 1979: roughly stable
      jp_fixed_asset_tax: 5, // 1979: roughly stable
      jp_customs_tariff: 0, // 0% game baseline; Tokyo Round cutting tariffs
    },
    regions: jpRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  FRANCE — Giscard d'Estaing / UDF-RPR, 1979 (Fifth Republic)
  //  Center-right president; large welfare state (Sécurité Sociale); EMS
  //  founding member; still nationalised utilities and banks from 1945/46;
  //  Mitterrand nationalisations NOT yet (1981); high TVA ~20%; high inflation.
  // ═══════════════════════════════════════════════════════════════════════════
  fr: {
    nationalStateId: "fr_national",
    defaults: {
      fr_income_tax: { economic: 0, social: 0 }, // 1979: progressive income tax but Giscard center-right; not as left as 1953's PCF-influenced policy; center
      fr_corporate_tax: { economic: -1, social: 0 }, // 1979: ~50% corporate rate; high; left of center
      fr_vat: { economic: 0, social: 0 }, // 1979: TVA standard rate ~20%; mature VAT system; center
      fr_social_charges: { economic: -1, social: 0 }, // 1979: high Sécurité Sociale cotisations; left
      fr_customs_tariff: { economic: 0, social: 0 }, // 1979: EEC common external tariff; not independently protectionist now; center
      fr_nationalization: { economic: -1, social: 0 }, // 1979: utilities/banks nationalised from 1944-46; Giscard not adding more; left
      fr_labor_law: { economic: -1, social: 0 }, // 1979: CGT/CFDT unions strong; 35-40 hr week debate coming; left
      fr_welfare_state: { economic: -1, social: 0 }, // 1979: mature Sécurité Sociale; comprehensive but constrained by oil shock; left
    },
    optionIndexes: {
      fr_income_tax: 3, // 1979: center-right; below 1953's PCF-influenced index 4
      fr_corporate_tax: 4, // 1979: high; above 1953's 4 — same
      fr_vat: 3, // 1979: standard TVA ~20%; above 1953's 1 (nascent TVA)
      fr_social_charges: 3, // 1979: mature Sécurité Sociale; above 1953's index 2
      fr_customs_tariff: 1, // 1979: EEC CET; below 1953's protectionism index 2
      fr_nationalization: 2, // 1979: existing nationalisations maintained; not expanding (that's 1981)
      fr_labor_law: 2, // 1979: strong labor code; same as 1953
      fr_welfare_state: 3, // 1979: mature welfare state; above 1953's 2
    },
    regions: frRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ITALY — Christian Democracy / Cossiga, 1979 (First Republic)
  //  Anni di piombo (Years of Lead) post-Moro; DC hegemony; high deficit
  //  "Italian disease"; Statuto dei Lavoratori (1970) in force; strong unions.
  // ═══════════════════════════════════════════════════════════════════════════
  it: {
    nationalStateId: "it_national",
    defaults: {
      it_income_tax: { economic: -1, social: 0 }, // 1979: IRPEF unified (1974); progressive; left of center vs 1953 patchwork
      it_corporate_tax: { economic: -1, social: 0 }, // 1979: IRPEG; high corporate taxes; left
      it_vat: { economic: 0, social: 0 }, // 1979: IVA at 14% standard (introduced 1973); center
      it_social_charges: { economic: -1, social: 0 }, // 1979: INPS contributions high; Statuto dei Lavoratori; left
      it_customs_tariff: { economic: 0, social: 0 }, // 1979: EEC common external tariff; center
      it_state_holdings: { economic: -2, social: 0 }, // 1979: IRI/ENI still large; Mediobanca; less than 1953 but still very left
      it_labor_law: { economic: -2, social: 0 }, // 1979: Statuto dei Lavoratori (1970) at peak; CGIL/CISL/UIL; very left
      it_welfare_state: { economic: -1, social: 0 }, // 1979: matured since 1953; SSN (national health service) just created 1978; left
    },
    optionIndexes: {
      it_income_tax: 4, // 1979: above 1953's index 3; IRPEF progressive system
      it_corporate_tax: 3, // 1979: IRPEG; moderate-high
      it_vat: 2, // 1979: IVA 14%; above 0 (1953 no VAT) but below peak
      it_social_charges: 3, // 1979: INPS contributions high; above 1953's 2
      it_customs_tariff: 1, // 1979: EEC CET; center
      it_state_holdings: 2, // 1979: IRI/ENI still large; less than 1953's peak index 3
      it_labor_law: 3, // 1979: Statuto dei Lavoratori at peak; above 1953's 2
      it_welfare_state: 3, // 1979: SSN created 1978; above 1953's 2
    },
    regions: itRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SPAIN — Suárez / UCD, 1979 (Democratic Transition)
  //  Post-Franco democratic transition; Constitution Dec 1978; regional
  //  autonomies being established; NATO not yet (1982); EEC not yet (1986);
  //  IVA not yet (introduced with EEC 1986); high unemployment ~8%.
  // ═══════════════════════════════════════════════════════════════════════════
  es: {
    nationalStateId: "es_national",
    defaults: {
      es_income_tax: { economic: -1, social: 0 }, // 1979: IRPF (personal income tax) being established; progressive transition; left of center
      es_corporate_tax: { economic: 0, social: 0 }, // 1979: corporate tax reforming; center
      es_consumption_tax: { economic: 0, social: 0 }, // 1979: no IVA yet (introduced 1986 with EEC entry); various consumption taxes; center
      es_social_charges: { economic: -1, social: 0 }, // 1979: growing Seguridad Social contributions; left of center
      es_customs_tariff: { economic: -1, social: 0 }, // 1979: still protectionist but liberalising; not autarky anymore; left
      es_state_holdings: { economic: -1, social: 0 }, // 1979: INI still large but not at Franco-era maximum; left
      es_labor_law: { economic: -1, social: 0 }, // 1979: Workers' Statute (Estatuto de los Trabajadores) coming 1980; new free unions; left
      es_welfare_state: { economic: -1, social: 0 }, // 1979: welfare state being built; democracy expanding social rights; left
    },
    optionIndexes: {
      es_income_tax: 3, // 1979: IRPF being built; above 1953's index 1 (autarky low collection)
      es_corporate_tax: 3, // 1979: transitional; center
      es_consumption_tax: 1, // 1979: various impuestos; pre-IVA; low
      es_social_charges: 2, // 1979: growing; above 1953's 1
      es_customs_tariff: 2, // 1979: liberalising but still protective; below 1953's autarky index 4
      es_state_holdings: 2, // 1979: INI present but less than Franco peak; below 1953's index 3
      es_labor_law: 3, // 1979: new democratic labor framework; above 1953's Sindicatos verticales index 3
      es_welfare_state: 2, // 1979: welfare state expanding; above 1953's 1
    },
    regions: esRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SWEDEN — Fälldin / Center-Conservative-Liberal coalition, 1979
  //  First non-SAP government since 1936. Swedish Model intact — very high
  //  taxes (~80%+ marginal), universal services, peak union density ~85%.
  //  Nuclear referendum 1980 pending. Meidner wage-earner fund debate.
  // ═══════════════════════════════════════════════════════════════════════════
  se: {
    nationalStateId: "se_national",
    defaults: {
      se_income_tax: { economic: -2, social: 0 }, // 1979: peak marginal tax rates (~80%+); Swedish model apex; very left
      se_corporate_tax: { economic: -1, social: 0 }, // 1979: moderate-high corporate tax; investments favored; left
      se_vat: { economic: -1, social: 0 }, // 1979: Moms at 17.1%; comprehensive VAT; left
      se_social_charges: { economic: -2, social: 0 }, // 1979: arbetsgivaravgift very high (40%+); funding universal welfare; very left
      se_customs_tariff: { economic: 0, social: 0 }, // 1979: EFTA member; moderate; center
      se_wage_earner_funds: { economic: -1, social: 0 }, // 1979: Meidner plan debated; LO pushing; left
      se_labor_law: { economic: -2, social: 0 }, // 1979: Codetermination Act (MBL 1976); LO-SAF agreements; very left
      se_welfare_state: { economic: -2, social: 0 }, // 1979: mature folkhem at apex; universal social insurance; very left
    },
    optionIndexes: {
      se_income_tax: 6, // 1979: peak ~80%+ marginal; highest in era set for SE; above 1953's 4
      se_corporate_tax: 4, // 1979: above 1953's 3; investment favorable via depreciation rules
      se_vat: 4, // 1979: Moms 17%; above 1953's 0 (no Moms)
      se_social_charges: 5, // 1979: peak arbetsgivaravgift; above 1953's 2
      se_customs_tariff: 1, // 1979: EFTA; center; same as 1953
      se_wage_earner_funds: 1, // 1979: private ownership still dominant; Meidner plan debated but not enacted
      se_labor_law: 3, // 1979: MBL codetermination; above 1953's index 2
      se_welfare_state: 4, // 1979: mature welfare state; above 1953's 3
    },
    regions: seRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TURKEY — Political crisis year, 1979
  //  Ecevit (CHP, left) PM → Demirel (AP, right) from Nov 1979 → military
  //  coup Sep 1980 approaching. IMF structural adjustment. Very high inflation
  //  (~70%+). Political violence (3,000+ deaths). Large state enterprises.
  // ═══════════════════════════════════════════════════════════════════════════
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
    },
    regions: fiRegions,
  },

  tr: {
    nationalStateId: "tr_national",
    defaults: {
      tr_income_tax: { economic: 0, social: 0 }, // 1979: income tax; very high inflation distorts; center
      tr_corporate_tax: { economic: 0, social: 0 }, // 1979: moderate; center
      tr_sales_tax: { economic: 0, social: 0 }, // 1979: various consumption taxes; pre-KDV (VAT introduced 1985); center
      tr_social_charges: { economic: 0, social: 0 }, // 1979: SSK/Bağ-Kur social insurance; expanding but limited; center
      tr_customs_tariff: { economic: -1, social: 0 }, // 1979: still protectionist but IMF pressuring for liberalisation; left
      tr_state_enterprises: { economic: -1, social: 0 }, // 1979: KİT SEEs still dominant; pre-Özal privatisation (1983+); left
      tr_labor_law: { economic: 0, social: 1 }, // 1979: Ecevit labor-friendly → Demirel tightening; crisis year; right-leaning
      tr_welfare_state: { economic: 0, social: 0 }, // 1979: minimal welfare; IMF austerity; center
    },
    optionIndexes: {
      tr_income_tax: 3, // 1979: higher than 1953's 2; inflation pushing nominal brackets
      tr_corporate_tax: 3, // 1979: center
      tr_sales_tax: 2, // 1979: consumption taxes; above 1953
      tr_social_charges: 2, // 1979: expanding SSK; above 1953's 1
      tr_customs_tariff: 2, // 1979: still protective; same as 1953
      tr_state_enterprises: 2, // 1979: KİT large; same as 1953
      tr_labor_law: 2, // 1979: contested; center
      tr_welfare_state: 2, // 1979: above 1953's 1; minimal but more than before
    },
    regions: trRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHINA — Deng Xiaoping / "Reform and Opening Up", 1979
  //  Four Modernizations (1978). Special Economic Zones authorized 1979.
  //  US-China normalization Jan 1979. Sino-Vietnamese border war Feb-Mar 1979.
  //  Private enterprise just beginning (small traders). Still heavily planned.
  // ═══════════════════════════════════════════════════════════════════════════
  cn: {
    nationalStateId: "cn_national",
    defaults: {
      cn_enterprise_income_tax: { economic: -2, social: 0 }, // 1979: state enterprise remittance; command economy; very left — but reform beginning
      cn_individual_income_tax: { economic: 0, social: 0 }, // 1979: no individual income tax yet (introduced 1980); center
      cn_value_added_tax: { economic: 0, social: 0 }, // 1979: no VAT (introduced 1994); product tax system; center
      cn_land_value_added_tax: { economic: 0, social: 0 }, // 1979: state owns all land; center
      cn_urban_maintenance_construction_tax: { economic: 0, social: 0 }, // center
      cn_stamp_duty: { economic: 0, social: 0 }, // center
      cn_social_insurance_contribution: { economic: -1, social: 0 }, // 1979: danwei-based; reforming; left
      cn_customs_tariff: { economic: -2, social: 0 }, // 1979: state foreign trade monopoly; opening slowly; very left
      cn_provincial_resource_tax: { economic: 0, social: 0 }, // center
      // Healthcare
      cn_medical_insurance: { economic: -1, social: 0 }, // 1979: danwei healthcare still dominant; rural barefoot doctors; left
      cn_elder_care: { economic: -1, social: 1 }, // 1979: danwei + family; left economic, conservative social
      cn_mental_health: { economic: 0, social: 2 }, // 1979: stigma extreme; conservative
      cn_public_health: { economic: -1, social: 0 }, // 1979: public health campaigns continuing; left
      // Education
      cn_education_funding: { economic: -2, social: 0 }, // 1979: gaokao restored 1977; massive education investment; very left
      cn_gaokao_reform: { economic: 0, social: 1 }, // 1979: gaokao just restored; conservative
      cn_academic_pressure_reform: { economic: 0, social: 1 }, // 1979: exam culture; conservative
      cn_research_science: { economic: -2, social: 0 }, // 1979: Four Modernizations: science as priority; very left
      // Social Policy
      cn_pension_system: { economic: -1, social: 1 }, // 1979: danwei pensions; left economic, conservative social
      cn_family_policy: { economic: -1, social: 2 }, // 1979: one-child policy being prepared (announced 1980); conservative social
      cn_gender_equality: { economic: -1, social: 1 }, // 1979: "women hold up half the sky" but traditional; mixed
      cn_common_prosperity: { economic: -2, social: 1 }, // 1979: less radical redistribution than 1953; Deng pragmatism; left but softening
      // Defense
      cn_pla_modernization: { economic: -2, social: 2 }, // 1979: PLA modernization (Four Modernizations); Sino-Vietnamese war; left spend, nationalist
      cn_taiwan_strait_doctrine: { economic: 0, social: 2 }, // 1979: peaceful reunification rhetoric replacing liberation; still assertive
      cn_cybersecurity: { economic: 0, social: 0 }, // 1979: no cyber; center
      // Foreign Policy
      cn_belt_and_road: { economic: 0, social: 0 }, // 1979: no BRI; center
      cn_us_china_relations: { economic: 0, social: 1 }, // 1979: normalization Jan 1979; improving; center-right (nationalist but pragmatic)
      cn_un_security_council_posture: { economic: 0, social: 1 }, // 1979: PRC holds seat since 1971; nationalist
      // Technology
      cn_ai_strategy: { economic: 0, social: 0 }, // 1979: no AI; center
      cn_semiconductor_strategy: { economic: -1, social: 0 }, // 1979: nascent electronics; Four Modernizations; left
      // Public Safety
      cn_public_security: { economic: 0, social: 2 }, // 1979: security apparatus; Democracy Wall then crackdown; authoritarian
      cn_criminal_justice: { economic: 0, social: 2 }, // 1979: criminal codes being reformed; authoritarian but modernizing
      cn_internet_governance: { economic: 0, social: 0 }, // 1979: no internet; center
      // Economic
      cn_state_enterprises: { economic: -3, social: 0 }, // 1979: dominant SOEs; some reform beginning in rural communes; very left
      cn_industrial_strategy: { economic: -2, social: 0 }, // 1979: Four Modernizations: industry; heavy state direction; very left
      cn_minimum_wage: { economic: -1, social: 0 }, // 1979: state-set wages; left
      cn_fiscal_stimulus: { economic: -2, social: 0 }, // 1979: massive state investment; Four Modernizations; very left
      // Infrastructure
      cn_rail_transport: { economic: -2, social: 0 }, // 1979: massive rail investment; Four Modernizations priority; very left
      cn_digital_infrastructure: { economic: 0, social: 0 }, // 1979: no digital; center
      cn_housing: { economic: -2, social: 0 }, // 1979: danwei housing; state provides; left
      // Environment & Energy
      cn_renewable_energy_target: { economic: 0, social: 0 }, // 1979: no renewable framework; center
      cn_nuclear_energy: { economic: -1, social: 0 }, // 1979: nuclear program military priority; Four Modernizations civilian; left
      cn_emissions_trading_scheme: { economic: 0, social: 0 }, // 1979: no; center
      cn_climate_targets: { economic: 0, social: 0 }, // 1979: no climate framework; center
      // Hukou & Immigration
      cn_hukou_reform: { economic: -1, social: 2 }, // 1979: hukou still restrictive; Deng beginning to relax slightly; authoritarian-social
      cn_skilled_immigration: { economic: 0, social: 0 }, // 1979: minimal; center
      cn_diaspora_engagement: { economic: 0, social: 1 }, // 1979: overseas Chinese investment being encouraged (Reform opening); center-right
      // Agriculture
      cn_agricultural_subsidies: { economic: -2, social: 0 }, // 1979: household responsibility system beginning (replacing communes); left
      cn_food_security: { economic: -1, social: 1 }, // 1979: grain self-sufficiency; left economic, conservative social
      cn_rural_revitalization: { economic: -2, social: 0 }, // 1979: rural reform starting; household contracts; left
      // Governance
      cn_anticorruption_campaign: { economic: 0, social: 1 }, // 1979: anti-corruption; authoritarian
      cn_npc_reform: { economic: 0, social: 2 }, // 1979: NPC rubber stamp; authoritarian
      cn_hk_macao_affairs: { economic: 0, social: 1 }, // 1979: one country two systems being developed; center-right
      // Media
      cn_state_media_funding: { economic: -1, social: 2 }, // 1979: People's Daily; Xinhua; state media dominant but Democracy Wall briefly; left+authoritarian
      cn_press_freedom: { economic: 0, social: 3 }, // 1979: very low; Democracy Wall cracked down (1979); authoritarian
      // Provincial
      cn_provincial_education: { economic: -2, social: 0 }, // 1979: mass education; very left
      cn_provincial_public_security: { economic: 0, social: 2 }, // 1979: security apparatus; authoritarian
      cn_provincial_economic_development: { economic: -2, social: 0 }, // 1979: plan + early market experiments; very left
      cn_provincial_health_services: { economic: -1, social: 0 }, // 1979: expanding; left
      cn_provincial_culture_propaganda: { economic: 0, social: 2 }, // 1979: less intense than 1953; authoritarian
      cn_provincial_environmental_policy: { economic: 0, social: 0 }, // 1979: no environmental policy; center
      cn_provincial_infrastructure_investment: { economic: -2, social: 0 }, // 1979: Four Modernizations provincial targets; very left
    },
    optionIndexes: {
      cn_enterprise_income_tax: 7, // 1979: reform beginning; below 1953's maximum 9
      cn_individual_income_tax: 0, // 1979: no individual income tax yet
      cn_value_added_tax: 0, // 1979: no VAT
      cn_land_value_added_tax: 0, // 1979: state owns land
      cn_urban_maintenance_construction_tax: 3,
      cn_stamp_duty: 3,
      cn_social_insurance_contribution: 4, // 1979: danwei-based
      cn_customs_tariff: 0, // 0% game baseline; state foreign trade monopoly
      cn_provincial_resource_tax: 3,
      cn_medical_insurance: 2, // 1979: danwei coverage; above 1953's 1
      cn_elder_care: 2,
      cn_mental_health: 1,
      cn_public_health: 3, // 1979: public health maintained; above 1953's 4? No — below 1953 mass campaigns
      cn_education_funding: 4, // 1979: gaokao restored; investment; below 1953's 5
      cn_gaokao_reform: 3,
      cn_academic_pressure_reform: 3,
      cn_research_science: 4, // 1979: Four Modernizations: science priority
      cn_pension_system: 2, // 1979: danwei; limited
      cn_family_policy: 3,
      cn_gender_equality: 3,
      cn_common_prosperity: 4, // 1979: less radical than 1953; Deng pragmatism; below 1953's 5
      cn_pla_modernization: 4, // 1979: Four Modernizations military; Sino-Vietnamese war; below 1953's 5
      cn_taiwan_strait_doctrine: 3, // 1979: peaceful reunification rhetoric; below 1953's 4
      cn_cybersecurity: 3,
      cn_belt_and_road: 3,
      cn_us_china_relations: 3, // 1979: normalization; improving; center
      cn_un_security_council_posture: 3,
      cn_ai_strategy: 3,
      cn_semiconductor_strategy: 3,
      cn_public_security: 4, // 1979: below 1953's 5; still authoritarian
      cn_criminal_justice: 4,
      cn_internet_governance: 3,
      cn_state_enterprises: 4, // 1979: dominant but reform beginning; below 1953's 5
      cn_industrial_strategy: 4, // 1979: Four Modernizations; below 1953's 5
      cn_minimum_wage: 3,
      cn_fiscal_stimulus: 4, // 1979: Four Modernizations investment
      cn_rail_transport: 4, // 1979: investment; below 1953's 5
      cn_digital_infrastructure: 3,
      cn_housing: 4, // 1979: danwei housing; above 1953? same
      cn_renewable_energy_target: 3,
      cn_nuclear_energy: 3, // 1979: military nuclear + civilian developing; below 1953's 4
      cn_emissions_trading_scheme: 3,
      cn_climate_targets: 3,
      cn_hukou_reform: 2, // 1979: still restrictive; same as 1953
      cn_skilled_immigration: 3,
      cn_diaspora_engagement: 4, // 1979: encouraging overseas Chinese investment; above 1953's 3
      cn_agricultural_subsidies: 4, // 1979: household responsibility beginning
      cn_food_security: 4,
      cn_rural_revitalization: 4,
      cn_anticorruption_campaign: 4,
      cn_npc_reform: 3,
      cn_hk_macao_affairs: 3,
      cn_state_media_funding: 4, // 1979: below 1953's 5; Democracy Wall briefly existed
      cn_press_freedom: 2, // 1979: slightly above 1953's 1; Democracy Wall then closed
      cn_provincial_education: 4,
      cn_provincial_public_security: 4, // 1979: below 1953's 5
      cn_provincial_economic_development: 4,
      cn_provincial_health_services: 3,
      cn_provincial_culture_propaganda: 4, // 1979: below 1953's 5
      cn_provincial_environmental_policy: 3,
      cn_provincial_infrastructure_investment: 4,
    },
    regions: cnRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  BRAZIL — Figueiredo / Military government, 1979
  //  Last military president; economic miracle fading; oil shock hurting;
  //  political "abertura" (opening); debt crisis building; import substitution;
  //  Proálcool ethanol program; Petrobras dominant.
  // ═══════════════════════════════════════════════════════════════════════════
  br: {
    nationalStateId: "br_national",
    defaults: {},
    optionIndexes: {},
    regions: brRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  IRELAND — Lynch → Haughey / Fianna Fáil, 1979
  //  EEC member since 1973; very low corporate tax (0%→10% on manufacturing);
  //  traditional Catholic society; contraception Health Act signed May 1979;
  //  agricultural economy; CAP benefits; emigration continuing; IDA FDI push.
  // ═══════════════════════════════════════════════════════════════════════════
  ie: {
    nationalStateId: "ie_national",
    defaults: {
      // Tax
      ie_corporate_tax_rate: { economic: 0, social: 0 }, // 1979: manufacturing 0% rate (transitioning to 10% Shannon scheme); non-manuf ~45%; center
      ie_foreign_corporate_tax_rate: { economic: 1, social: 0 }, // 1979: special 0% manufacturing rate attracting FDI; right (pro-market)
      ie_income_tax_rate: { economic: -1, social: 0 }, // 1979: high personal income tax (top rate ~65%); left
      ie_usc: { economic: 0, social: 0 }, // 1979: no USC (introduced 2011); center
      ie_prsi: { economic: 0, social: 0 }, // 1979: PRSI (Pay-Related Social Insurance introduced 1979); center
      ie_vat_rate: { economic: 0, social: 0 }, // 1979: VAT introduced 1972 (EEC accession); standard ~23%; center
      ie_customs_tariff_rate: { economic: 0, social: 0 }, // 1979: EEC common external tariff; no longer independently protectionist; center
      ie_local_property_tax: { economic: 0, social: 0 }, // 1979: rates still in use (Haughey abolishes 1977 for residential); center
      ie_stamp_duty: { economic: 0, social: 0 }, // 1979: standard; center
      ie_capital_gains_tax: { economic: -1, social: 0 }, // 1979: CGT introduced 1975; moderate; left of center
      ie_excise_duty: { economic: 0, social: 0 }, // 1979: high on alcohol/tobacco; center
      // Housing
      ie_housing_policy: { economic: 0, social: 0 }, // 1979: local authority housing declining; HFA (Housing Finance Agency) 1981 approaching; center
      ie_minimum_wage: { economic: 0, social: 0 }, // 1979: no national minimum wage; center
      ie_climate_policy: { economic: 0, social: 0 }, // 1979: no climate policy; center
      // Health & Education
      ie_healthcare_policy: { economic: 0, social: 0 }, // 1979: GMS (General Medical Service) for low-income; improving; center
      ie_public_health: { economic: 0, social: 0 }, // 1979: center
      ie_mental_health: { economic: 0, social: 1 }, // 1979: large psychiatric hospitals; conservative
      ie_elder_care: { economic: 0, social: 0 }, // 1979: family + district nurse; center
      ie_education_funding: { economic: 0, social: 0 }, // 1979: free secondary since 1967; improved vs 1953; center
      ie_higher_education: { economic: 0, social: 0 }, // 1979: grants scheme in place; center
      ie_research_science: { economic: 0, social: 0 }, // 1979: minimal R&D; center
      ie_curriculum_reform: { economic: 0, social: 1 }, // 1979: Irish language still compulsory; Catholic ethos; conservative
      // Welfare
      ie_state_pensions: { economic: 0, social: 0 }, // 1979: expanding old age pension; center
      ie_unemployment_benefits: { economic: 0, social: 0 }, // 1979: expanded benefits; center
      ie_working_family_payment: { economic: 0, social: 0 }, // 1979: children's allowance; center
      ie_parental_leave: { economic: 0, social: 0 }, // 1979: minimal maternity leave; center
      ie_childcare_policy: { economic: 1, social: 1 }, // 1979: family/Church-based; right
      ie_gender_equality: { economic: 0, social: 1 }, // 1979: contraception act signed May 1979 (Health FPA); marriage bar removed 1973; modest progress; conservative
      ie_drug_policy: { economic: 0, social: 1 }, // 1979: Misuse of Drugs Act 1977; conservative
      // Economy, Labour, Infra
      ie_workers_rights: { economic: 0, social: 0 }, // 1979: ICTU unions; national wage agreements; center
      ie_workforce_development: { economic: 0, social: 0 }, // 1979: AnCO training; center
      ie_sme_support: { economic: -1, social: 0 }, // 1979: IDA FDI push AND domestic SMEs; left
      ie_fiscal_stimulus: { economic: -1, social: 0 }, // 1979: Haughey beginning to borrow heavily; left
      ie_transport_rail: { economic: -1, social: 0 }, // 1979: CIÉ nationalized; left
      ie_digital_infrastructure: { economic: 0, social: 0 }, // 1979: no digital; center
      ie_regional_economic_development: { economic: 0, social: 0 }, // 1979: IDA regional dispersal; center
      // Environment, Agriculture
      ie_renewable_energy_target: { economic: 0, social: 0 }, // 1979: no renewable policy; center
      ie_agricultural_subsidies: { economic: -1, social: 0 }, // 1979: CAP (EEC); heavy agricultural support; left
      ie_food_security: { economic: 0, social: 0 }, // 1979: CAP provides; center
      ie_rural_development: { economic: -1, social: 0 }, // 1979: LEADER precursor; rural communities; left
      ie_peat_bog_policy: { economic: -1, social: 0 }, // 1979: Bord na Móna peat; state enterprise; left
      // Defence, Foreign, Justice, Governance
      ie_defence_spending: { economic: 0, social: 0 }, // 1979: small Defence Forces; UNIFIL Lebanon deployment (1978); center
      ie_neutrality_posture: { economic: 0, social: -1 }, // 1979: strict neutrality; anti-NATO; left-leaning
      ie_foreign_aid_diplomacy: { economic: 0, social: 0 }, // 1979: growing; EEC role; center
      ie_cybersecurity: { economic: 0, social: 0 }, // 1979: no cyber; center
      ie_garda_policing: { economic: 0, social: 1 }, // 1979: IRA threat; Garda Síochána; conservative
      ie_criminal_justice: { economic: 0, social: 1 }, // 1979: conservative; Criminal Law Act 1976; conservative
      ie_government_ethics: { economic: 0, social: 0 }, // 1979: Haughey era starting; center
      ie_electoral_reform: { economic: 0, social: 0 }, // 1979: PR-STV; center
      // Immigration
      ie_immigration_asylum: { economic: 0, social: 0 }, // 1979: emigration still the issue; minimal immigration; center
      ie_work_visas: { economic: 0, social: 0 }, // 1979: EEC free movement; center
      ie_integration_programs: { economic: 0, social: 0 }, // 1979: no immigration to integrate; center
      // Regional
      ie_regional_health: { economic: 0, social: 0 },
      ie_regional_housing: { economic: 0, social: 0 },
      ie_regional_transport: { economic: 0, social: 0 },
      ie_regional_skills: { economic: 0, social: 0 },
    },
    optionIndexes: {
      ie_corporate_tax_rate: 3, // 1979: manufacturing 0%/10%; non-manuf ~45%; blended effective rate; below 1953's 8
      ie_foreign_corporate_tax_rate: 1, // 1979: 0% manufacturing special rate attracting MNCs; below 1953's 8
      ie_income_tax_rate: 6, // 1979: high personal income tax; above 2019 but below 1953's 7
      ie_usc: 0, // 1979: no USC
      ie_prsi: 4, // 1979: PRSI introduced 1979; above 1953's 3
      ie_vat_rate: 4, // 1979: VAT since 1972; ~23% standard; above 1953's 0
      ie_customs_tariff_rate: 1, // 1979: EEC CET; below 1953's protectionism 3
      ie_local_property_tax: 2, // 1979: residential rates abolished 1977; below 1953's 3
      ie_stamp_duty: 3,
      ie_capital_gains_tax: 3, // 1979: CGT since 1975; center
      ie_excise_duty: 3,
      ie_minimum_wage: 0, // 1979: no minimum wage
      ie_housing_policy: 3,
      ie_climate_policy: 3,
      ie_healthcare_policy: 3, // 1979: GMS improving; above 1953's 1
      ie_public_health: 3,
      ie_mental_health: 2,
      ie_elder_care: 3, // 1979: slightly above 1953's 2
      ie_education_funding: 3, // 1979: free secondary; above 1953's 2
      ie_higher_education: 3, // 1979: grants scheme; above 1953's 2
      ie_research_science: 3,
      ie_curriculum_reform: 3,
      ie_state_pensions: 3, // 1979: expanding; above 1953's 2
      ie_unemployment_benefits: 3, // 1979: above 1953's 2
      ie_working_family_payment: 3,
      ie_parental_leave: 2, // 1979: minimal; above 1953's 1
      ie_childcare_policy: 2,
      ie_gender_equality: 2, // 1979: some progress; above 1953's 1
      ie_drug_policy: 3,
      ie_workers_rights: 3,
      ie_workforce_development: 3,
      ie_sme_support: 4, // 1979: IDA active; above 1953's 3
      ie_fiscal_stimulus: 4, // 1979: Haughey borrowing; above 1953's 3
      ie_transport_rail: 3,
      ie_digital_infrastructure: 3,
      ie_regional_economic_development: 3,
      ie_renewable_energy_target: 3,
      ie_agricultural_subsidies: 5, // 1979: CAP; above 1953's 4
      ie_food_security: 3,
      ie_rural_development: 4,
      ie_peat_bog_policy: 4,
      ie_defence_spending: 3, // 1979: UNIFIL deployment; above 1953's 2
      ie_neutrality_posture: 2,
      ie_foreign_aid_diplomacy: 3,
      ie_cybersecurity: 3,
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
    regions: ieRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NIGERIA — Obasanjo (military) → Shagari (civilian from Oct 1979)
  //  Petro-dollar boom peak (~2.3M bbl/day); federal character system;
  //  civilian constitution; neglect of agriculture; Dutch disease.
  // ═══════════════════════════════════════════════════════════════════════════
  ng: {
    nationalStateId: "ng_national",
    defaults: {},
    optionIndexes: {},
    regions: ngRegions1979,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  USSR — Brezhnev / stagnation (Zastoi), 1979
  //  Full command economy. Afghanistan invasion Dec 1979. SALT II signed June
  //  1979. Dissidents suppressed. Less repressive than 1953 but still full
  //  authoritarian command economy. Arms race. Gosplan central planning.
  // ═══════════════════════════════════════════════════════════════════════════
  su: {
    nationalStateId: "su_national",
    defaults: {
      su_enterprise_levy: { economic: -3, social: 0 }, // 1979: enterprise profit remittance; command economy; very left
      su_individual_income_tax: { economic: 0, social: 0 }, // 1979: flat citizens' levy; minimal; center
      su_turnover_tax: { economic: 0, social: 0 }, // 1979: turnover tax major revenue source; center
      su_social_insurance: { economic: 0, social: 0 }, // 1979: state provides all; center
      su_customs_tariff: { economic: -3, social: 0 }, // 1979: foreign trade state monopoly; very left
      su_economic_system: { economic: -3, social: 0 }, // 1979: Gosplan central planning; less intense than 1953 Stalinist peak; very left
      su_political_system: { economic: 0, social: 2 }, // 1979: SU one-party; slightly less repressive than 1953 Stalinist peak
      su_price_controls: { economic: -3, social: 0 }, // 1979: all prices state-set; maximum control
      su_agriculture: { economic: -2, social: 0 }, // 1979: collective farms; some private plot tolerance (vs 1953 peak); left
      su_civil_liberties: { economic: 0, social: 2 }, // 1979: KGB; Gulag much reduced from Stalin; dissident suppression; authoritarian (less than 1953)
      su_defense_spending: { economic: -3, social: 1 }, // 1979: arms race; Afghanistan; very high defense share; very left
      su_housing: { economic: -3, social: 0 }, // 1979: state housing (Khrushchyovka blocks); very left
    },
    optionIndexes: {
      su_enterprise_levy: 4, // 1979: below 1953's maximum 5; still high
      su_individual_income_tax: 1, // 1979: flat levy; minimal
      su_turnover_tax: 3, // 1979: below 1953's 3; stable
      su_social_insurance: 1, // 1979: unified state; same as 1953
      su_customs_tariff: 2, // 1979: foreign trade monopoly; same as 1953
      su_economic_system: 4, // 1979: Gosplan central planning; less than 1953's pure Stalinist 5
      su_political_system: 2, // 1979: one-party; less than 1953 Stalinist index 3
      su_price_controls: 3, // 1979: maximum price setting; same as 1953
      su_agriculture: 2, // 1979: collective farms; some private plots; less than 1953's 3
      su_civil_liberties: 1, // 1979: minimum civil liberties; same scale inverted (1=least free)
      su_defense_spending: 3, // 1979: Afghanistan + arms race; maximum
      su_housing: 3, // 1979: state housing; same as 1953
    },
    regions: ruRegions,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  EAST GERMANY — Honecker / SED, 1979
  //  Hard Stalinist domestic policy. Stasi (MfS) at maximum extent.
  //  Kombinat industrial system. Consumer socialism (better standard than
  //  1953). Travel restrictions (Berlin Wall). Ostmark not convertible.
  //  Helsinki Accords (1975) creating human rights pressure.
  // ═══════════════════════════════════════════════════════════════════════════
  dd: {
    nationalStateId: "dd_national",
    defaults: {
      dd_enterprise_levy: { economic: -3, social: 0 }, // 1979: VEB Kombinat enterprise remittance; command economy; very left
      dd_income_tax: { economic: 0, social: 0 }, // 1979: flat citizens' income tax; state sets wages; center
      dd_product_tax: { economic: 0, social: 0 }, // 1979: commodity tax on output; center
      dd_social_insurance: { economic: 0, social: 0 }, // 1979: comprehensive state social insurance; center
      dd_foreign_trade: { economic: -3, social: 0 }, // 1979: foreign trade state monopoly; Außenhandel; very left
      dd_economic_system: { economic: -3, social: 0 }, // 1979: central planning (Gosplan-style); Kombinat system; very left
      dd_political_system: { economic: 0, social: 2 }, // 1979: SED leading role; Honecker hard-line but less than Ulbricht 1953
      dd_price_controls: { economic: -3, social: 0 }, // 1979: all prices state-set; maximum
      dd_civil_liberties: { economic: 0, social: 2 }, // 1979: Stasi at maximum; still very authoritarian; below 1953 peak
      dd_housing: { economic: -2, social: 0 }, // 1979: state housing (Plattenbau); better supply than 1953; left
    },
    optionIndexes: {
      dd_enterprise_levy: 3, // 1979: Kombinat surplus remittance; below 1953's 4
      dd_income_tax: 1, // 1979: flat citizens' tax; minimal
      dd_product_tax: 2, // 1979: commodity tax; same as 1953
      dd_social_insurance: 1, // 1979: unified state social insurance; same
      dd_foreign_trade: 2, // 1979: foreign trade monopoly; same as 1953
      dd_economic_system: 3, // 1979: Kombinat central planning; below 1953's Stalinist 4
      dd_political_system: 3, // 1979: SED leading role; same as 1953
      dd_price_controls: 3, // 1979: maximum price regulation; same
      dd_civil_liberties: 1, // 1979: Stasi maximum; same scale (1=least free)
      dd_housing: 3, // 1979: Plattenbau mass housing; above 1953's 2
    },
    regions: ddRegions,
  },
};
