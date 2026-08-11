/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's COUNTRY_POLICY_CONFIGS. All values are authored for 1953
 * directly. Same-era imports (states1953, *Regions1953) and type-only imports are allowed.
 */

/**
 * 1953-era base policy positions per country. Calibrated to real-world 1953 policy.
 *
 *   US — Eisenhower / 83rd Congress: 92% top marginal, 52% corporate, no Medicare,
 *     high Korean War defense (~14% GDP), McCarthyism, pre-VRA Jim Crow.
 *
 *   UK — Churchill / Conservative: NHS underfunded, Korean War rearmament (~8% GDP),
 *     97.5% top marginal income tax, nationalized industries still in place (Attlee legacy).
 *
 *   DE — Adenauer / CDU (West Germany): social market economy, no Bundeswehr yet
 *     (formed 1955), Marshall Plan reconstruction, Wirtschaftswunder beginning.
 *
 *   JP — Yoshida Doctrine: <1% GDP defense, MITI-directed recovery, high corporate
 *     taxes, US Security Treaty covers defense, SDF just created 1954.
 *
 *   FR — Fourth Republic: coalition instability, PCF ~25%, Indochina War drain,
 *     dirigisme + Sécurité Sociale (1945), nationalized banks and utilities.
 *
 *   IT — De Gasperi / DC: DC hegemony, IRI/ENI state holdings, Marshall Plan,
 *     North-South divide, PCI largest communist party in Western Europe.
 *
 *   ES — Franco autarky: INI state dirigisme, Pact of Madrid (1953 US bases),
 *     no free unions, Sindicatos verticales, very low wages, Catholic corporatism.
 *
 *   SE — Erlander / SAP: folkhem welfare state under construction, high union
 *     density, Cold War neutrality, comprehensive social insurance expanding.
 *
 *   TR — Menderes / Democrat Party: first competitive election winner (1950),
 *     rural-religious axis, NATO member (1952), import-substitution development push.
 *
 *   CN — Mao / CCP: First Five-Year Plan, Soviet-model command economy, Korean War
 *     just ended, collectivization beginning, near-zero market mechanisms.
 *
 *   BR — Vargas (second term): nationalist development, Petrobras founded Oct 1953,
 *     CLT labor protections, import substitution, coffee export dominance.
 *
 *   IE — Costello / Fine Gael coalition (1953): protectionist agrarian economy,
 *     Church social dominance, neutrality, emigration crisis, minimal welfare state.
 *
 *   NG — British Crown Colony: self-governing Federation from 1954, colonial export
 *     agriculture, no oil (discovered 1956), British-administered civil service.
 *
 *   SU — Stalinist command economy → Khrushchev power struggle (post-March 1953):
 *     collective leadership, heavy industry priority, Soviet nuclear arsenal, MGB/KGB.
 *
 *   DD — Ulbricht / SED: June 17 1953 uprising suppressed, Soviet reparations,
 *     command economy, collectivization being forced, hard authoritarian state.
 */

import type { CountryPolicyConfig } from "./basePolicies";
import { states1953 } from "./states1953";
import { ukRegions1953 } from "@/lib/seeds/uk/ukRegions1953";
import { deRegions1953 } from "@/lib/seeds/de/deRegions1953";
import { jpRegions1953 } from "@/lib/seeds/jp/jpRegions1953";
import { cnRegions1953 } from "@/lib/seeds/cn/cnRegions1953";
import { ieRegions1953 } from "@/lib/seeds/ie/ieRegions1953";
import { frRegions1953 } from "@/lib/seeds/fr/frRegions1953";
import { itRegions1953 } from "@/lib/seeds/it/itRegions1953";
import { esRegions1953 } from "@/lib/seeds/es/esRegions1953";
import { seRegions1953 } from "@/lib/seeds/se/seRegions1953";
import { trRegions1953 } from "@/lib/seeds/tr/trRegions1953";
import { grRegions1953 } from "@/lib/seeds/gr/grRegions1953";
import { atRegions1953 } from "@/lib/seeds/at/atRegions1953";
import { fiRegions1953 } from "@/lib/seeds/fi/fiRegions1953";
import { ruRegions1953 } from "@/lib/seeds/ru/ruRegions1953";
import { ddRegions1953 } from "@/lib/seeds/dd/ddRegions1953";
import { brRegions1953 } from "@/lib/seeds/br/brRegions1953";
import { ngRegions1953 } from "@/lib/seeds/ng/ngRegions1953";
import { uaRegions1953 } from "@/lib/seeds/ua/uaRegions1953";
import { blrRegions1953 } from "@/lib/seeds/blr/blrRegions1953";
import { balRegions1953 } from "@/lib/seeds/bal/balRegions1953";
import { plRegions1953 } from "@/lib/seeds/pl/plRegions1953";
import { huRegions1953 } from "@/lib/seeds/hu/huRegions1953";
import { roRegions1953 } from "@/lib/seeds/ro/roRegions1953";
import { bgRegions1953 } from "@/lib/seeds/bg/bgRegions1953";
import { csRegions1953 } from "@/lib/seeds/cs/csRegions1953";
import { yuRegions1953 } from "@/lib/seeds/yu/yuRegions1953";
import {
  easternBlocPolicyConfig1953,
  easternBlocSpendingPolicyConfig1953,
} from "@/lib/seeds/shared/easternBlocLegislation";

export const COUNTRY_POLICY_CONFIGS_1953: Record<string, CountryPolicyConfig> = {
  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED STATES — Eisenhower administration, 1953 (83rd Congress)
  // ═══════════════════════════════════════════════════════════════════════════
  us: {
    nationalStateId: "federal",
    defaults: {
      // ── Education ──────────────────────────────────────────────────────────
      us_federal_education_funding: { economic: 1, social: 0 }, // 1953: no federal K-12 funding; states pay all; right of center
      us_federal_science_funding: { economic: 0, social: 0 }, // 1953: NSF created 1950; defense R&D via DoD; center
      us_school_standards: { economic: 1, social: 1 }, // 1953: entirely local control; pre-standards movement; right
      // ── Healthcare ─────────────────────────────────────────────────────────
      us_federal_healthcare_funding: { economic: 1, social: 0 }, // 1953: no Medicare/Medicaid; VA only; right
      us_drug_pricing_medicare: { economic: 1, social: 0 }, // 1953: no Medicare drug benefit; free-market pricing; right
      us_public_health: { economic: 0, social: 0 }, // 1953: CDC/NIH baseline; polio epidemic ongoing; center
      // ── Environment ────────────────────────────────────────────────────────
      us_clean_energy: { economic: 1, social: 0 }, // 1953: coal and oil dominant; no EPA; right
      us_conservation: { economic: 0, social: 0 }, // 1953: CCC legacy but no modern enviro law; center
      // ── Economy ────────────────────────────────────────────────────────────
      us_federal_income_tax_rate: { economic: -2, social: 0 }, // 1953: 92% top marginal rate — far left of any later era
      us_federal_domestic_corporate_tax_rate: { economic: -2, social: 0 }, // 1953: 52% statutory corporate rate — far left
      us_federal_foreign_corporate_tax_rate: { economic: -1, social: 0 }, // 1953: proportional to very high domestic rate
      us_federal_payroll_tax_rate: { economic: 0, social: 0 }, // 1953: combined OASDI+HI ≈ 3.0% — very low
      us_federal_tariff_rate: { economic: 0, social: 0 }, // 1953: GATT era; relatively low tariffs; center
      us_federal_sales_tax_rate: { economic: 0, social: 0 }, // 1953: no federal sales tax
      us_federal_spending_stimulus: { economic: 0, social: 0 }, // 1953: Eisenhower balanced-budget conservatism; center
      us_transportation: { economic: 1, social: 0 }, // 1953: pre-Interstate; no federal highway investment yet; right
      us_broadband_energy: { economic: 1, social: 0 }, // 1953: no broadband; coal/oil energy; right
      us_minimum_wage: { economic: 0, social: 0 }, // 1953: $0.75/hr minimum wage (1950); center
      us_workforce_development: { economic: 0, social: 0 }, // 1953: no CETA; GI Bill winding down; center
      us_housing: { economic: -1, social: 0 }, // 1953: FHA/VA mortgages + Levittown suburban boom; left
      us_food_nutrition: { economic: 1, social: 0 }, // 1953: no food stamps yet (FSEP started 1961); right
      // ── Safety Net ─────────────────────────────────────────────────────────
      us_social_security: { economic: 0, social: 0 }, // 1953: 1950/1952 expansions; Eisenhower expanded further; center
      us_medicaid: { economic: 1, social: 0 }, // 1953: no Medicaid (1965); right
      us_medicaid_expansion: { economic: 1, social: 0 }, // 1953: no Medicaid at all; right
      // ── Law & Justice ──────────────────────────────────────────────────────
      us_law_enforcement_criminal_justice: { economic: 1, social: 1 }, // 1953: McCarthy era; anti-communist enforcement; right
      us_prison_rehabilitation: { economic: 1, social: 1 }, // 1953: punitive; rehabilitation ideal nascent; right
      // ── Defense & Foreign ──────────────────────────────────────────────────
      us_defense_spending: { economic: -2, social: 0 }, // 1953: Korean War + NATO; ~14% GDP; very high (far left on spending)
      us_foreign_policy: { economic: -1, social: 1 }, // 1953: internationalist Republicanism; NATO; anti-communist; center-right
      // ── Immigration ────────────────────────────────────────────────────────
      us_border_security_enforcement: { economic: 1, social: 1 }, // 1953: "Operation Wetback" (1954); restrictionist; right
      us_legal_immigration_visas: { economic: 1, social: 1 }, // 1953: McCarran-Walter Act (1952); quota system; right
      // ── Social ─────────────────────────────────────────────────────────────
      us_reproductive_rights: { economic: 0, social: 2 }, // 1953: Roe is 20 years away; abortion mostly illegal; very right
      us_paid_family_leave: { economic: 1, social: 1 }, // 1953: no leave law; right
      us_gun_control: { economic: 0, social: 1 }, // 1953: NFA (1934) baseline; no GCA-68 yet; right-of-center
      // ── Governance ─────────────────────────────────────────────────────────
      us_government_ethics: { economic: 1, social: 1 }, // 1953: McCarthy era; executive secrecy; right
      us_civics_voting_rights: { economic: 1, social: 2 }, // 1953: Jim Crow legal; poll taxes; VRA 12 years away; far right
      us_media_communications: { economic: -1, social: 0 }, // 1953: Fairness Doctrine + AT&T monopoly in force; left
      us_emergency_services: { economic: 0, social: 0 }, // 1953: pre-FEMA; civil defense focus; center
    },
    optionIndexes: {
      us_federal_income_tax_rate: 7, // 92% top marginal rate — highest in US history; above 1979's 70% (index 6)
      us_federal_domestic_corporate_tax_rate: 10, // 52% statutory in 1953 — highest in era set; above 1979's 46% (index 9)
      us_federal_foreign_corporate_tax_rate: 8, // proportional to the very high domestic rate; above 1979 (index 7)
      us_federal_payroll_tax_rate: 1, // combined OASDI ≈ 3.0% in 1953 (far below 12.26% in 1979; index 4)
      us_federal_tariff_rate: 0, // 0% game baseline; GATT era
      us_federal_sales_tax_rate: 0, // 0% — no federal sales tax
      us_social_security: 3, // 1953: benefit levels lower; coverage narrower; below 1979's index 5
      // Korean War peak (~14% GDP): maximum peacetime ladder rung. (Political-
      // legislation v2 owns day-one spending on 1953-default; this pins any
      // legacy matching path / non-v2 tooling that still reads optionIndexes.)
      us_defense_spending: 6,
      // Pre-Medicare/Medicaid: VA-only federal healthcare → cheapest right rung.
      us_federal_healthcare_funding: 6,
      us_medicaid: 6,
      us_medicaid_expansion: 6,
    },
    regions: states1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  UNITED KINGDOM — Churchill / Conservative government, 1953
  //  Korean War rearmament; NHS newly established but chronically underfunded;
  //  97.5% top income tax rate; Attlee-era nationalization still intact.
  // ═══════════════════════════════════════════════════════════════════════════
  uk: {
    nationalStateId: "uk_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      uk_nhs_funding: { economic: 1, social: 0 }, // 1953: NHS (est. 1948) chronically underfunded; dentistry charges introduced 1952; Conservative cuts
      uk_social_care: { economic: 1, social: 0 }, // 1953: minimal state social care; Poor Law institutions still transitioning
      uk_mental_health: { economic: 0, social: 1 }, // 1953: mental hospitals (asylums); community care not yet on agenda; conservative
      uk_public_health: { economic: 0, social: 0 }, // 1953: NHS baseline; Great Smog 1952 still fresh; center
      // ── Education ──────────────────────────────────────────────────────────
      uk_tuition_fees: { economic: 0, social: 0 }, // 1953: no tuition fees (grants available); university expansion just beginning
      uk_education_standards: { economic: 0, social: 1 }, // 1953: 11+ exam system; grammar schools; selective and conservative
      uk_education_funding: { economic: 1, social: 0 }, // 1953: tight Treasury control; Conservative austerity
      uk_research_science: { economic: 0, social: 0 }, // 1953: MRC/DSIR active; Watson-Crick DNA discovery 1953; center
      // ── Economic ───────────────────────────────────────────────────────────
      uk_fiscal_spending: { economic: 1, social: 0 }, // 1953: balance-of-payments crisis; "Robot" plan (failed); tight fiscal stance
      uk_local_government_funding: { economic: 0, social: 0 }, // 1953: rates system; local authorities have substantial roles
      // ── Infrastructure ─────────────────────────────────────────────────────
      uk_transport_rail: { economic: -1, social: 0 }, // 1953: British Railways nationalized (1948); massive rail network; state investment
      uk_energy_grid: { economic: -1, social: 0 }, // 1953: British Electricity Authority nationalized (1948); coal-dominated; state-run
      // ── Environment ────────────────────────────────────────────────────────
      uk_climate_net_zero: { economic: 0, social: 0 }, // 1953: no climate framework; coal dominant; center by default
      uk_north_sea_energy: { economic: 0, social: 0 }, // 1953: North Sea not yet drilled (first production 1969); no policy exists
      // ── Law & Justice ──────────────────────────────────────────────────────
      uk_policing_crime: { economic: 0, social: 1 }, // 1953: traditional policing; capital punishment in force; conservative
      uk_prison_rehabilitation: { economic: 0, social: 1 }, // 1953: punitive; rehabilitation ideal nascent
      // ── Defence ────────────────────────────────────────────────────────────
      uk_defence_spending: { economic: -2, social: 0 }, // 1953: Korean War rearmament; ~8% GDP; very high spending
      uk_trident_defence: { economic: -1, social: 0 }, // 1953: nuclear weapons programme (first UK bomb tested 1952); high priority
      // ── Foreign Policy ─────────────────────────────────────────────────────
      uk_foreign_policy: { economic: -1, social: 0 }, // 1953: NATO; Commonwealth; "special relationship" with US; Korean War
      // ── Welfare ────────────────────────────────────────────────────────────
      uk_universal_credit: { economic: 0, social: 0 }, // 1953: National Insurance (Beveridge 1942 → 1948); predecessor welfare
      uk_state_pensions: { economic: 0, social: 0 }, // 1953: National Insurance pensions established; modest benefit levels
      uk_childcare: { economic: 1, social: 0 }, // 1953: minimal state childcare; family/Church-reliant
      // ── Immigration ────────────────────────────────────────────────────────
      uk_immigration_asylum: { economic: 0, social: 1 }, // 1953: British Nationality Act 1948 opened Commonwealth immigration; Empire Windrush era; but tightening sentiment
      uk_work_visas: { economic: 0, social: 0 }, // 1953: Commonwealth citizens free entry (no visa requirement yet)
      // ── Labour ─────────────────────────────────────────────────────────────
      uk_workers_rights: { economic: -1, social: 0 }, // 1953: strong trade unions; TUC at peak power; high union density ~45%
      uk_workforce_development: { economic: 0, social: 0 }, // 1953: apprenticeship tradition; no formal training agencies
      // ── Housing ────────────────────────────────────────────────────────────
      uk_housing_planning: { economic: -1, social: 0 }, // 1953: massive council house building programme (Macmillan: 300,000/year target); left
      uk_leasehold_reform: { economic: 0, social: 0 }, // 1953: leasehold system unchanged; no reform
      // ── Governance ─────────────────────────────────────────────────────────
      uk_devolution_local_powers: { economic: 1, social: 0 }, // 1953: pre-devolution; Westminster supremacy; centralized
      uk_government_ethics: { economic: 0, social: 0 }, // 1953: Profumo scandal not yet; Westminster conventions respected
      uk_electoral_reform: { economic: 0, social: 0 }, // 1953: FPTP unchallenged; no PR debate
      // ── Media ──────────────────────────────────────────────────────────────
      uk_bbc_public_media: { economic: -1, social: 0 }, // 1953: BBC monopoly; ITV not yet launched (1955); public broadcaster dominant
      uk_digital_broadband: { economic: 0, social: 0 }, // 1953: no digital; radio and nascent television era
      // ── Civil Liberties ────────────────────────────────────────────────────
      uk_surveillance_privacy: { economic: 0, social: 1 }, // 1953: MI5 active; anti-communist surveillance; Cold War intelligence
      uk_drug_policy: { economic: 0, social: 1 }, // 1953: Dangerous Drugs Act framework; conservative
    },
    optionIndexes: {
      uk_income_tax_rate: 9, // 1953: 97.5% top marginal — highest in British history; higher than 1991's 25% basic
      uk_national_insurance: 3, // 1953: flat-rate Beveridge NI contributions; lower than 1991
      uk_vat: 0, // 1953: no VAT (introduced 1973); Purchase Tax existed but different structure
      uk_excise_customs: 0, // 0% game baseline
      uk_domestic_corporation_tax: 7, // 1953: standard profits tax ~50%; high by any later standard
      uk_foreign_corporation_tax: 6, // day-one parity below domestic
      uk_nhs_funding: 2, // 1953: low NHS funding (underfunded in first years)
      uk_tuition_fees: 0, // 1953: no tuition fees; grants available
      uk_state_pensions: 2, // 1953: modest flat-rate Beveridge pension
      uk_fiscal_spending: 2, // 1953: tight austerity stance; below 1991
      // Korean War / NATO rearmament (~8% GDP). Legacy ladder only — v2 owns
      // day-one UK spending on 1953-default.
      uk_defence_spending: 6,
    },
    regions: ukRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  WEST GERMANY — Adenauer / CDU, 1953 (Wirtschaftswunder)
  //  Social market economy; no military yet; Marshall Plan reconstruction;
  //  high growth beginning; Ordoliberal framework.
  // ═══════════════════════════════════════════════════════════════════════════
  de: {
    nationalStateId: "de_national",
    defaults: {
      de_income_tax_rate: { economic: -1, social: 0 }, // 1953: high progressive income tax (~85% top marginal); left of center
      de_solidarity_surcharge: { economic: 0, social: 0 }, // 1953: no Soli (introduced 1991); placeholder center
      de_vat_rate: { economic: 0, social: 0 }, // 1953: no VAT yet (Umsatzsteuer turnover tax instead, introduced as VAT 1968)
      de_domestic_corporate_tax_rate: { economic: -1, social: 0 }, // 1953: ~60% corporate tax rate; high reconstruction era
      de_foreign_corporate_tax_rate: { economic: -1, social: 0 }, // day-one parity
      de_payroll_social_insurance: { economic: -1, social: 0 }, // 1953: Bismarckian social insurance expanding; moderate
      de_defence_spending: { economic: 0, social: 0 }, // 1953: no Bundeswehr yet (formed 1955); zero defense spending; center
      de_nhs_equivalent: { economic: -1, social: 0 }, // 1953: comprehensive Krankenversicherung (statutory health insurance); left
      de_welfare_state: { economic: -1, social: 0 }, // 1953: Soziale Marktwirtschaft; generous social insurance; left of center
      de_education_funding: { economic: -1, social: 0 }, // 1953: Länder control education; strong investment in technical schools
      de_infrastructure: { economic: -1, social: 0 }, // 1953: massive reconstruction investment; Marshall Plan funds; left
      de_housing: { economic: -1, social: 0 }, // 1953: massive social housing construction; Sozialer Wohnungsbau; left
    },
    optionIndexes: {
      de_income_tax: 8, // 1953: ~85% top marginal rate; very high vs 1991's 53% (index 7)
      de_solidarity_surcharge: 0, // 1953: no Soli; zero index
      de_vat: 0, // 1953: no VAT; turnover tax system
      de_domestic_corporate_tax: 9, // 1953: ~60% vs 1991's 50% (index 9 same); very high reconstruction-era rate
      de_foreign_corporate_tax: 8, // day-one below domestic
      de_payroll_social_insurance: 4, // 1953: lower than 1991; social insurance still building
      // Pre-Bundeswehr: near-zero standing military (occupation-cost residual only).
      de_bundeswehr_funding: 0,
    },
    regions: deRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  JAPAN — Yoshida Doctrine, post-Occupation, 1953
  //  Minimal defense (<1% GDP); MITI-directed recovery; high corporate taxes;
  //  US Security Treaty provides defense umbrella; SDF created 1954.
  // ═══════════════════════════════════════════════════════════════════════════
  jp: {
    nationalStateId: "jp_national",
    defaults: {
      // ── Healthcare ─────────────────────────────────────────────────────────
      jp_national_health_insurance: { economic: 1, social: 0 }, // 1953: national health insurance not yet universal (extended to all 1961); right of center
      jp_elder_care: { economic: 1, social: 0 }, // 1953: family-based care; no state elder care system
      jp_mental_health: { economic: 0, social: 1 }, // 1953: stigma high; mental hospitals dominant; conservative
      jp_public_health: { economic: 0, social: 0 }, // 1953: rebuilding public health infrastructure; center
      // ── Education ──────────────────────────────────────────────────────────
      jp_education_funding: { economic: -1, social: 0 }, // 1953: massive education investment; Compulsory Education Law; left
      jp_university_tuition: { economic: 1, social: 0 }, // 1953: high tuition; no subsidies; right
      jp_academic_reform: { economic: 0, social: 0 }, // 1953: post-occupation curriculum reforms settling; center
      jp_research_science: { economic: -1, social: 0 }, // 1953: heavy R&D push under MITI guidance; left
      // ── Defense & Security ─────────────────────────────────────────────────
      jp_article9_sdf: { economic: 0, social: -1 }, // 1953: Article 9 strictly interpreted; Yoshida resists rearmament; left
      jp_defense_spending: { economic: 0, social: 0 }, // 1953: <1% GDP; US treaty covers defense; center (by Japanese standards)
      jp_cybersecurity: { economic: 0, social: 0 }, // 1953: no cyber framework; center by default
      // ── Economic ───────────────────────────────────────────────────────────
      jp_fiscal_stimulus: { economic: -2, social: 0 }, // 1953: MITI-directed heavy industrial investment; massive state coordination; very left
      jp_minimum_wage: { economic: 0, social: 0 }, // 1953: no national minimum wage (introduced 1959); center
      jp_labor_reform: { economic: 0, social: 0 }, // 1953: early postwar labor law; permanent employment norm emerging
      jp_sme_support: { economic: -1, social: 0 }, // 1953: MITI SME guidance; subsidies; left
      jp_local_allocation_tax: { economic: 0, social: 0 }, // 1953: fiscal transfers beginning; center
      // ── Infrastructure ─────────────────────────────────────────────────────
      jp_disaster_preparedness: { economic: 0, social: 0 }, // 1953: post-war rebuilding; typhoon/earthquake preparedness; center
      jp_rail_transport: { economic: -2, social: 0 }, // 1953: Japanese National Railways dominant; massive rail investment; very left
      jp_digital_infrastructure: { economic: 0, social: 0 }, // 1953: no digital infrastructure; center
      // ── Environment & Energy ───────────────────────────────────────────────
      jp_nuclear_energy: { economic: 0, social: 0 }, // 1953: no civilian nuclear program yet (Atomic Energy Basic Law 1955); center
      jp_climate_emissions: { economic: 0, social: 0 }, // 1953: no climate framework; center
      jp_renewable_energy: { economic: 0, social: 0 }, // 1953: minimal renewables; coal/hydropower dominant; center
      // ── Social Policy ──────────────────────────────────────────────────────
      jp_family_policy: { economic: 1, social: 1 }, // 1953: traditional family model; patriarchal household system (ie)
      jp_pension: { economic: 1, social: 0 }, // 1953: National Pension not yet (introduced 1961); company-based pensions; right
      jp_gender_equality: { economic: 1, social: 2 }, // 1953: New Constitution (1947) formal equality but deeply patriarchal in practice; right
      jp_work_culture_reform: { economic: 0, social: 1 }, // 1953: long working hours; loyalty culture; conservative
      // ── Immigration ────────────────────────────────────────────────────────
      jp_foreign_worker_policy: { economic: 1, social: 2 }, // 1953: essentially closed to foreign workers; homogeneous society norm
      jp_visa_residency: { economic: 0, social: 1 }, // 1953: restrictive; center-right
      jp_integration_programs: { economic: 0, social: 0 }, // 1953: minimal; center
      // ── Agriculture ────────────────────────────────────────────────────────
      jp_agricultural_subsidies: { economic: -2, social: 0 }, // 1953: heavy rice subsidies; land reform just completed; food self-sufficiency obsession; very left
      jp_food_security: { economic: 0, social: 1 }, // 1953: autarky aspiration post-WWII starvation experience; conservative
      jp_rural_development: { economic: -1, social: 0 }, // 1953: significant rural investment; LDP rural base forming; left
      // ── Governance ─────────────────────────────────────────────────────────
      jp_constitutional_reform: { economic: 0, social: 0 }, // 1953: MacArthur constitution (1947) fresh; no reform agenda yet
      jp_regional_autonomy: { economic: 0, social: 0 }, // 1953: post-occupation decentralization; center
      jp_electoral_reform: { economic: 0, social: 0 }, // 1953: SNTV system; no reform
      // ── Foreign Policy / Trade ─────────────────────────────────────────────
      jp_foreign_aid_diplomacy: { economic: 0, social: 0 }, // 1953: Japan recipient of aid; not yet a donor; center
      jp_trade_agreements: { economic: -1, social: 0 }, // 1953: MITI export-promotion; bilateral deals; protectionist core
      // ── Technology ─────────────────────────────────────────────────────────
      jp_robotics_ai: { economic: 0, social: 0 }, // 1953: no robotics industry; center
      jp_rd_investment: { economic: -1, social: 0 }, // 1953: MITI R&D direction; heavy investment in steel/shipbuilding/chemicals
      jp_digital_governance: { economic: 0, social: 0 }, // 1953: no digital government; center
      // ── Public Safety ──────────────────────────────────────────────────────
      jp_policing_public_safety: { economic: 0, social: 1 }, // 1953: National Police Agency (est. 1954); conservative policing
      jp_criminal_justice: { economic: 0, social: 1 }, // 1953: same hostage-justice norms; conservative
    },
    optionIndexes: {
      jp_income_tax_rate: 9, // 1953: top bracket ~85% (very high postwar rate); above 1991's 7
      jp_domestic_corporation_tax: 9, // 1953: ~55-60% combined corporate rate; reconstruction-era burden
      jp_foreign_corporation_tax: 7, // day-one parity below domestic
      jp_social_insurance: 2, // 1953: very low combined social insurance; welfare state nascent
      jp_consumption_tax: 0, // 1953: no consumption tax (introduced 1989 at 3%)
      jp_resident_tax: 4, // 1953: local residence tax; lower than 1991's index 5
      jp_fixed_asset_tax: 5, // 1953: roughly stable rate
      jp_customs_tariff: 0, // 0% game baseline
      // Article 9 / Yoshida Doctrine: SDF nascent, <1% GNP — keep the low rung.
      jp_defense_spending: 0,
      jp_article9_sdf: 0,
    },
    regions: jpRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  FRANCE — Fourth Republic, 1953
  //  Unstable coalitions; PCF ~25% vote; Indochina War draining budget;
  //  dirigisme + Sécurité Sociale; nationalized banks and utilities.
  // ═══════════════════════════════════════════════════════════════════════════
  fr: {
    nationalStateId: "fr_national",
    defaults: {
      fr_income_tax: { economic: -1, social: 0 }, // 1953: high progressive income tax; strong left-PCF influence on tax policy
      fr_corporate_tax: { economic: -1, social: 0 }, // 1953: high corporate taxes; dirigiste state
      fr_vat: { economic: 0, social: 0 }, // 1953: early TVA system (France introduced VAT 1954 — nascent); center
      fr_social_charges: { economic: -1, social: 0 }, // 1953: Sécurité Sociale (1945) — comprehensive cotisations; left
      fr_customs_tariff: { economic: -1, social: 0 }, // 1953: protectionist trade; GATT member but high tariffs; left
      fr_nationalization: { economic: -2, social: 0 }, // 1953: banks, utilities, Renault, Air France nationalized; dirigisme; very left
      fr_labor_law: { economic: -2, social: 0 }, // 1953: strong CGT; Code du Travail; left militant labor; very left
      fr_welfare_state: { economic: -1, social: 0 }, // 1953: Sécurité Sociale comprehensive but underfunded; Indochina drains resources
      fr_health_insurance: { economic: -1, social: 0 }, // 1953: standard hospital/reimbursement policy
      fr_education_funding: { economic: -1, social: 0 }, // 1953: standard Éducation Nationale funding
      fr_infrastructure_investment: { economic: -1, social: 0 }, // 1953: the Monnet Plan's standard investment level
      fr_defense_appropriations: { economic: 0, social: 0 }, // 1953: standing appropriation, Indochina War at peak
      fr_economic_subsidies: { economic: -1, social: 0 }, // 1953: standard subsidies to nationalized sector + farms
      fr_local_grants: { economic: -1, social: 0 }, // 1953: standard transfer to départements/communes
    },
    optionIndexes: {
      fr_income_tax: 4, // 1953: high progressive rate; above 1979's 3
      fr_corporate_tax: 4, // 1953: high; dirigiste state
      fr_vat: 1, // 1953: nascent TVA; low index (pre-1954 introduction)
      fr_social_charges: 2, // 1953: Sécurité Sociale cotisations; moderate-high
      fr_customs_tariff: 2, // 1953: protectionist; above 1979's 1
      fr_nationalization: 3, // 1953: maximum state ownership; banks/utilities/key industry all nationalized
      fr_labor_law: 2, // 1953: strong labor code; left
      fr_welfare_state: 2, // 1953: comprehensive but underfunded
      fr_health_insurance: 2, // 1953: standard Politique Hospitalière Act
      fr_education_funding: 2, // 1953: standard Éducation Nationale Act
      fr_infrastructure_investment: 2, // 1953: standard Monnet Plan investment
      fr_defense_appropriations: 2, // 1953: standard appropriation (Indochina War peak)
      fr_economic_subsidies: 2, // 1953: standard Subventions Économiques Act
      fr_local_grants: 2, // 1953: standard Dotation aux Collectivités Locales
    },
    regions: frRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  ITALY — De Gasperi / Christian Democracy, 1953
  //  DC hegemony; IRI/ENI state holdings; Marshall Plan reconstruction;
  //  North-South divide; PCI largest communist party in Western Europe.
  // ═══════════════════════════════════════════════════════════════════════════
  it: {
    nationalStateId: "it_national",
    defaults: {
      it_income_tax: { economic: 0, social: 0 }, // 1953: pre-IRPEF unified tax (introduced 1974); patchwork taxes; center
      it_corporate_tax: { economic: -1, social: 0 }, // 1953: high business taxes; reconstruction era; left of center
      it_vat: { economic: 0, social: 0 }, // 1953: no VAT (introduced 1973); IGE turnover tax; center
      it_social_charges: { economic: -1, social: 0 }, // 1953: growing INPS contributions; center-left
      it_customs_tariff: { economic: 0, social: 0 }, // 1953: transitioning; EEC founding anticipated 1957; center
      it_state_holdings: { economic: -3, social: 0 }, // 1953: IRI (1933) + ENI (1953 Mattei) — massive state enterprise; very left
      it_labor_law: { economic: -1, social: 0 }, // 1953: CGIL/CISL/UIL unions strong; pre-Statuto dei Lavoratori (1970); left
      it_welfare_state: { economic: -1, social: 0 }, // 1953: INPS pensions; nascent welfare state; north-south gap; left of center
      it_health_insurance: { economic: -1, social: 0 }, // 1953: standard INAM mutue funding
      it_education_funding: { economic: -1, social: 0 }, // 1953: standard Istruzione Pubblica funding
      it_infrastructure_investment: { economic: -1, social: 0 }, // 1953: standard Cassa per il Mezzogiorno investment
      it_defense_appropriations: { economic: 0, social: 0 }, // 1953: standard NATO-aligned appropriation
      it_economic_subsidies: { economic: -1, social: 0 }, // 1953: standard IRI/ENI operating subsidies
      it_local_grants: { economic: -1, social: 0 }, // 1953: standard transfer to comuni/province
    },
    optionIndexes: {
      it_income_tax: 3, // 1953: patchwork tax system; center
      it_corporate_tax: 3, // 1953: moderate-high
      it_vat: 0, // 1953: no VAT; IGE turnover tax only
      it_social_charges: 2, // 1953: INPS contributions growing
      it_customs_tariff: 1, // 1953: protective but preparing for EEC
      it_state_holdings: 3, // 1953: maximum IRI/ENI state ownership — peak nationalization
      it_labor_law: 2, // 1953: left labor code; pre-Statuto
      it_welfare_state: 2, // 1953: nascent; north has more than south
      it_health_insurance: 2, // 1953: standard Assicurazione Malattia (INAM) Act
      it_education_funding: 2, // 1953: standard Istruzione Pubblica Act
      it_infrastructure_investment: 2, // 1953: standard Cassa per il Mezzogiorno Act
      it_defense_appropriations: 2, // 1953: standard Difesa Nazionale Act
      it_economic_subsidies: 2, // 1953: standard Sovvenzioni IRI/ENI Act
      it_local_grants: 2, // 1953: standard Finanza Locale Act
    },
    regions: itRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SPAIN — Franco dictatorship, autarky, 1953
  //  INI state dirigisme; Pact of Madrid with US (September 1953);
  //  no free unions (Sindicatos verticales); Catholic corporatism.
  // ═══════════════════════════════════════════════════════════════════════════
  es: {
    nationalStateId: "es_national",
    defaults: {
      es_income_tax: { economic: 0, social: 0 }, // 1953: low and poorly collected income tax; autarky distorts everything; center by default
      es_corporate_tax: { economic: -1, social: 0 }, // 1953: INI state companies dominate; high effective state take; left of center
      es_consumption_tax: { economic: 0, social: 0 }, // 1953: no IVA (introduced 1986); various consumption levies; center
      es_social_charges: { economic: 0, social: 0 }, // 1953: Seguridad Social embryonic; Francoist vertical syndicates manage some benefits; center
      es_customs_tariff: { economic: -2, social: 0 }, // 1953: extreme autarky; very high protective tariffs; very left (protectionist)
      es_state_holdings: { economic: -3, social: 0 }, // 1953: INI (Instituto Nacional de Industria) controls vast swaths of economy; very left
      es_labor_law: { economic: -3, social: 2 }, // 1953: Sindicatos verticales (Francoist state unions); no free collective bargaining; authoritarian-left economic, authoritarian-right social
      es_welfare_state: { economic: 0, social: 1 }, // 1953: minimal welfare; Catholic charities fill gaps; autarky poverty; conservative
    },
    optionIndexes: {
      es_income_tax: 1, // 1953: very low/ineffective income tax collection
      es_corporate_tax: 3, // 1953: INI companies; moderate effective rate
      es_consumption_tax: 1, // 1953: minimal; pre-IVA
      es_social_charges: 1, // 1953: minimal Seguridad Social
      es_customs_tariff: 4, // 1953: maximum protection; autarky maximum
      es_state_holdings: 3, // 1953: INI at maximum state ownership
      es_labor_law: 3, // 1953: Sindicatos verticales — state-corporatist labor control
      es_welfare_state: 1, // 1953: very minimal welfare; Church-reliant
    },
    regions: esRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SWEDEN — Erlander / Social Democrats, 1953
  //  Folkhem welfare state under construction; high union density;
  //  Cold War neutrality; comprehensive social insurance expanding.
  // ═══════════════════════════════════════════════════════════════════════════
  se: {
    nationalStateId: "se_national",
    defaults: {
      se_income_tax: { economic: -1, social: 0 }, // 1953: high progressive income tax; SAP building revenue base; left
      se_corporate_tax: { economic: 0, social: 0 }, // 1953: moderate corporate tax; SAP supports investment; center
      se_vat: { economic: 0, social: 0 }, // 1953: no VAT (Swedish Moms introduced 1969); general sales tax nascent; center
      se_social_charges: { economic: -1, social: 0 }, // 1953: growing arbetsgivaravgift; welfare state funding; left
      se_customs_tariff: { economic: 0, social: 0 }, // 1953: moderate; GATT member; not protectionist but not open; center
      se_wage_earner_funds: { economic: 1, social: 0 }, // 1953: private ownership dominant; Meidner plan not until 1970s; right (for now)
      se_labor_law: { economic: -2, social: 0 }, // 1953: SAP-LO nexus; collective bargaining dominant; Saltsjöbaden agreement; very left
      se_welfare_state: { economic: -2, social: 0 }, // 1953: folkhem under active construction; universal social insurance being built; very left
      se_health_insurance: { economic: -1, social: 0 }, // 1953: standard Sjukförsäkring/county-council funding
      se_education_funding: { economic: -1, social: 0 }, // 1953: standard Folkskolan funding
      se_infrastructure_investment: { economic: -1, social: 0 }, // 1953: standard hydropower/road investment
      se_defense_appropriations: { economic: 0, social: 0 }, // 1953: standard armed-neutrality appropriation
      se_economic_subsidies: { economic: -1, social: 0 }, // 1953: standard export-industry/agriculture subsidies
      se_local_grants: { economic: -1, social: 0 }, // 1953: standard transfer to kommuner/landsting
    },
    optionIndexes: {
      // se_income_tax/se_social_charges corrected from idx4/idx2 to the
      // ladder's own CENTER "standard" bracket (idx3 "the standard steep
      // progressive schedule" 60%; idx1 "the standard high employer fees" 33%)
      // — fiscal-scale audit, 2026-07-28. The prior picks (idx4 "Solidarity
      // Surtax Act" 75%, idx2 "Expanded Welfare Act" 45%) are each ONE STEP
      // LEFT of "standard," i.e. already at the 1979-mature-welfare-state
      // bracket the option's own name describes — inconsistent with this
      // country's "folkhem under active construction" (not yet built) 1953
      // framing. Combined with SE's high taxBaseRatios (0.42 income / 0.45
      // wages), the two aggressive picks alone produced ~45% of GDP in
      // income+payroll receipts, driving a $200B+/23%-of-GDP day-1 surplus
      // (verified via getInitialNationalBudgetsForPreset("1953-default")).
      // The standard brackets land revenue ≈48% of GDP against the unchanged
      // 36.8%-of-GDP spend — an ≈11% of GDP surplus, not >20%.
      se_income_tax: 3, // 1953: "the standard steep progressive schedule" (60%)
      se_corporate_tax: 3, // 1953: moderate; center
      se_vat: 0, // 1953: no Moms (VAT); sales tax system
      se_social_charges: 1, // 1953: "the standard high employer fees" (33%)
      se_customs_tariff: 1, // 1953: moderate; GATT aligned
      se_wage_earner_funds: 2, // 1953: status quo — private ownership (Meidner plan is 1970s)
      se_labor_law: 2, // 1953: strong Saltsjöbaden corporatism
      se_welfare_state: 3, // 1953: welfare state being built; below 1979 maturity
      se_health_insurance: 2, // 1953: standard Sjukförsäkring Act
      se_education_funding: 2, // 1953: standard Folkskolan Act
      se_infrastructure_investment: 2, // 1953: standard Vattenkraft och Väg Act
      se_defense_appropriations: 2, // 1953: standard Försvarsbeslutet Act
      se_economic_subsidies: 2, // 1953: standard Industristöd Act
      se_local_grants: 2, // 1953: standard Statsbidrag till Kommuner Act
    },
    regions: seRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TURKEY — Menderes / Democrat Party, 1953
  //  Rural-religious axis; NATO member (1952); Korean War participation;
  //  import-substitution development; state-led infrastructure.
  // ═══════════════════════════════════════════════════════════════════════════
  gr: {
    nationalStateId: "gr_national",
    defaults: {
      gr_income_tax: { economic: 0, social: 0 }, // 1953: narrow tax base; agrarian smallholder economy
      gr_corporate_tax: { economic: 0, social: 0 }, // 1953: reconstruction-era rates
      gr_sales_tax: { economic: 0, social: 0 }, // 1953: turnover/stamp levies
      gr_social_charges: { economic: 0, social: 0 }, // 1953: IKA (est. 1937) still narrow
      gr_customs_tariff: { economic: -1, social: 0 }, // 1953: heavy postwar protection
      gr_state_enterprises: { economic: -1, social: 0 }, // 1953: state banks + reconstruction agencies steer credit; left
      gr_labor_law: { economic: 0, social: 1 }, // 1953: unions constrained after the civil war
      gr_welfare_state: { economic: 0, social: 1 }, // 1953: rudimentary welfare; rural clientelism
      gr_health_insurance: { economic: 0, social: 0 }, // 1953: standard IKA clinic/hospital funding
      gr_education_funding: { economic: 0, social: 0 }, // 1953: standard national-education funding
      gr_infrastructure_investment: { economic: 0, social: 0 }, // 1953: standard DEI reconstruction investment
      gr_defense_appropriations: { economic: 0, social: 0 }, // 1953: standard post-civil-war NATO appropriation
      gr_economic_subsidies: { economic: 0, social: 0 }, // 1953: standard agricultural/industrial subsidies
      gr_local_grants: { economic: 0, social: 0 }, // 1953: standard transfer to dimoi/koinotites
    },
    optionIndexes: {
      gr_income_tax: 2,
      gr_corporate_tax: 3,
      gr_sales_tax: 2,
      gr_social_charges: 1,
      gr_customs_tariff: 3,
      gr_state_enterprises: 2,
      gr_labor_law: 2,
      gr_welfare_state: 2,
      gr_health_insurance: 2, // 1953: standard IKA Health Services Act
      gr_education_funding: 2, // 1953: standard National Education Act
      gr_infrastructure_investment: 2, // 1953: standard DEI Reconstruction Act
      gr_defense_appropriations: 2, // 1953: standard National Defense Act
      gr_economic_subsidies: 2, // 1953: standard Agricultural and Industrial Subsidies Act
      gr_local_grants: 2, // 1953: standard Municipal Grants Act
    },
    regions: grRegions1953,
  },

  at: {
    nationalStateId: "at_national",
    defaults: {
      at_income_tax: { economic: 0, social: 0 }, // 1953: steep reconstruction-era schedule
      at_corporate_tax: { economic: 0, social: 0 }, // 1953: Raab-Kamitz consolidation rates
      at_sales_tax: { economic: 0, social: 0 }, // 1953: turnover tax (Umsatzsteuer) pre-VAT
      at_social_charges: { economic: 0, social: 1 }, // 1953: war pensions heavy; ASVG codification pending (1956)
      at_customs_tariff: { economic: -1, social: 0 }, // 1953: managed trade + hard-currency controls; left
      at_state_enterprises: { economic: -2, social: 0 }, // 1953: 1946/47 nationalisations — banks, VOEST, oil, power; left
      at_labor_law: { economic: -1, social: 1 }, // 1953: wage-price agreements; ÖGB inside the coalition
      at_welfare_state: { economic: 0, social: 1 }, // 1953: rudimentary; church + Lager organisations fill gaps
      at_health_insurance: { economic: 0, social: 0 }, // 1953: standard Krankenkassen funding
      at_education_funding: { economic: 0, social: 0 }, // 1953: standard Schulwesen funding
      at_infrastructure_investment: { economic: 0, social: 0 }, // 1953: standard ERP-financed reconstruction investment
      at_defense_appropriations: { economic: 0, social: -4 }, // 1953: no standing army until 1955 — gendarmerie + occupation costs only
      at_economic_subsidies: { economic: 0, social: 0 }, // 1953: standard nationalised-industry subsidies
      at_local_grants: { economic: 0, social: 0 }, // 1953: standard Finanzausgleich to Länder/Gemeinden
    },
    optionIndexes: {
      at_income_tax: 3,
      at_corporate_tax: 3,
      at_sales_tax: 1,
      at_social_charges: 1,
      at_customs_tariff: 2,
      at_state_enterprises: 2,
      at_labor_law: 2,
      at_welfare_state: 2,
      at_health_insurance: 2, // 1953: standard Krankenversicherung Act
      at_education_funding: 2, // 1953: standard Schulwesen Act
      at_infrastructure_investment: 2, // 1953: standard ERP-Wiederaufbau Act
      at_defense_appropriations: 0, // 1953: no standing army until 1955 — the ladder's minimum, gendarmerie + occupation costs
      at_economic_subsidies: 2, // 1953: standard Verstaatlichte Industrie Subventionsgesetz
      at_local_grants: 2, // 1953: standard Finanzausgleichsgesetz
    },
    regions: atRegions1953,
  },

  fi: {
    nationalStateId: "fi_national",
    defaults: {
      fi_income_tax: { economic: 0, social: 0 }, // 1953: reparations-era rates still high
      fi_corporate_tax: { economic: 0, social: 0 }, // 1953: reconstruction-era schedule
      fi_sales_tax: { economic: 0, social: 0 }, // 1953: wartime liikevaihtovero retained
      fi_social_charges: { economic: 0, social: 1 }, // 1953: child allowances (1948); pensions rudimentary
      fi_customs_tariff: { economic: -1, social: 0 }, // 1953: licensing + import controls; left
      fi_state_enterprises: { economic: -2, social: 0 }, // 1953: reparations built a state metal industry; left
      fi_labor_law: { economic: -1, social: 1 }, // 1953: wage-regulation era winding down; general-strike tensions
      fi_welfare_state: { economic: 0, social: 1 }, // 1953: war pensions + child allowances; not yet Nordic
      fi_health_insurance: { economic: 0, social: 0 }, // 1953: standard KELA health-services funding
      fi_education_funding: { economic: 0, social: 0 }, // 1953: standard Kansakoulu funding
      fi_infrastructure_investment: { economic: 0, social: 0 }, // 1953: standard reparations-era reconstruction investment
      fi_defense_appropriations: { economic: 0, social: 0 }, // 1953: standard Paris-treaty-capped appropriation
      fi_economic_subsidies: { economic: 0, social: 0 }, // 1953: standard state-company subsidies
      fi_local_grants: { economic: 0, social: 0 }, // 1953: standard transfer to kunnat
    },
    optionIndexes: {
      fi_income_tax: 3,
      fi_corporate_tax: 3,
      fi_sales_tax: 2,
      fi_social_charges: 1,
      // fi_customs_tariff corrected from idx2 to idx1 (fiscal-scale audit
      // follow-up, 2026-07-28). idx2 is "National Industry Protection Act"
      // (25% rate) — the ladder's MOST protectionist/autarkic option — which
      // is inconsistent with the defaults comment above ("licensing + import
      // controls; left", a moderate stance, not maximalist). idx1 is the
      // type's own plain "Customs Tariff Act" (9%), the standard option that
      // stance actually describes. At 0.2 importValue against $790B GDP this
      // alone cut tariff revenue from ~$39.9B (5.05% of GDP) to ~$14.2B
      // (1.8%), same class of bracket-vs-stance mismatch the se_income_tax /
      // se_social_charges fix (above, this file) caught for Sweden.
      fi_customs_tariff: 1,
      fi_state_enterprises: 2,
      fi_labor_law: 2,
      fi_welfare_state: 2,
      fi_health_insurance: 2, // 1953: standard Kansaneläkelaitos Terveys Act
      fi_education_funding: 2, // 1953: standard Kansakoulu Act
      fi_infrastructure_investment: 2, // 1953: standard Jälleenrakennus Act
      fi_defense_appropriations: 2, // 1953: standard Puolustusvoimain Act
      fi_economic_subsidies: 2, // 1953: standard Valtionyhtiöiden Tuki Act
      fi_local_grants: 2, // 1953: standard Valtionosuudet Act
    },
    regions: fiRegions1953,
  },

  tr: {
    nationalStateId: "tr_national",
    defaults: {
      tr_income_tax: { economic: 0, social: 0 }, // 1953: low income tax; tax base narrow; agrarian economy; center
      tr_corporate_tax: { economic: 0, social: 0 }, // 1953: moderate corporate tax; state enterprises dominant anyway; center
      tr_sales_tax: { economic: 0, social: 0 }, // 1953: various consumption levies; pre-KDV; center
      tr_social_charges: { economic: 0, social: 0 }, // 1953: SSK (Sosyal Sigortalar Kurumu est. 1945); nascent; center
      tr_customs_tariff: { economic: -2, social: 0 }, // 1953: very high protectionism; import-substitution industrialization; very left
      tr_state_enterprises: { economic: -2, social: 0 }, // 1953: KİT étatism (Atatürk legacy); state enterprises in steel/textiles/sugar; very left
      tr_labor_law: { economic: 0, social: 1 }, // 1953: trade unions limited under DP; conservative labor law; right-leaning
      tr_welfare_state: { economic: 0, social: 1 }, // 1953: minimal welfare; rural conservatism; right
      tr_health_insurance: { economic: 0, social: 0 }, // 1953: standard SSK health-services funding
      tr_education_funding: { economic: 0, social: 0 }, // 1953: standard Milli Eğitim funding
      tr_infrastructure_investment: { economic: 0, social: 0 }, // 1953: standard Menderes-era public-works investment
      tr_defense_appropriations: { economic: 0, social: 0 }, // 1953: standard NATO-aligned appropriation
      tr_economic_subsidies: { economic: 0, social: 0 }, // 1953: standard KİT/grain price supports
      tr_local_grants: { economic: 0, social: 0 }, // 1953: standard transfer to İl Özel İdareleri/belediyeler
    },
    optionIndexes: {
      tr_income_tax: 2, // 1953: low effective income tax; narrow base
      tr_corporate_tax: 3, // 1953: moderate; state enterprises dominate
      tr_sales_tax: 2, // 1953: various consumption levies
      tr_social_charges: 1, // 1953: SSK nascent; very low contributions
      // Index 2 = "Import-Substitution Act" (rate 35) — tr_customs_tariff's
      // taxRateOptions array only has 3 entries (indices 0-2; see
      // trLegislationTypes.ts). This was authored as `3`, one past the end,
      // so `policyOptions?.[3]` resolved to `undefined` and getDefaultPolicyOption
      // returned nothing — deriveTaxRates left taxRates.tariffs at its 0
      // initializer and deriveEnactedLaws skipped seeding tr_customs_tariff
      // entirely (both bail on `!defaultOption`). Turn-26 evidence: TR's
      // enactedLaws had no tr_customs_tariff row at all and taxRates.tariffs
      // was 0 against a 15%-of-GDP importValue base — a real tariff-revenue
      // line silently zeroed for the whole game. The 1979/modern configs
      // (basePolicies.ts, basePolicies1979.ts) both correctly use index 2 for
      // this same "still protective" stance; only the 1953 file had the typo.
      tr_customs_tariff: 2, // 1953: high protection; import-substitution

      tr_state_enterprises: 2, // 1953: KİT étatism; high state ownership
      tr_labor_law: 2, // 1953: limited union rights under DP
      tr_welfare_state: 1, // 1953: minimal; rural and traditional
      tr_health_insurance: 2, // 1953: standard SSK Health Services Act
      tr_education_funding: 2, // 1953: standard Milli Eğitim Act
      tr_infrastructure_investment: 2, // 1953: standard Bayındırlık Act
      tr_defense_appropriations: 2, // 1953: standard Milli Savunma Act
      tr_economic_subsidies: 2, // 1953: standard KİT Fiyat Destekleme Act
      tr_local_grants: 2, // 1953: standard İl Özel İdareleri Fonu Act
    },
    regions: trRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CHINA — Mao / CCP, First Five-Year Plan, 1953
  //  Command economy at maximum state control; Korean War just ended;
  //  Soviet-model heavy industrialization; collectivization beginning.
  // ═══════════════════════════════════════════════════════════════════════════
  cn: {
    nationalStateId: "cn_national",
    defaults: {
      cn_enterprise_income_tax: { economic: -3, social: 0 }, // 1953: state enterprise profit remittance; command economy; very left
      cn_individual_income_tax: { economic: 0, social: 0 }, // 1953: no individual income tax; command wages; center by default
      cn_value_added_tax: { economic: 0, social: 0 }, // 1953: no VAT (introduced 1994); commodity tax system; center
      cn_land_value_added_tax: { economic: 0, social: 0 }, // 1953: state owns all land; center
      cn_urban_maintenance_construction_tax: { economic: 0, social: 0 }, // 1953: nascent; center
      cn_stamp_duty: { economic: 0, social: 0 }, // center
      cn_social_insurance_contribution: { economic: -1, social: 0 }, // 1953: danwei (work unit) provides all benefits; left
      cn_customs_tariff: { economic: -3, social: 0 }, // 1953: state monopoly on foreign trade; autarky; very left
      cn_provincial_resource_tax: { economic: 0, social: 0 }, // center
      // Healthcare
      cn_medical_insurance: { economic: -2, social: 0 }, // 1953: danwei work-unit healthcare; left
      cn_elder_care: { economic: -2, social: 1 }, // 1953: traditional family + danwei; state collectivism; left economic, conservative social
      cn_mental_health: { economic: 0, social: 2 }, // 1953: stigma extreme; no treatment concept; very conservative
      cn_public_health: { economic: -2, social: 0 }, // 1953: mass campaigns (anti-schistosomiasis, anti-tuberculosis); very left
      // Education
      cn_education_funding: { economic: -2, social: 0 }, // 1953: mass literacy campaign; Soviet-technical education; very left
      cn_gaokao_reform: { economic: 0, social: 1 }, // 1953: no gaokao yet (introduced 1952, disrupted 1966); conservative
      cn_academic_pressure_reform: { economic: 0, social: 1 }, // 1953: Soviet-model technical education; conservative
      cn_research_science: { economic: -2, social: 0 }, // 1953: Soviet advisors; heavy science investment; very left
      // Social Policy
      cn_pension_system: { economic: -2, social: 1 }, // 1953: danwei-based pensions; left economic, conservative social
      cn_family_policy: { economic: -1, social: 2 }, // 1953: traditional family; no one-child policy yet; conservative social
      cn_gender_equality: { economic: -1, social: 1 }, // 1953: "women hold up half the sky" rhetoric but traditional practice; mixed
      cn_common_prosperity: { economic: -3, social: 1 }, // 1953: radical land redistribution; class struggle; very left
      // Defense
      cn_pla_modernization: { economic: -3, social: 2 }, // 1953: Korean War; massive PLA; Soviet military aid; very left spend, nationalist
      cn_taiwan_strait_doctrine: { economic: 0, social: 3 }, // 1953: liberation of Taiwan is PRC official goal; very nationalist
      cn_cybersecurity: { economic: 0, social: 0 }, // 1953: no cyber; center
      // Foreign Policy
      cn_belt_and_road: { economic: 0, social: 0 }, // 1953: no BRI concept; center
      cn_us_china_relations: { economic: 0, social: 3 }, // 1953: Korean War just ended; deep hostility to US; very nationalist
      cn_un_security_council_posture: { economic: 0, social: 2 }, // 1953: PRC not in UN yet (ROC held seat until 1971); nationalist
      // Technology
      cn_ai_strategy: { economic: 0, social: 0 }, // 1953: no AI; center
      cn_semiconductor_strategy: { economic: 0, social: 0 }, // 1953: no semiconductor industry; center
      // Public Safety
      cn_public_security: { economic: 0, social: 3 }, // 1953: public security bureau; anti-counter-revolutionary campaigns; very authoritarian
      cn_criminal_justice: { economic: 0, social: 3 }, // 1953: class-enemy justice; authoritarian
      cn_internet_governance: { economic: 0, social: 0 }, // 1953: no internet; center
      // Economic
      cn_state_enterprises: { economic: -4, social: 0 }, // 1953: maximum state ownership; nationalizing remaining private firms; very very left
      cn_industrial_strategy: { economic: -3, social: 0 }, // 1953: First Five-Year Plan; Soviet-style heavy industry; very left
      cn_minimum_wage: { economic: -1, social: 0 }, // 1953: state-set wages (danwei); left
      cn_fiscal_stimulus: { economic: -3, social: 0 }, // 1953: massive state investment; very left
      // Infrastructure
      cn_rail_transport: { economic: -3, social: 0 }, // 1953: massive rail construction; First Five-Year Plan priority; very left
      cn_digital_infrastructure: { economic: 0, social: 0 }, // 1953: no digital; center
      cn_housing: { economic: -2, social: 0 }, // 1953: danwei housing; state provides; left
      // Environment & Energy
      cn_renewable_energy_target: { economic: 0, social: 0 }, // 1953: no renewable framework; center
      cn_nuclear_energy: { economic: -2, social: 0 }, // 1953: Soviet nuclear cooperation beginning; military nuclear priority; left
      cn_emissions_trading_scheme: { economic: 0, social: 0 }, // 1953: no; center
      cn_climate_targets: { economic: 0, social: 0 }, // 1953: no climate framework; center
      // Hukou & Immigration
      cn_hukou_reform: { economic: -2, social: 2 }, // 1953: hukou system being established (formalized 1958); state controls mobility; left-economic, authoritarian-social
      cn_skilled_immigration: { economic: 0, social: 0 }, // 1953: Soviet experts arriving; center
      cn_diaspora_engagement: { economic: 0, social: 1 }, // 1953: overseas Chinese outreach; center-conservative
      // Agriculture
      cn_agricultural_subsidies: { economic: -2, social: 0 }, // 1953: collectivization drive; state grain procurement; left
      cn_food_security: { economic: -2, social: 1 }, // 1953: grain self-sufficiency obsession; left economic, conservative social
      cn_rural_revitalization: { economic: -2, social: 0 }, // 1953: land reform just completed; collectivization beginning; left
      // Governance
      cn_anticorruption_campaign: { economic: 0, social: 2 }, // 1953: Three Antis / Five Antis campaigns (1951-52); authoritarian anti-corruption
      cn_npc_reform: { economic: 0, social: 2 }, // 1953: NPC established 1954; rubber stamp; authoritarian
      cn_hk_macao_affairs: { economic: 0, social: 1 }, // 1953: HK still British; Macao Portuguese; limited engagement
      // Media
      cn_state_media_funding: { economic: -2, social: 2 }, // 1953: People's Daily; Xinhua; total state media control; left+authoritarian
      cn_press_freedom: { economic: 0, social: 4 }, // 1953: zero press freedom; maximum authoritarian
      // Provincial
      cn_provincial_education: { economic: -2, social: 0 }, // 1953: mass literacy campaign at provincial level; very left
      cn_provincial_public_security: { economic: 0, social: 3 }, // 1953: revolutionary committees; authoritarian
      cn_provincial_economic_development: { economic: -3, social: 0 }, // 1953: plan targets; very left
      cn_provincial_health_services: { economic: -1, social: 0 }, // 1953: barefoot doctors concept forming; left
      cn_provincial_culture_propaganda: { economic: 0, social: 3 }, // 1953: class struggle propaganda; authoritarian
      cn_provincial_environmental_policy: { economic: 0, social: 0 }, // 1953: no environmental policy; center
      cn_provincial_infrastructure_investment: { economic: -3, social: 0 }, // 1953: First Five-Year Plan provincial targets; very left
    },
    optionIndexes: {
      cn_enterprise_income_tax: 9, // 1953: state enterprise remittance at maximum; command economy
      cn_individual_income_tax: 0, // 1953: no individual income tax; state sets wages directly
      cn_value_added_tax: 0, // 1953: no VAT (introduced 1994)
      cn_land_value_added_tax: 0, // 1953: state owns all land
      cn_urban_maintenance_construction_tax: 3,
      cn_stamp_duty: 3,
      cn_social_insurance_contribution: 4, // 1953: danwei-based; moderate effective contribution
      cn_customs_tariff: 0, // 0% game baseline (state monopoly on trade)
      cn_provincial_resource_tax: 3,
      cn_medical_insurance: 1, // 1953: danwei basic coverage; low index
      cn_elder_care: 2,
      cn_mental_health: 1,
      cn_public_health: 4, // 1953: high public health investment (mass campaigns)
      cn_education_funding: 5, // 1953: high investment in literacy/technical education
      cn_gaokao_reform: 3,
      cn_academic_pressure_reform: 3,
      cn_research_science: 4, // 1953: Soviet-model science investment; high
      cn_pension_system: 2, // 1953: danwei-based; limited coverage
      cn_family_policy: 3,
      cn_gender_equality: 3,
      cn_common_prosperity: 5, // 1953: land reform + class struggle = maximum redistribution
      cn_pla_modernization: 5, // 1953: Korean War military; maximum PLA investment
      cn_taiwan_strait_doctrine: 4, // 1953: maximum assertiveness (liberation goal)
      cn_cybersecurity: 3,
      cn_belt_and_road: 3,
      cn_us_china_relations: 1, // 1953: maximum hostility to US
      cn_un_security_council_posture: 3,
      cn_ai_strategy: 3,
      cn_semiconductor_strategy: 3,
      cn_public_security: 5, // 1953: maximum public security apparatus; anti-counter-revolutionary
      cn_criminal_justice: 5,
      cn_internet_governance: 3,
      cn_state_enterprises: 5, // 1953: maximum state ownership; nationalizing remaining private
      cn_industrial_strategy: 5, // 1953: First Five-Year Plan maximum state direction
      cn_minimum_wage: 3,
      cn_fiscal_stimulus: 5, // 1953: massive state investment
      cn_rail_transport: 5, // 1953: major Five-Year Plan infrastructure
      cn_digital_infrastructure: 3,
      cn_housing: 4, // 1953: danwei housing; high state provision
      cn_renewable_energy_target: 3,
      cn_nuclear_energy: 4, // 1953: military nuclear program beginning
      cn_emissions_trading_scheme: 3,
      cn_climate_targets: 3,
      cn_hukou_reform: 2, // 1953: hukou being established; state mobility control
      cn_skilled_immigration: 3,
      cn_diaspora_engagement: 3,
      cn_agricultural_subsidies: 4, // 1953: collectivization and grain procurement
      cn_food_security: 4,
      cn_rural_revitalization: 4,
      cn_anticorruption_campaign: 4,
      cn_npc_reform: 3,
      cn_hk_macao_affairs: 3,
      cn_state_media_funding: 5, // 1953: maximum state media control
      cn_press_freedom: 1, // 1953: minimum press freedom (inverted: 1=least free)
      cn_provincial_education: 4,
      cn_provincial_public_security: 5,
      cn_provincial_economic_development: 5,
      cn_provincial_health_services: 3,
      cn_provincial_culture_propaganda: 5,
      cn_provincial_environmental_policy: 3,
      cn_provincial_infrastructure_investment: 5,
    },
    regions: cnRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  BRAZIL — Vargas (second term), 1953
  //  Nationalist development; Petrobras founded October 1953;
  //  CLT labor law; import substitution; coffee exports dominant.
  // ═══════════════════════════════════════════════════════════════════════════
  br: {
    nationalStateId: "br_national",
    // Vargas: nationalist-populist; strong developmentalist state; CLT labor
    // protection; ISI protectionism. Default option indexes below reproduce
    // the pre-legislation taxRateOverrides stopgap rates exactly (see
    // budgets.ts's BR 1953 config) so revenue is unchanged by this module
    // landing; spending defaults are pinned to baselineSpendingByCategory by
    // the budgets.ts override mechanism regardless of the index chosen here.
    defaults: {
      br_income_tax_rate: { economic: 0, social: 0 }, // 1953: standard 18% bracket; center
      br_corporate_tax: { economic: 0, social: 0 }, // 1953: standard 18% bracket; center
      br_ivc: { economic: 0, social: 0 }, // 1953: standard 10% IVC turnover rate; center
      br_iap_contribution: { economic: 0, social: 0 }, // 1953: standard 20% IAP contribution; center
      br_customs_tariff: { economic: 0, social: 0 }, // 1953: standard 18% ISI tariff wall; center
      br_state_enterprises: { economic: -3, social: 0 }, // 1953: Petrobras (Oct 1953)/Vale/CSN developmentalist state sector; left
      br_labor_law: { economic: -2, social: 0 }, // 1953: CLT (1943) protections in force; left
      br_social_security_benefits: { economic: 0, social: 0 }, // 1953: standard IAP benefit schedule; center
      br_public_health: { economic: 0, social: 0 }, // 1953: newly-independent Ministério da Saúde (split July 1953); center
      br_education_funding: { economic: 0, social: 0 }, // 1953: newly-independent Ministério da Educação e Cultura; center
      br_defense_policy: { economic: 0, social: 0 }, // 1953: standard joint-services (War/Navy/Aeronautics) funding; center
      br_infrastructure_investment: { economic: 0, social: 0 }, // 1953: SALTE Plan / BNDE investment level; center
      br_general_administration: { economic: 0, social: 0 }, // 1953: standard federal administration funding; center
      br_state_grants: { economic: 0, social: 0 }, // 1953: standard discretionary auxílios aos estados level; center
    },
    optionIndexes: {
      br_income_tax_rate: 3, // 1953: rate 18% — 6-bracket ladder, index 3 is the "standard" center bracket
      br_corporate_tax: 3, // 1953: rate 18% — 5-bracket ladder, index 3 is the "standard" center bracket
      br_ivc: 2, // 1953: rate 10% — 5-bracket ladder, index 2 is the "standard" center bracket
      br_iap_contribution: 1, // 1953: rate 20% — 3-bracket ladder, index 1 is the "standard" center bracket
      br_customs_tariff: 1, // 1953: rate 18% — 3-bracket ladder, index 1 is the "standard" center bracket
      br_state_enterprises: 3, // 1953: "Empresa Estatal Statute" — Petrobras/Vale/CSN state sector
      br_labor_law: 2, // 1953: "Consolidação das Leis do Trabalho Statute" — the CLT itself
      br_social_security_benefits: 2, // 1953: standard IAP benefit schedule (center of 5)
      br_public_health: 2, // 1953: standard Ministério da Saúde funding (center of 5)
      br_education_funding: 2, // 1953: standard Ministério da Educação e Cultura funding (center of 5)
      br_defense_policy: 2, // 1953: standard Forças Armadas funding (center of 5)
      br_infrastructure_investment: 2, // 1953: standard SALTE Plan / BNDE investment (center of 5)
      br_general_administration: 2, // 1953: standard federal administration funding (center of 5)
      br_state_grants: 2, // 1953: standard discretionary state-aid level (center of 5)
    },
    regions: brRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  IRELAND — Costello / Fine Gael coalition, 1953
  //  Protectionist agrarian economy; Church social dominance;
  //  Cold War neutrality; emigration crisis; minimal welfare state.
  // ═══════════════════════════════════════════════════════════════════════════
  ie: {
    nationalStateId: "ie_national",
    defaults: {
      // Tax
      ie_corporate_tax_rate: { economic: 0, social: 0 }, // 1953: standard rate ~25-40%; no IDA 12.5% rate; center
      ie_foreign_corporate_tax_rate: { economic: 0, social: 0 }, // 1953: same as domestic; no special foreign rate
      ie_income_tax_rate: { economic: -1, social: 0 }, // 1953: high progressive income tax; left of center
      ie_usc: { economic: 0, social: 0 }, // 1953: no USC (introduced 2011); center
      ie_prsi: { economic: 0, social: 0 }, // 1953: flat-rate National Insurance contributions (Beveridge-style); center
      ie_vat_rate: { economic: 0, social: 0 }, // 1953: no VAT (introduced 1972); turnover tax; center
      ie_customs_tariff_rate: { economic: -1, social: 0 }, // 1953: heavy protectionism; Lemass import-substitution; left
      ie_local_property_tax: { economic: 0, social: 0 }, // 1953: rates system (local authority rates); center
      ie_stamp_duty: { economic: 0, social: 0 }, // 1953: standard; center
      ie_capital_gains_tax: { economic: 0, social: 0 }, // 1953: no CGT (introduced 1975); center
      ie_excise_duty: { economic: 0, social: 0 }, // 1953: standard excise; center
      // Housing
      ie_housing_policy: { economic: -1, social: 0 }, // 1953: local authority housing active; council estate building; left
      ie_minimum_wage: { economic: 0, social: 0 }, // 1953: no national minimum wage; center
      ie_climate_policy: { economic: 0, social: 0 }, // 1953: no climate policy; center
      // Health & Education
      ie_healthcare_policy: { economic: 1, social: 1 }, // 1953: very limited state health; mainly Church-run voluntary hospitals; right
      ie_public_health: { economic: 0, social: 0 }, // 1953: Dr. Noel Browne's tuberculosis campaign; center
      ie_mental_health: { economic: 0, social: 1 }, // 1953: large psychiatric institutions; conservative
      ie_elder_care: { economic: 1, social: 0 }, // 1953: family + Church; minimal state elder care; right
      ie_education_funding: { economic: 1, social: 1 }, // 1953: Church-run schools; state provides little; right
      ie_higher_education: { economic: 1, social: 0 }, // 1953: TCD and UCD; limited access; right
      ie_research_science: { economic: 0, social: 0 }, // 1953: minimal R&D; center
      ie_curriculum_reform: { economic: 0, social: 1 }, // 1953: Irish language compulsory; Catholic ethos; conservative
      // Welfare
      ie_state_pensions: { economic: 0, social: 0 }, // 1953: old age pension (since 1908); modest; center
      ie_unemployment_benefits: { economic: 0, social: 0 }, // 1953: unemployment assistance (since 1933); modest; center
      ie_working_family_payment: { economic: 0, social: 0 }, // 1953: children's allowance; center
      ie_parental_leave: { economic: 1, social: 0 }, // 1953: no paid parental leave; right
      ie_childcare_policy: { economic: 1, social: 1 }, // 1953: family/Church-based childcare; right
      ie_gender_equality: { economic: 0, social: 2 }, // 1953: marriage bar on women civil servants; deeply conservative
      ie_drug_policy: { economic: 0, social: 1 }, // 1953: Misuse of Drugs framework; conservative
      // Economy, Labour, Infra
      ie_workers_rights: { economic: 0, social: 0 }, // 1953: ITGWU unions active; center
      ie_workforce_development: { economic: 0, social: 0 }, // 1953: apprenticeship system; center
      ie_sme_support: { economic: -1, social: 0 }, // 1953: protectionist SME support; Lemass industrialization policy; left
      ie_fiscal_stimulus: { economic: 0, social: 0 }, // 1953: budget austerity (emigration and debt burden); center
      ie_transport_rail: { economic: -1, social: 0 }, // 1953: CIÉ nationalized railways; left
      ie_digital_infrastructure: { economic: 0, social: 0 }, // 1953: no digital; center
      ie_regional_economic_development: { economic: 0, social: 0 }, // 1953: minimal regional policy; center
      // Environment, Agriculture
      ie_renewable_energy_target: { economic: 0, social: 0 }, // 1953: no renewable policy; center
      ie_agricultural_subsidies: { economic: -1, social: 0 }, // 1953: heavy agricultural protectionism; de Valera agrarian ideal; left
      ie_food_security: { economic: 0, social: 1 }, // 1953: food self-sufficiency aspiration; conservative
      ie_rural_development: { economic: -1, social: 0 }, // 1953: Land Commission; rural community investment; left
      ie_peat_bog_policy: { economic: -1, social: 0 }, // 1953: Bord na Móna peat harvesting; state enterprise; left
      // Defence, Foreign, Justice, Governance
      ie_defence_spending: { economic: 0, social: 0 }, // 1953: tiny Defence Forces; military neutrality; center
      ie_neutrality_posture: { economic: 0, social: -1 }, // 1953: strict neutrality (Cold War); left-leaning (anti-NATO)
      ie_foreign_aid_diplomacy: { economic: 0, social: 0 }, // 1953: minimal foreign aid; center
      ie_cybersecurity: { economic: 0, social: 0 }, // 1953: no cyber; center
      ie_garda_policing: { economic: 0, social: 1 }, // 1953: Garda Síochána; conservative policing
      ie_criminal_justice: { economic: 0, social: 1 }, // 1953: conservative; Catholic moral framework
      ie_government_ethics: { economic: 0, social: 0 }, // 1953: pre-Tribunals era; center
      ie_electoral_reform: { economic: 0, social: 0 }, // 1953: PR-STV system; center
      // Immigration
      ie_immigration_asylum: { economic: 0, social: 0 }, // 1953: emigration (not immigration) the defining issue; center
      ie_work_visas: { economic: 0, social: 0 }, // 1953: Commonwealth citizens free movement; center
      ie_integration_programs: { economic: 0, social: 0 }, // 1953: no immigration; center
      // Regional
      ie_regional_health: { economic: 0, social: 0 },
      ie_regional_housing: { economic: 0, social: 0 },
      ie_regional_transport: { economic: 0, social: 0 },
      ie_regional_skills: { economic: 0, social: 0 },
    },
    optionIndexes: {
      ie_corporate_tax_rate: 8, // 1953: ~40% standard rate; far above 2019's 12.5% (index 3)
      ie_foreign_corporate_tax_rate: 8, // 1953: same as domestic; no IDA preferential rate
      ie_income_tax_rate: 7, // 1953: high top rate ~65%; above 2019
      ie_usc: 0, // 1953: no USC
      ie_prsi: 3, // 1953: Beveridge-style flat-rate NI; center
      ie_vat_rate: 0, // 1953: no VAT; turnover tax
      ie_customs_tariff_rate: 3, // 1953: heavy protectionism; above 2019's 0
      ie_local_property_tax: 3, // 1953: rates system; center
      ie_stamp_duty: 3,
      ie_capital_gains_tax: 0, // 1953: no CGT
      ie_excise_duty: 3,
      ie_minimum_wage: 0, // 1953: no minimum wage
      ie_housing_policy: 3,
      ie_climate_policy: 3,
      ie_healthcare_policy: 1, // 1953: minimal state healthcare
      ie_public_health: 3,
      ie_mental_health: 2,
      ie_elder_care: 2,
      ie_education_funding: 2, // 1953: low state funding; Church-run
      ie_higher_education: 2,
      ie_research_science: 3,
      ie_curriculum_reform: 3,
      ie_state_pensions: 2, // 1953: modest old age pension
      ie_unemployment_benefits: 2,
      ie_working_family_payment: 2,
      ie_parental_leave: 1,
      ie_childcare_policy: 1,
      ie_gender_equality: 1, // 1953: marriage bar; very conservative
      ie_drug_policy: 3,
      ie_workers_rights: 3,
      ie_workforce_development: 3,
      ie_sme_support: 3,
      ie_fiscal_stimulus: 3,
      ie_transport_rail: 3,
      ie_digital_infrastructure: 3,
      ie_regional_economic_development: 3,
      ie_renewable_energy_target: 3,
      ie_agricultural_subsidies: 4, // 1953: heavy agricultural support
      ie_food_security: 3,
      ie_rural_development: 4,
      ie_peat_bog_policy: 4, // 1953: Bord na Móna active; high state involvement
      ie_defence_spending: 2,
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
    regions: ieRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NIGERIA — British Crown Colony / self-governing Federation, 1953
  //  Colonial export economy; no oil (discovered 1956); British administrators;
  //  NCNC/AG/NPC parties; very limited social services.
  // ═══════════════════════════════════════════════════════════════════════════
  ng: {
    nationalStateId: "ng_national",
    defaults: {
      // NG in the base 2019 file is a stub. For 1953 (colonial period) we keep minimal defaults.
      // Colonial economy: export-focused; no Nigerian sovereignty over most policy areas.
    },
    optionIndexes: {},
    regions: ngRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  USSR — Stalin → Khrushchev power struggle, 1953
  //  Stalin died March 1953; collective leadership; Korean War ended July 1953;
  //  hard command economy; Soviet nuclear arsenal; MGB/KGB security apparatus.
  //  Positions identical in structure to 1979 SU but calibrated harder
  //  (pre-Khrushchev thaw; maximum Stalinist command).
  // ═══════════════════════════════════════════════════════════════════════════
  su: {
    nationalStateId: "su_national",
    defaults: {
      su_enterprise_levy: { economic: -3, social: 0 }, // 1953: enterprise profit remittance at maximum; Stalinist command; very left
      su_individual_income_tax: { economic: 0, social: 0 }, // 1953: minimal individual tax; state sets wages directly; center
      su_turnover_tax: { economic: 0, social: 0 }, // 1953: major revenue source; high turnover tax on enterprise output; center
      su_social_insurance: { economic: 0, social: 0 }, // 1953: state provides all; danwei equivalent; center
      su_customs_tariff: { economic: -3, social: 0 }, // 1953: foreign trade state monopoly; autarky; very left
      su_economic_system: { economic: -4, social: 0 }, // 1953: maximum Gosplan central planning; most planned system
      su_political_system: { economic: 0, social: 3 }, // 1953: SU one-party maximum (Stalin just died; still Stalinist)
      su_price_controls: { economic: -3, social: 0 }, // 1953: all prices state-set; maximum control
      su_agriculture: { economic: -3, social: 0 }, // 1953: collective farms at maximum; peasants have no private plots; maximum state
      su_civil_liberties: { economic: 0, social: 3 }, // 1953: MGB/KGB; Gulag; maximum repression (Stalinist peak)
      su_defense_spending: { economic: -3, social: 1 }, // 1953: Korean War + nuclear arms race; highest defense share of any era; very left
      su_housing: { economic: -3, social: 0 }, // 1953: state housing allocation; communal apartments; very left
    },
    optionIndexes: {
      su_enterprise_levy: 5, // 1953: maximum enterprise levy (Stalinist extraction)
      su_individual_income_tax: 1, // 1953: flat citizens' levy; minimal
      su_turnover_tax: 3, // 1953: high turnover tax; above 1979 levels
      su_social_insurance: 1, // 1953: unified; state-provided
      su_customs_tariff: 2, // 1953: foreign trade monopoly at maximum
      su_economic_system: 5, // 1953: pure Gosplan; maximum centralization
      su_political_system: 3, // 1953: maximum SED/CPSU leading role (Stalinist)
      su_price_controls: 3, // 1953: maximum state price setting
      su_agriculture: 3, // 1953: maximum collectivization; no private plots
      su_civil_liberties: 1, // 1953: minimum civil liberties (Gulag at peak; inverted: 1=least free)
      su_defense_spending: 3, // 1953: maximum defense share (Korean War + nuclear)
      su_housing: 3, // 1953: state housing allocation maximum
    },
    regions: ruRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  EAST GERMANY — Ulbricht / SED, 1953
  //  June 17 uprising suppressed by Soviet tanks; Soviet reparations ending;
  //  command economy; collectivization being forced; hard Stalinist state.
  // ═══════════════════════════════════════════════════════════════════════════
  dd: {
    nationalStateId: "dd_national",
    defaults: {
      dd_enterprise_levy: { economic: -3, social: 0 }, // 1953: VEB enterprise remittance at maximum; Stalinist command; very left
      dd_income_tax: { economic: 0, social: 0 }, // 1953: flat citizens' income tax; state sets wages; center
      dd_product_tax: { economic: 0, social: 0 }, // 1953: commodity tax on output; center
      dd_social_insurance: { economic: 0, social: 0 }, // 1953: state social insurance comprehensive; center
      dd_foreign_trade: { economic: -3, social: 0 }, // 1953: foreign trade state monopoly; very left
      dd_economic_system: { economic: -4, social: 0 }, // 1953: maximum central planning (Gosplan-style); very left
      dd_political_system: { economic: 0, social: 3 }, // 1953: SED leading role at maximum (Stalinist; Ulbricht consolidating after June 17)
      dd_price_controls: { economic: -3, social: 0 }, // 1953: all prices state-set; maximum
      dd_civil_liberties: { economic: 0, social: 3 }, // 1953: Stasi nascent (founded 1950); harsh repression; maximum
      dd_housing: { economic: -2, social: 0 }, // 1953: state housing allocation; acute shortage; left
    },
    optionIndexes: {
      dd_enterprise_levy: 4, // 1953: maximum VEB surplus remittance
      dd_income_tax: 1, // 1953: flat citizens' tax; minimal
      dd_product_tax: 2, // 1953: commodity tax; above 1979
      dd_social_insurance: 1, // 1953: unified state social insurance
      dd_foreign_trade: 2, // 1953: foreign trade monopoly at maximum
      dd_economic_system: 4, // 1953: maximum centralization (stricter than 1979)
      dd_political_system: 4, // 1953: maximum SED/Stalinist control (stricter than 1979)
      dd_price_controls: 3, // 1953: maximum price regulation
      dd_civil_liberties: 1, // 1953: minimum civil liberties (Stasi; inverted: 1=least free)
      dd_housing: 2, // 1953: state allocation; acute shortage
    },
    regions: ddRegions1953,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  WARSAW-PACT SATELLITES — 1953
  //
  //  These six previously had NO 1953 policy config, so `makeEasternBlocBudget`
  //  fell through to `COUNTRY_POLICY_CONFIGS` — the modern shared map — and a
  //  1953 world seeded them with Brezhnev-era tax and spending defaults.
  //
  //  `easternBlocPolicyConfig1953` supplies the high-Stalinist baseline: total
  //  surplus remittance, maximal turnover tax, total centralisation, vanguard
  //  dictatorship, frozen prices and rationing. Per-country overrides below
  //  record where 1953 genuinely differed from that baseline.
  // ═══════════════════════════════════════════════════════════════════════════

  // Bierut's Poland. Stalinist on every lever the state controlled directly, but
  // the countryside is the standing exception in the whole bloc: the 1948-56
  // collectivisation drive never took, private peasant farms survived to 1989,
  // and rationing was lifted in January 1953 after the currency reform.
  pl: {
    nationalStateId: "pl_national",
    defaults: {
      ...easternBlocPolicyConfig1953("pl", { priceControls: 2 }).defaults,
      ...easternBlocSpendingPolicyConfig1953("pl").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("pl", { priceControls: 2 }).optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("pl").optionIndexes,
    },
    regions: plRegions1953,
  },

  // The Ukrainian SSR. The Union's second economy: Donbas coal and Dnieper
  // metallurgy carry all-union plan targets, so the investment ladder sits
  // higher than any satellite's, and price controls are all-union policy
  // rather than a republic choice.
  ukr: {
    nationalStateId: "ukr_national",
    defaults: {
      ...easternBlocPolicyConfig1953("ukr", { priceControls: 2 }).defaults,
      ...easternBlocSpendingPolicyConfig1953("ukr").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("ukr", { priceControls: 2 }).optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("ukr").optionIndexes,
    },
    regions: uaRegions1953,
  },

  // The Byelorussian SSR. Reconstruction is the whole budget here: a quarter of
  // the population died in the war and Minsk was rebuilt from the foundations,
  // so infrastructure runs ahead of consumption.
  blr: {
    nationalStateId: "blr_national",
    defaults: {
      ...easternBlocPolicyConfig1953("blr", { priceControls: 2 }).defaults,
      ...easternBlocSpendingPolicyConfig1953("blr").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("blr", { priceControls: 2 }).optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("blr").optionIndexes,
    },
    regions: blrRegions1953,
  },

  // The Baltic republics. Annexed in 1940 and re-annexed in 1944; collectivisation
  // and the March 1949 deportations are recent, and the highest living standards
  // in the Union sit alongside the least consent for the system that delivers them.
  bal: {
    nationalStateId: "bal_national",
    defaults: {
      ...easternBlocPolicyConfig1953("bal", { priceControls: 2 }).defaults,
      ...easternBlocSpendingPolicyConfig1953("bal").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("bal", { priceControls: 2 }).optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("bal").optionIndexes,
    },
    regions: balRegions1953,
  },

  // Rákosi's Hungary — the most literally Stalinist state in the bloc, and the
  // one the New Course was imposed on from Moscow in June 1953. No softening.
  hu: {
    nationalStateId: "hu_national",
    defaults: {
      ...easternBlocPolicyConfig1953("hu").defaults,
      ...easternBlocSpendingPolicyConfig1953("hu").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("hu").optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("hu").optionIndexes,
    },
    regions: huRegions1953,
  },

  // Gheorghiu-Dej's Romania. Collectivisation under way against armed resistance;
  // the Danube-Black Sea Canal forced-labour project at its height.
  ro: {
    nationalStateId: "ro_national",
    defaults: {
      ...easternBlocPolicyConfig1953("ro").defaults,
      ...easternBlocSpendingPolicyConfig1953("ro").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("ro").optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("ro").optionIndexes,
    },
    regions: roRegions1953,
  },

  // Chervenkov's Bulgaria — "the Little Stalin"; the most obedient satellite and
  // the most thoroughly Sovietised economy outside the USSR itself.
  bg: {
    nationalStateId: "bg_national",
    defaults: {
      ...easternBlocPolicyConfig1953("bg").defaults,
      ...easternBlocSpendingPolicyConfig1953("bg").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("bg").optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("bg").optionIndexes,
    },
    regions: bgRegions1953,
  },

  // Gottwald then Zápotocký. The June 1953 currency reform wiped savings and
  // triggered the Plzeň revolt — rationing and frozen prices are exactly right
  // for this year, so the baseline stands unmodified.
  cs: {
    nationalStateId: "cs_national",
    defaults: {
      ...easternBlocPolicyConfig1953("cs").defaults,
      ...easternBlocSpendingPolicyConfig1953("cs").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("cs").optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("cs").optionIndexes,
    },
    regions: csRegions1953,
  },

  // Tito's Yugoslavia — the large exception, and NOT a Warsaw Pact member.
  // Expelled from the Cominform in 1948, taking American aid by 1951, and in
  // 1953 it abandons forced collectivisation outright. The 1950 Basic Law on
  // workers' self-management had already handed enterprises to workers' councils,
  // so the economic system is reform socialism rather than total centralisation,
  // prices are only partly administered, and trade is selectively open to the
  // West. The SKJ's political monopoly stays — self-management was economic
  // heterodoxy, not political pluralism.
  yu: {
    nationalStateId: "yu_national",
    defaults: {
      ...easternBlocPolicyConfig1953("yu", {
        economicSystem: 2, // Reform Socialism — workers' self-management
        priceControls: 1, // Partial Decontrol
        foreignTrade: 1, // Managed Opening — Western aid and trade
        enterpriseLevy: 3, // standing levy, not total remittance
        politicalSystem: 3, // SKJ leading role, not vanguard dictatorship
      }).defaults,
      ...easternBlocSpendingPolicyConfig1953("yu").defaults,
    },
    optionIndexes: {
      ...easternBlocPolicyConfig1953("yu", {
        economicSystem: 2,
        priceControls: 1,
        foreignTrade: 1,
        enterpriseLevy: 3,
        politicalSystem: 3,
      }).optionIndexes,
      ...easternBlocSpendingPolicyConfig1953("yu").optionIndexes,
    },
    regions: yuRegions1953,
  },
};
