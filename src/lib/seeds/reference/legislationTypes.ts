import type { LegislationType, EffectTargetWeighted, MetricCategoryId } from "@/lib/db/types";
import { policyOptions, taxRateOptions, withPerCapitaCosts } from "./policyOptionHelpers";
import { withEraCosts } from "@/lib/era/legislationCostCatalog";
import { jpLegislationTypes } from "../jp/jpLegislationTypes";
import { deLegislationTypes } from "../de/deLegislationTypes";
import { ieLegislationTypes } from "../ie/ieLegislationTypes";
import { cnLegislationTypes } from "../cn/cnLegislationTypes";
import { ngLegislationTypes } from "../ng/ngLegislationTypes";
import { ruLegislationTypes } from "../ru/ruLegislationTypes";
import { frLegislationTypes } from "../fr/frLegislationTypes";
import { itLegislationTypes } from "../it/itLegislationTypes";
import { esLegislationTypes } from "../es/esLegislationTypes";
import { seLegislationTypes } from "../se/seLegislationTypes";
import { trLegislationTypes } from "../tr/trLegislationTypes";
import { grLegislationTypes } from "../gr/grLegislationTypes";
import { atLegislationTypes } from "../at/atLegislationTypes";
import { fiLegislationTypes } from "../fi/fiLegislationTypes";
import { ddLegislationTypes } from "../dd/ddLegislationTypes";
import { huLegislationTypes } from "../hu/huLegislation";
import { plLegislationTypes } from "../pl/plLegislation";
import { roLegislationTypes } from "../ro/roLegislation";
import { yuLegislationTypes } from "../yu/yuLegislation";
import { bgLegislationTypes } from "../bg/bgLegislation";
import { uaLegislationTypes } from "../ua/uaLegislation";
import { blrLegislationTypes } from "../blr/blrLegislation";
import { csLegislationTypes } from "../cs/csLegislation";
import { balLegislationTypes } from "../bal/balLegislation";
import { brLegislationTypes } from "../br/brLegislationTypes";
import { bankingSeparationLegislationTypes } from "../shared/bankingSeparationLegislation";

// ============================================================================
// Archetype Approval System
// ============================================================================
// Archetype approval impacts are calculated at bill ENACTMENT time (not stored
// in seed data). Impacts are based on the SHIFT from old policy position to new,
// using domain-specific affinities defined in src/lib/archetypeAffinities.ts.
//
// The UI shows shift-based previews by fetching current policies and calculating
// potential impacts using calculateShiftImpacts().
// ============================================================================

// Helper to build weighted effect targets
function weightedTargets(
  primary: { category: MetricCategoryId; metric: string },
  secondary?: { category: MetricCategoryId; metric: string; weight: number }[]
): EffectTargetWeighted[] {
  const targets: EffectTargetWeighted[] = [
    { metricCategoryId: primary.category, metricId: primary.metric, weight: 1.0 },
  ];
  if (secondary) {
    for (const s of secondary) {
      targets.push({ metricCategoryId: s.category, metricId: s.metric, weight: s.weight });
    }
  }
  return targets;
}

/** Shared position definitions for committee chair and ranking member in both chambers */
function standardCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    { positionId: "house_chair", name: `Chair, House ${domainLabel} Committee`, chamber: "house" },
    {
      positionId: "house_ranking",
      name: `Ranking Member, House ${domainLabel} Committee`,
      chamber: "house",
    },
    {
      positionId: "senate_chair",
      name: `Chair, Senate ${domainLabel} Committee`,
      chamber: "senate",
    },
    {
      positionId: "senate_ranking",
      name: `Ranking Member, Senate ${domainLabel} Committee`,
      chamber: "senate",
    },
  ];
}

/** Standard committee positions for UK legislation (Commons + Lords) */
function standardUKCommitteePositions(domainLabel: string): LegislationType["positions"] {
  return [
    {
      positionId: "commons_chair",
      name: `Chair, Commons ${domainLabel} Committee`,
      chamber: "commons",
    },
    {
      positionId: "commons_ranking",
      name: `Ranking Member, Commons ${domainLabel} Committee`,
      chamber: "commons",
    },
    { positionId: "lords_chair", name: `Chair, Lords ${domainLabel} Committee`, chamber: "lords" },
    {
      positionId: "lords_ranking",
      name: `Ranking Member, Lords ${domainLabel} Committee`,
      chamber: "lords",
    },
  ];
}

/** Score for 7 options in order: left×3 (-5,-3,-1), center (0), right×3 (1,3,5). Full -5 to +5 scale. */
const _STANCE_SCORES = [-5, -3, -1, 0, 1, 3, 5] as const;

/**
 * Standard metric tick rates per turn for 7-option legislation.
 * Scaled for ~7 year single-bill impact, ~10 year full reversal with multiple bills.
 */
const TICK_RATES_7 = [0.06, 0.04, 0.02, 0.0, -0.02, -0.04, -0.06] as const;

/**
 * Dedicated, stronger tick rates for the UK birthRate lever (uk_childcare).
 *
 * birthRate is an intensive 0-100 index with NO metric-engine registry node and no
 * competing drift — it only moves by these additive per-turn ticks. National UK
 * policies are divided across the 12 regions (getFederalMultiplier("UK") = 1/12) in
 * computeTickRates; correct for extensive totals, but it dilutes an intensive index.
 * With the shared TICK_RATES_7 (0.06) the strongest option moved each region only
 * 0.06 × 1/12 × 48 ≈ 0.24 index/yr — imperceptible (live player report: "1-2 game
 * years and the birth rate hasn't changed"). Scaled ~12.5× so the strongest option
 * delivers 0.75 × 1/12 × 48 ≈ 3 index/yr per region — a visible demographic response
 * within ~1-2 years while still gradual (≈ replacement after ~2 yrs, not an instant
 * flip). Kept separate from TICK_RATES_7 so the many laws sharing that array are
 * untouched.
 */
const UK_BIRTH_RATE_TICK_RATES_7 = [0.75, 0.5, 0.25, 0.0, -0.25, -0.5, -0.75] as const;

/**
 * US counterpart of {@link UK_BIRTH_RATE_TICK_RATES_7} for the us_paid_family_leave
 * lever. US national policies are divided across 50 states (getFederalMultiplier("US")
 * = 1/50), so the shared TICK_RATES_7 gave each state only 0.06 × 1/50 × 48 ≈ 0.06
 * index/yr — even weaker than the UK case. Scaled ~50× (vs ~12.5× for the UK) so the
 * strongest option lands the SAME per-region rate: 3.0 × 1/50 × 48 ≈ 2.9 index/yr.
 */
const US_BIRTH_RATE_TICK_RATES_7 = [3.0, 2.0, 1.0, 0.0, -1.0, -2.0, -3.0] as const;

/**
 * Inverted tick rates for metrics where rightward = improvement (e.g., reducing uninsured rate).
 */
const TICK_RATES_7_INV = [-0.06, -0.04, -0.02, 0.0, 0.02, 0.04, 0.06] as const;

const rawLegislationTypes: LegislationType[] = [
  // ── Education ─────────────────────────────────────────────────────────
  {
    _id: "us_federal_education_funding",
    countryScope: "us",
    name: "Federal Education Investment Act",
    description: "Bills affecting federal K-12 and higher education spending",
    explanation:
      "Controls how much the federal government spends on public schools, Title I programs for low-income districts, Pell Grants for college students, and special education mandates. More funding typically improves test scores and college access but increases the deficit.",
    policyDomain: "education",
    subCategory: "Federal funding",
    budgetCategory: "education",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    // §4.7 (P2a): the readout secondaries (gradRate/testPerf/literacy/college/
    // workforceSkill) double-counted — this law's education spend now drives
    // them via the engine's spending channel. Primary educationSpending root only.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "education", metric: "educationSpending" }, []),
      // Phase A2: tradeoff — left expansion reduces economic freedom & small business formation;
      // right cuts improve them (effect × effectDirection).
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.15 },
    ],
    demographicEffects: [
      { groupId: "college", direction: 0.02 }, // More education funding increases college attainment over time
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "federal_education_funding",
        [
          { name: "Universal Public Education Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Pell Grant and College Access Act", stance: "left", effectDirection: 1 },
          {
            name: "Student Achievement and Accountability Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Education Stability Act", stance: "center", effectDirection: 0 },
          { name: "State Education Block Grant Act", stance: "right", effectDirection: -1 },
          { name: "Federal Education Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Department of Education Abolition Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand Title I funding, universal pre-K, and free school meals for every public school district",
          "Expand Pell Grants to cover full tuition and increase federal support for low-income school districts",
          "Modestly increase federal education funding tied to accountability benchmarks and performance metrics",
          "A steady-state level of federal education funding, with no significant expansion or reduction of programs",
          "Convert federal education funding into flexible block grants administered by state governments",
          "Significantly reduce the federal role in K-12 education, returning authority and funding decisions to states",
          "Eliminate the federal role in K-12 education entirely, leaving all funding and standards to state and local control",
        ][i],
      })),
      [1303, 955, 651, 391, 217, 87, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_federal_science_funding",
    countryScope: "us",
    name: "Federal Science and Research Act",
    description: "Bills affecting federal R&D and science education funding",
    explanation:
      "Determines funding for agencies like NSF, NIH, and DOE labs. Supports basic research, STEM education, and university grants. Higher funding accelerates technological innovation but costs taxpayer money; cuts may harm long-term competitiveness.",
    policyDomain: "education",
    subCategory: "Science funding",
    budgetCategory: "education",
    // §4.7 (P2a): science FUNDING's mechanism is money — its budgetCategory spend
    // now drives the education readouts via the engine's spending channel, so
    // direct collegeEnrollment/testPerformance targets double-counted. Re-pointed
    // to the R&D root driver (rdIntensity, the TFP input) + the existing
    // gdpGrowth coexistence term.
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "rdIntensity",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "rdIntensity" }, [
        { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      ])!,
      // Phase A2: tradeoff — left expansion reduces economic freedom & small business formation;
      // right cuts improve them.
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.3 },
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.15 },
    ],
    demographicEffects: [
      { groupId: "college", direction: 0.03 }, // Science funding strongly increases college attainment
      { groupId: "urban", direction: 0.01 }, // Research institutions concentrate in urban areas
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "federal_science_funding",
        [
          { name: "Moonshot Research Initiative Act", stance: "left", effectDirection: 1 },
          { name: "Scientific Discovery Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Applied Research Growth Act", stance: "left", effectDirection: 1 },
          { name: "Research Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Industry-Led Innovation Act", stance: "right", effectDirection: -1 },
          { name: "Science Spending Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Federal Research Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Double federal science agency budgets, fund transformative research programs, and guarantee university research grants across NIH, NSF, NASA, and DOE",
          "Significantly expand NIH, NSF, NASA, and DOE lab funding to accelerate breakthroughs in medicine, space exploration, and technology",
          "Modestly increase federal research grants with emphasis on practical applications, STEM workforce development, and sustained NASA missions",
          "A steady level of federal science funding supporting ongoing programs across NIH, NSF, NASA, and DOE without significant expansion or reduction",
          "Shift federal research toward public-private partnerships, reducing direct government-funded basic research and commercializing NASA operations",
          "Substantially cut federal research budgets, relying on private sector and universities to fund their own research and space programs",
          "Eliminate federal science agencies, leaving all research funding and space exploration to the private sector and state institutions",
        ][i],
        metricEffects: [
          {
            // §4.7 (P2a): was collegeEnrollment (a spend-driven readout) —
            // re-pointed to the R&D root, matching the weighted targets above.
            category: "economic" as const,
            metricId: "rdIntensity",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [1042, 695, 434, 261, 152, 65, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_school_standards",
    countryScope: "us",
    name: "Educational Standards and Choice Act",
    description:
      "Bills affecting curriculum standards, school choice, and cultural content in schools",
    explanation:
      "Covers curriculum requirements, standardized testing, charter schools, and voucher programs. Left positions favor public school investment and national standards; right positions favor school choice and local control over curriculum.",
    policyDomain: "education",
    subCategory: "Standards",
    budgetCategory: "education",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "testPerformance",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "testPerformance" }, [
      { category: "education", metric: "universityEnrollment", weight: 0.4 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    demographicEffects: [
      { groupId: "college", direction: 0.01 }, // Standards affect long-term college rates
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "school_standards",
        [
          { name: "Universal Public Standards Act", stance: "left", effectDirection: 1 },
          { name: "Equity in Education Act", stance: "left", effectDirection: 1 },
          { name: "Federal-State Standards Partnership Act", stance: "left", effectDirection: 1 },
          { name: "State-Led Education Standards Act", stance: "center", effectDirection: 0 },
          { name: "School Choice Expansion Act", stance: "right", effectDirection: -1 },
          { name: "Parental Rights in Education Act", stance: "right", effectDirection: -1 },
          { name: "Full Education Privatization Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate national curriculum standards, ban private school vouchers, and limit charter school expansion",
          "Strengthen federal accountability requirements, fund wraparound services, and restrict public money flowing to private schools",
          "Encourage voluntary national standards with federal support for underperforming districts",
          "Allow states to set their own standards with limited federal guidance and modest charter school allowances",
          "Expand charter schools and introduce voucher pilot programs, giving parents more educational options",
          "Abolish federal curriculum standards, expand vouchers, and give parents full control over schooling decisions",
          "Eliminate all federal standards and public school mandates, fully privatizing K-12 education through vouchers and market competition",
        ][i],
      })),
      [261, 195, 152, 109, 65, 26, 0]
    ),
  },
  // ── Healthcare ─────────────────────────────────────────────────────────
  {
    _id: "us_federal_healthcare_funding",
    countryScope: "us",
    name: "Federal Healthcare Access Act",
    description: "Bills affecting federal healthcare and Medicaid/Medicare spending",
    explanation:
      "Sets policy on how the federal government funds healthcare. Options range from single-payer universal coverage to market-based approaches. Affects the uninsured rate, healthcare quality, and federal spending levels.",
    policyDomain: "healthcare",
    subCategory: "Federal funding",
    budgetCategory: "healthcare",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "uninsuredRate",
      scope: "national",
    },
    // §4.7 (P2b): the derived-readout secondaries (lifeExpectancy/affordability/
    // physicianRate/preventableMortality) double-counted — this funding law's
    // healthcare spend now drives them via the engine's spending channel, and
    // the uninsuredRate primary (coverage root) feeds them as an engine input.
    // Phase A2: tradeoff — left expansion reduces economic freedom; right cuts improve it.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "healthcare", metric: "uninsuredRate" }, [
        { category: "economic", metric: "povertyRate", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.25 },
    ],
    demographicEffects: [
      { groupId: "retirees", direction: 0.01 }, // Better healthcare increases senior population
    ],
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "federal_healthcare_funding",
        [
          { name: "Universal Single-Payer Healthcare Act", stance: "left", effectDirection: 1 },
          { name: "Medicare for All Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Public Option and Subsidy Act", stance: "left", effectDirection: 1 },
          { name: "Federal Healthcare Framework Act", stance: "center", effectDirection: 0 },
          { name: "Market-Based Healthcare Reform Act", stance: "right", effectDirection: -1 },
          { name: "Federal Healthcare Devolution Act", stance: "right", effectDirection: -1 },
          { name: "Healthcare Privatization Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Establish a government-run single-payer system covering all residents with no private insurance role",
          "Dramatically expand Medicare eligibility to all ages with comprehensive benefits and minimal cost-sharing",
          "Create a government-run public insurance option alongside private plans with expanded ACA subsidies",
          "A moderate level of federal healthcare spending funding Medicare, Medicaid, and marketplace subsidies",
          "Shift toward health savings accounts, high-deductible plans, and interstate insurance competition",
          "Block-grant Medicaid to states, reduce subsidies, and let market forces drive coverage and pricing",
          "Eliminate federal healthcare programs entirely, leaving all coverage to private insurance markets",
        ][i],
      })),
      [4650, 3720, 3100, 2480, 1550, 744, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_drug_pricing_medicare",
    countryScope: "us",
    name: "Medicare Drug Pricing Reform Act",
    description: "Bills affecting prescription drug pricing and Medicare policy",
    explanation:
      "Determines whether Medicare can negotiate drug prices, import cheaper medications, or cap out-of-pocket costs. Affects prescription affordability for seniors and federal healthcare spending.",
    policyDomain: "healthcare",
    subCategory: "Drug pricing / Medicare",
    budgetCategory: "healthcare",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "lifeExpectancy",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "healthcare", metric: "lifeExpectancy" }, [
      { category: "healthcare", metric: "uninsuredRate", weight: 0.3 },
      { category: "economic", metric: "medianIncome", weight: 0.3 },
      { category: "healthcare", metric: "affordabilityIndex", weight: 0.5 },
      { category: "healthcare", metric: "preventableMortality", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    demographicEffects: [
      { groupId: "retirees", direction: 0.02 }, // Drug pricing heavily affects seniors
    ],
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "drug_pricing_medicare",
        [
          { name: "Universal Drug Coverage Act", stance: "left", effectDirection: 1 },
          { name: "Medicare Negotiation Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Senior Prescription Relief Act", stance: "left", effectDirection: 1 },
          { name: "Medicare Drug Stability Act", stance: "center", effectDirection: 0 },
          { name: "Market Pricing Preservation Act", stance: "right", effectDirection: -1 },
          {
            name: "Pharmaceutical Innovation Protection Act",
            stance: "right",
            effectDirection: -1,
          },
          { name: "Medicare Drug Program Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Government negotiates all drug prices, caps out-of-pocket costs at $35/month, and provides free prescriptions for seniors and low-income patients",
          "Authorize Medicare to negotiate prices on all brand-name drugs and import cheaper medications from approved countries",
          "Expand Medicare drug negotiation authority and cap annual out-of-pocket prescription costs for seniors",
          "A moderate approach to drug pricing allowing limited negotiation on high-cost specialty medications",
          "Restrict government negotiation of drug prices, relying on pharmacy benefit managers and private competition",
          "Eliminate government drug price negotiation to protect pharmaceutical R&D incentives and patent rights",
          "End the Medicare prescription drug benefit entirely, leaving drug coverage to private insurance and out-of-pocket payment",
        ][i],
      })),
      [744, 558, 434, 310, 217, 93, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_public_health",
    countryScope: "us",
    name: "Public Health Protection Act",
    description: "CDC funding, disease prevention, and health preparedness",
    explanation:
      "Federal public health programs including CDC, disease surveillance, vaccination programs, and emergency preparedness. Affects population health outcomes.",
    policyDomain: "healthcare",
    subCategory: "Public Health",
    budgetCategory: "healthcare",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "state",
    },
    // §4.7 (P2b): preventableMortality/lifeExpectancy secondaries dropped —
    // publicHealthPreparedness (the primary root) is now an ENGINE input to the
    // mortality chain (root pass-through).
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [{ category: "economic", metric: "economicFreedom", weight: -0.15 }]
    ),
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "public_health",
        [
          { name: "Pandemic Preparedness and Prevention Act", stance: "left", effectDirection: 1 },
          { name: "Public Health Workforce Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Community Health Investment Act", stance: "left", effectDirection: 1 },
          { name: "Public Health Services Act", stance: "center", effectDirection: 0 },
          { name: "Targeted Public Health Act", stance: "right", effectDirection: -1 },
          { name: "Public Health Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Federal Public Health Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand CDC, fund universal vaccination programs, and build a national disease surveillance network",
          "Significantly increase CDC funding, expand disease research grants, and invest in public health infrastructure",
          "Modestly increase public health funding for disease surveillance, prevention programs, and health education",
          "A moderate level of federal public health funding supporting disease monitoring and emergency preparedness",
          "Focus federal public health spending on critical threats only, reducing broad prevention programs",
          "Substantially cut CDC and federal health agency budgets, deferring disease prevention to state health departments",
          "Eliminate federal public health agencies, leaving disease prevention and emergency response entirely to states",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [124, 93, 62, 37, 22, 9, 0]
    ),
  },
  {
    _id: "us_state_public_health",
    countryScope: "us",
    name: "State Public Health Act",
    description: "State health departments and disease prevention programs",
    explanation:
      "State-level public health infrastructure, disease prevention, and health promotion. States are primary actors in public health delivery.",
    policyDomain: "healthcare",
    subCategory: "Public Health",
    budgetCategory: "healthcare",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "state",
    },
    // §4.7 (P2b): preventableMortality/lifeExpectancy secondaries dropped —
    // publicHealthPreparedness (the primary root) is now an ENGINE input to the
    // mortality chain (root pass-through).
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [{ category: "economic", metric: "economicFreedom", weight: -0.15 }]
    ),
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_public_health",
        [
          { name: "Comprehensive State Health Initiative Act", stance: "left", effectDirection: 1 },
          { name: "State Health Infrastructure Act", stance: "left", effectDirection: 1 },
          { name: "Community Wellness Expansion Act", stance: "left", effectDirection: 1 },
          { name: "State Public Health Services Act", stance: "center", effectDirection: 0 },
          { name: "Lean Public Health Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Health Act", stance: "right", effectDirection: -1 },
          { name: "State Public Health Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund universal state health screenings, community clinics in every county, and aggressive disease prevention outreach",
          "Significantly expand state health department staffing, disease tracking, and community health programs",
          "Modestly increase state public health funding for vaccination drives, health inspections, and prevention campaigns",
          "A moderate level of state funding for health departments, disease reporting, and emergency preparedness",
          "Reduce state health department budgets, focusing only on outbreak response and critical inspections",
          "Cut state public health to bare-minimum disease reporting and emergency response functions",
          "Eliminate state public health departments, leaving health services to private providers and voluntary organizations",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [186, 139, 93, 62, 37, 15, 0]
    ),
    allowedScope: "state",
  },
  // ── Economic ───────────────────────────────────────────────────────────
  {
    _id: "us_federal_spending_stimulus",
    countryScope: "us",
    name: "Economic Recovery and Investment Act",
    description: "Bills affecting federal spending and economic stimulus",
    explanation:
      "Controls overall federal discretionary spending levels. Stimulus measures can boost employment and GDP during recessions but increase the deficit. Austerity reduces debt but may slow economic growth.",
    policyDomain: "economic",
    subCategory: "Federal spending",
    budgetCategory: "other",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    // gdpGrowth (engine-owned, overwritten every turn by runMetricEngine) and
    // budgetBalance (mirror-controlled readout) entries were dead — converted
    // to demographicEffects below (fable-5 legislation→demographics v2 pass).
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    // Federal scope divides by 1/50 per state, so magnitudes run high (intensive
    // lean dilution — same trap as UK_BIRTH_RATE_TICK_RATES_7 above).
    demographicEffects: [
      // Big federal spending normalizes pro-government economics among public
      // workers (stimulus era pulls them left; austerity pushes them right).
      { groupId: "public_sector", target: "economicLean", direction: 1, magnitude: 2 },
      // Public-works stimulus flows to construction/trades — weaker coupling.
      { groupId: "union_trades", target: "economicLean", direction: 0.5, magnitude: 2 },
      // Jobs programs mobilize low-propensity young/low-income voters
      // (negative direction: left options carry negative strength → turnout up).
      { groupId: "young_renters", target: "turnout", direction: -0.5, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Appropriations"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "federal_spending_stimulus",
        [
          { name: "New Deal Reinvestment Act", stance: "left", effectDirection: 1 },
          { name: "Economic Stimulus and Jobs Act", stance: "left", effectDirection: 1 },
          { name: "Targeted Investment Act", stance: "left", effectDirection: 1 },
          { name: "Fiscal Balance Act", stance: "center", effectDirection: 0 },
          { name: "Spending Discipline Act", stance: "right", effectDirection: -1 },
          { name: "Austerity and Deficit Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Government Spending Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massive federal spending program funding jobs, infrastructure, and direct economic stimulus across all sectors",
          "Significantly increase federal discretionary spending to boost employment, wages, and public investment",
          "Modestly increase federal spending focused on shovel-ready projects and workforce programs",
          "A moderate level of federal discretionary spending balancing investment needs with deficit management",
          "Reduce federal discretionary spending through agency consolidation and program elimination",
          "Dramatically cut federal spending to reduce the deficit and shrink the size of government",
          "Eliminate nearly all federal discretionary spending, funding only constitutionally mandated functions",
        ][i],
      })),
      [4306, 3444, 2756, 2153, 1550, 689, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_state_spending_stimulus",
    countryScope: "us",
    name: "State Economic Recovery Act",
    description: "Bills affecting state spending and economic stimulus",
    explanation:
      "Controls overall state discretionary spending levels. Stimulus measures can boost local employment and GDP but may require tax increases or deficit spending. Austerity reduces debt but may slow economic growth.",
    policyDomain: "economic",
    subCategory: "State spending",
    budgetCategory: "other",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "state",
    },
    // gdpGrowth (engine-owned) and budgetBalance (mirror-controlled) entries
    // were dead — converted to demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.5 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    demographicEffects: [
      // State spending posture shapes public workers' economic lean directly
      // (state scope: full 1.0 multiplier — the fast lever vs the federal law).
      { groupId: "public_sector", target: "economicLean", direction: 1 },
      // State jobs/works programs reach low-propensity immigrant communities.
      { groupId: "new_immigrants", target: "turnout", direction: -0.5 },
    ],
    positions: standardCommitteePositions("Appropriations"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_spending_stimulus",
        [
          { name: "State New Deal Act", stance: "left", effectDirection: 1 },
          { name: "State Economic Stimulus Act", stance: "left", effectDirection: 1 },
          { name: "State Targeted Investment Act", stance: "left", effectDirection: 1 },
          { name: "State Fiscal Balance Act", stance: "center", effectDirection: 0 },
          { name: "State Spending Discipline Act", stance: "right", effectDirection: -1 },
          { name: "State Austerity Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Spending Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massive state spending program funding jobs, public works, and direct economic stimulus across all sectors",
          "Significantly increase state discretionary spending to boost local employment and public investment",
          "Modestly increase state spending focused on infrastructure projects and workforce programs",
          "A moderate level of state discretionary spending balancing investment needs with balanced budget requirements",
          "Reduce state discretionary spending through agency consolidation and program cuts",
          "Dramatically cut state spending to build rainy-day reserves and reduce the tax burden",
          "Eliminate nearly all state discretionary spending, funding only constitutionally mandated functions",
        ][i],
      })),
      [2153, 1722, 1292, 947, 603, 258, 0]
    ),
    allowedScope: "state",
  },
  // ── Infrastructure ──────────────────────────────────────────────────────
  {
    _id: "us_transportation",
    countryScope: "us",
    name: "Transportation Infrastructure Act",
    description: "Bills affecting roads, transit, and transportation funding",
    explanation:
      "Funds highways, bridges, public transit, and rail through the Highway Trust Fund. Left positions favor transit and green modes; right positions favor roads and state/private funding.",
    policyDomain: "infrastructure",
    subCategory: "Transportation",
    budgetCategory: "infrastructure",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "roadCondition",
      scope: "national",
    },
    // Phase A2: tradeoff — left expansion reduces economic freedom (more public
    // transit / regulation); right devolution improves it (private/market-based).
    effectTargetsWeighted: [
      ...weightedTargets({ category: "infrastructure", metric: "roadCondition" }, [
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "environment", metric: "airQuality", weight: 0.3 },
        { category: "infrastructure", metric: "publicTransit", weight: 0.6 },
        // NEGATIVE: the left (invest/expand) options are big spending → worse budget
        // balance; the right (devolve/privatise/eliminate) options cut federal outlay.
        // (Matches the sibling transport/infra bills, e.g. cn_rail_transport, ie_transport_rail.)
        { category: "governance", metric: "budgetBalance", weight: -0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    demographicEffects: [
      { groupId: "urban", direction: 0.01 }, // Transit investment favors urban areas
      { groupId: "suburban", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Transportation"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "transportation",
        [
          { name: "National Transit and Rail Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Highway and Transit Modernization Act", stance: "left", effectDirection: 1 },
          { name: "Surface Transportation Investment Act", stance: "left", effectDirection: 1 },
          { name: "Transportation Funding Act", stance: "center", effectDirection: 0 },
          { name: "State Transportation Devolution Act", stance: "right", effectDirection: -1 },
          { name: "Highway Privatization Act", stance: "right", effectDirection: -1 },
          { name: "Federal Transportation Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand federal investment in high-speed rail, urban transit systems, and universal public transportation access",
          "Significantly increase federal highway and transit funding, rebuild aging bridges, and expand intercity rail",
          "Modestly increase Highway Trust Fund contributions and fund targeted transit improvements in underserved areas",
          "A moderate level of federal transportation funding supporting highway maintenance, bridge safety, and transit grants",
          "Reduce federal transportation spending and shift road and transit funding responsibility to state governments",
          "Dramatically cut federal transportation spending, encouraging toll roads, private transit, and state-funded infrastructure",
          "Eliminate federal transportation programs entirely, leaving all road, bridge, and transit funding to states and private enterprise",
        ][i],
      })),
      [1273, 934, 636, 424, 255, 106, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_broadband_energy",
    countryScope: "us",
    name: "Broadband and Energy Infrastructure Act",
    description: "Bills affecting broadband access and electric grid",
    explanation:
      "Addresses internet access gaps in rural and underserved areas, plus electric grid modernization. Left positions favor municipal broadband and utility regulation; right positions favor market solutions.",
    policyDomain: "infrastructure",
    subCategory: "Broadband / energy",
    budgetCategory: "infrastructure",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "broadbandAccess" },
      [
        { category: "economic", metric: "gdpGrowth", weight: 0.4 },
        { category: "education", metric: "universityEnrollment", weight: 0.3 },
        { category: "environment", metric: "carbonEmissions", weight: 0.3 },
        { category: "infrastructure", metric: "powerGridReliability", weight: 0.4 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    demographicEffects: [
      { groupId: "rural", direction: 0.02 }, // Broadband expansion benefits rural areas most
    ],
    positions: standardCommitteePositions("Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "broadband_energy",
        [
          {
            name: "Universal Broadband and Grid Modernization Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Digital and Energy Infrastructure Act", stance: "left", effectDirection: 1 },
          { name: "Connected Communities Act", stance: "left", effectDirection: 1 },
          { name: "Infrastructure Services Act", stance: "center", effectDirection: 0 },
          { name: "Market-Driven Connectivity Act", stance: "right", effectDirection: -1 },
          { name: "Deregulated Energy and Telecom Act", stance: "right", effectDirection: -1 },
          { name: "Federal Infrastructure Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Build municipal broadband as a public utility in every community and fully modernize the national electric grid",
          "Significantly expand federal broadband subsidies, fund rural connectivity, and invest in grid resilience",
          "Modestly increase broadband buildout subsidies for underserved areas and fund targeted grid upgrades",
          "A moderate level of federal broadband and energy grid funding supporting ongoing deployment and maintenance",
          "Reduce federal broadband subsidies, relying on private ISPs and utility companies to expand service",
          "Dramatically cut federal broadband and grid programs, deregulating utilities and letting markets drive investment",
          "Eliminate federal broadband and energy grid programs, leaving all infrastructure to private companies and states",
        ][i],
      })),
      [679, 509, 339, 212, 106, 42, 0]
    ),
    nationalOnly: true,
  },
  // ── Environment ─────────────────────────────────────────────────────────
  {
    _id: "us_clean_energy",
    countryScope: "us",
    name: "Clean Energy Investment Act",
    description: "Bills affecting renewable energy and emissions",
    explanation:
      "Sets policy on renewable energy subsidies, carbon pricing, and fossil fuel regulations. Left positions favor aggressive climate action; right positions favor energy independence and market approaches.",
    policyDomain: "environment",
    subCategory: "Clean energy",
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "environment", metric: "renewableEnergy" }, [
        { category: "environment", metric: "airQuality", weight: 0.5 },
        // Strong environmental regulations initially decrease GDP (short-term economic adjustment)
        // but the economy adapts over time as companies adjust to new regulations
        { category: "economic", metric: "gdpGrowth", weight: -0.3 },
        { category: "environment", metric: "protectedLand", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "urban", direction: 0.01 }, // Clean energy jobs concentrate in urban areas
      { groupId: "college", direction: 0.01 }, // Green tech sector employs educated workers
    ],
    positions: standardCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "clean_energy",
        [
          { name: "Green New Deal Act", stance: "left", effectDirection: 1 },
          { name: "Carbon Tax and Clean Energy Act", stance: "left", effectDirection: 1 },
          { name: "Clean Energy Transition Act", stance: "left", effectDirection: 1 },
          { name: "All-Source Energy Act", stance: "center", effectDirection: 0 },
          { name: "Energy Independence Act", stance: "right", effectDirection: -1 },
          { name: "Fossil Fuel First Act", stance: "right", effectDirection: -1 },
          { name: "Energy Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate 100% renewable energy within a decade, ban new fossil fuel extraction, and fund a national clean energy jobs program",
          "Impose a federal carbon tax, massively subsidize renewable energy, and phase out fossil fuel power plants",
          "Accelerate renewable energy deployment through expanded tax credits, grants, and fossil fuel phase-down targets",
          "A balanced energy policy supporting renewables, natural gas, and nuclear without mandating or banning any source",
          "Prioritize domestic energy production across all sources, reducing regulations on oil, gas, and coal",
          "End renewable energy subsidies, expand fossil fuel leasing on federal lands, and roll back emissions regulations",
          "Eliminate all federal energy subsidies and environmental regulations, leaving energy markets entirely to private enterprise",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [464, 340, 216, 124, 62, 23, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_conservation",
    countryScope: "us",
    name: "Conservation and Public Lands Act",
    description: "Bills affecting protected lands and air/water quality",
    explanation:
      "Manages federal lands, national monuments, and environmental enforcement. Left positions favor expanded protections; right positions favor state control and resource extraction access.",
    policyDomain: "environment",
    subCategory: "Conservation",
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "protectedLand",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "environment", metric: "protectedLand" }, [
        { category: "environment", metric: "airQuality", weight: 0.4 },
        { category: "social", metric: "socialCohesion", weight: 0.3 },
        { category: "environment", metric: "carbonEmissions", weight: 0.4 },
        { category: "environment", metric: "recyclingRate", weight: 0.3 },
        { category: "environment", metric: "climateResilience", weight: 0.4 },
        { category: "infrastructure", metric: "waterQuality", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "rural", direction: -0.01 }, // Conservation can reduce rural economic activity
    ],
    positions: standardCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "conservation",
        [
          { name: "30x30 Conservation Act", stance: "left", effectDirection: 1 },
          { name: "Clean Air and Water Enforcement Act", stance: "left", effectDirection: 1 },
          { name: "Public Lands Investment Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Land Management Act", stance: "center", effectDirection: 0 },
          { name: "Multiple Use Lands Act", stance: "right", effectDirection: -1 },
          { name: "State Land Transfer Act", stance: "right", effectDirection: -1 },
          { name: "Federal Conservation Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Protect 30% of all US land and waters, expand national monuments, and ban resource extraction on federal lands",
          "Significantly strengthen EPA enforcement, expand wilderness protections, and increase national park funding",
          "Modestly expand conservation programs, increase park maintenance budgets, and restrict extraction in sensitive areas",
          "A moderate approach to conservation balancing environmental protection with responsible resource development",
          "Open more federal lands to logging, mining, and grazing while reducing environmental review requirements",
          "Transfer federal lands to state control, open protected areas to energy development, and reduce EPA authority",
          "Sell federal lands to private buyers, eliminate the EPA, and end all federal conservation programs",
        ][i],
      })),
      [155, 116, 77, 46, 23, 8, 0]
    ),
  },
  // ── Public Safety ──────────────────────────────────────────────────────
  {
    _id: "us_law_enforcement_criminal_justice",
    countryScope: "us",
    name: "Criminal Justice Reform Act",
    description: "Bills affecting policing and criminal justice",
    explanation:
      "Covers police funding, sentencing guidelines, prison reform, and federal crime policy. Left positions favor reform and alternatives to incarceration; right positions favor tougher sentences and police support.",
    policyDomain: "publicSafety",
    subCategory: "Law enforcement / criminal justice",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "crimeRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "publicSafety", metric: "crimeRate" }, [
      { category: "social", metric: "socialCohesion", weight: 0.4 },
      { category: "economic", metric: "povertyRate", weight: 0.3 },
      { category: "publicSafety", metric: "violentCrimeRate", weight: 0.5 },
      { category: "publicSafety", metric: "policePerCapita", weight: 0.3 },
      { category: "publicSafety", metric: "publicSafetyConfidence", weight: 0.4 },
      { category: "publicSafety", metric: "incarcerationRate", weight: 0.5 },
      // Right-lane axis metric: enforcement postures (right, effectDirection +1)
      // include interior cooperation with entry enforcement, a modest state-level
      // borderSecurity lever alongside the national immigration acts.
      { category: "governance", metric: "borderSecurity", weight: 0.4 },
    ]),
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "law_enforcement_criminal_justice",
        [
          {
            name: "Transformative Justice Act",
            stance: "left",
            effectDirection: -1,
          },
          { name: "Justice Reinvestment Act", stance: "left", effectDirection: -1 },
          {
            name: "Community Policing and Reform Act",
            stance: "left",
            effectDirection: -1,
          },
          { name: "Balanced Justice Act", stance: "center", effectDirection: 0 },
          { name: "Law and Order Reinforcement Act", stance: "right", effectDirection: 1 },
          { name: "Tough on Crime Act", stance: "right", effectDirection: 1 },
          { name: "Maximum Enforcement Act", stance: "right", effectDirection: 1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Defund federal law enforcement agencies, redirect spending to community services, restorative justice, and social workers",
          "Significantly reduce federal law enforcement budgets, end mandatory minimums, and fund diversion programs",
          "Modestly reform federal policing standards, increase accountability oversight, and fund community-based crime prevention",
          "A moderate level of federal law enforcement funding supporting investigation, prosecution, and community policing grants",
          "Increase federal law enforcement budgets, expand FBI and DEA operations, and strengthen mandatory sentencing",
          "Dramatically expand federal law enforcement, impose harsh mandatory minimums, and increase federal prosecutor staffing",
          "Massively expand federal law enforcement powers, militarize border and drug enforcement, and impose the harshest sentencing guidelines",
        ][i],
      })),
      [79, 118, 158, 197, 276, 395, 553]
    ),
  },
  {
    _id: "us_prison_rehabilitation",
    countryScope: "us",
    name: "Prison Rehabilitation and Sentencing Reform Act",
    description: "Federal funding for prisoner reentry and rehabilitation programs",
    explanation:
      "Funds job training, education, mental health services, and substance abuse treatment in federal prisons. Reduces recidivism by preparing inmates for successful reentry into society.",
    policyDomain: "publicSafety",
    subCategory: "Criminal justice reform",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "recidivismRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "publicSafety", metric: "recidivismRate" }, [
        { category: "publicSafety", metric: "crimeRate", weight: 0.4 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
        { category: "education", metric: "workforceSkill", weight: 0.2 },
        { category: "publicSafety", metric: "incarcerationRate", weight: 0.4 },
        { category: "social", metric: "socialMobility", weight: 0.2 },
      ])!,
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: 0.4 },
    ],
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "prison_rehabilitation",
        [
          {
            name: "Abolish Mass Incarceration Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "Comprehensive Rehabilitation Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "Second Chance Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "Corrections Funding Act",
            stance: "center",
            effectDirection: 0,
          },
          {
            name: "Prison Efficiency Act",
            stance: "right",
            effectDirection: -1,
          },
          { name: "Incarceration Expansion Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Incarceration Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Close federal prisons, replace incarceration with community supervision, restorative justice, and rehabilitation centers",
          "Dramatically reduce prison populations through early release, ban private prisons, and fund education and job training for inmates",
          "Expand reentry programs, increase prison education funding, and reduce sentences for nonviolent offenders",
          "A moderate level of federal prison funding balancing incarceration with rehabilitation and reentry services",
          "Reduce federal prison costs through private prison contracts, work programs, and streamlined administration",
          "Build new federal prisons, expand capacity, and lengthen sentences for repeat offenders",
          "Massively expand the federal prison system, impose life sentences for violent felons, and eliminate parole for federal crimes",
        ][i],
      })),
      [237, 197, 138, 99, 63, 158, 276]
    ),
  },
  // ── Defense (national only) ──────────────────────────────────────────────
  {
    _id: "us_defense_spending",
    countryScope: "us",
    name: "Defense Spending Act",
    description: "Bills affecting military budget and defense procurement",
    explanation:
      "Sets the Pentagon budget, weapons procurement, troop levels, and military readiness. Left positions favor reduced military spending; right positions favor military strength and modernization.",
    policyDomain: "defense",
    subCategory: "Defense spending",
    budgetCategory: "defense",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "budgetBalance",
      scope: "national",
    },
    // The old budgetBalance (mirror-controlled readout) and gdpGrowth
    // (engine-owned, overwritten every turn) weighted targets were dead —
    // converted to demographicEffects. The budget itself moves through the
    // real defense spending line (budgetCategory), which the mirror reads.
    // Federal scope divides by 1/50 per state, hence the high magnitudes.
    // Phase A2: tradeoff — defense expansion (right, effectDirection=+1)
    // stimulates defense-sector small business formation.
    effectTargetsWeighted: [
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: 0.1 },
    ],
    demographicEffects: [
      // Military communities are disproportionately rural: a buildup (right)
      // reinforces their right-economic lean; a peace dividend pulls it back.
      { groupId: "rural_traditionalists", target: "economicLean", direction: 0.75, magnitude: 2 },
      // A buildup mobilizes pro-military communities (bases, contractors);
      // drawdowns demobilize them.
      { groupId: "rural_traditionalists", target: "turnout", direction: 0.5, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Armed Services"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "defense_spending",
        [
          { name: "Peace Dividend Act", stance: "left", effectDirection: -1 },
          { name: "Military Drawdown Act", stance: "left", effectDirection: -1 },
          { name: "Responsible Defense Act", stance: "left", effectDirection: -1 },
          { name: "National Defense Act", stance: "center", effectDirection: 0 },
          { name: "Military Readiness Act", stance: "right", effectDirection: 1 },
          { name: "Peace Through Strength Act", stance: "right", effectDirection: 1 },
          { name: "Maximum Military Supremacy Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically slash the defense budget, close overseas bases, withdraw from international military commitments, and redirect military spending to domestic programs",
          "Significantly reduce defense spending, end foreign deployments, and shrink the active-duty force to a defensive posture",
          "Modestly reduce defense spending by cutting waste, consolidating bases, and canceling underperforming weapons programs",
          "A moderate level of defense spending sustaining force readiness, modernization, and alliance commitments",
          "Increase defense spending to modernize equipment, expand the Navy, and strengthen missile defense systems",
          "Dramatically expand the military with new weapons systems, increased troop levels, and expanded global basing",
          "The largest peacetime military buildup, ensuring overwhelming force projection capability across every domain and theater",
        ][i],
      })),
      [418, 836, 1505, 2090, 2675, 3344, 4180]
    ),
    nationalOnly: true,
  },
  // ── Foreign Policy (national only) ──────────────────────────────────────
  {
    _id: "us_foreign_policy",
    countryScope: "us",
    name: "Foreign Policy and Diplomacy Act",
    description: "Bills affecting foreign aid, diplomacy, and international relations",
    explanation:
      "Sets foreign aid levels, diplomatic priorities, and international engagement. Left positions favor multilateralism and aid; right positions favor unilateralism and reduced foreign commitments.",
    policyDomain: "foreign_policy",
    subCategory: "Foreign aid / diplomacy",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "budgetBalance",
      scope: "national",
    },
    // The old budgetBalance primary (mirror-controlled readout) was dead —
    // converted to demographicEffects; foreign-aid cost flows through the real
    // budget line. Federal scope divides by 1/50 per state, hence magnitudes.
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "population", metricId: "migrationRate", weight: 0.2 },
    ],
    demographicEffects: [
      // Internationalist engagement (left) mobilizes immigrant communities
      // (diaspora ties, welcoming posture); isolationism depresses turnout.
      { groupId: "new_immigrants", target: "turnout", direction: -0.75, magnitude: 2 },
      // Multilateral engagement nudges cosmopolitan professionals' social lean
      // left; isolationist retrenchment nudges it back right.
      { groupId: "secular_professionals", target: "socialLean", direction: 0.5, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Foreign Relations"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "foreign_policy",
        [
          {
            name: "Global Leadership and Aid Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Diplomacy First Act", stance: "left", effectDirection: 1 },
          {
            name: "International Partnership Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Balanced Foreign Engagement Act", stance: "center", effectDirection: 0 },
          { name: "America First Diplomacy Act", stance: "right", effectDirection: -1 },
          { name: "Foreign Aid Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Isolationist Foreign Policy Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand foreign aid, triple the State Department budget, and lead international institutions with generous funding commitments",
          "Significantly increase diplomatic staffing, expand USAID programs, and strengthen multilateral engagement and treaty commitments",
          "Modestly increase foreign aid and diplomatic funding, focusing on strategic partnerships and humanitarian assistance",
          "A moderate level of diplomatic and foreign aid spending supporting embassies, key alliances, and targeted development programs",
          "Reduce foreign aid, close underperforming embassies, and condition remaining assistance on alignment with US interests",
          "Dramatically cut the State Department and USAID budgets, withdraw from international organizations, and end most foreign assistance",
          "Eliminate foreign aid and diplomatic programs, withdraw from international organizations, and end all foreign commitments",
        ][i],
      })),
      [451, 316, 226, 158, 90, 36, 0]
    ),
    nationalOnly: true,
  },

  // ── Social Security & entitlements (economic + social: welfare/safety net) ─
  {
    _id: "us_social_security",
    countryScope: "us",
    name: "Social Security Act",
    description: "Bills affecting Social Security benefits, retirement age, and funding",
    explanation:
      "Manages the retirement system that provides income to seniors and disabled Americans. Left positions favor expanding benefits; right positions favor privatization or raising the retirement age to ensure solvency.",
    policyDomain: "economic",
    subCategory: "Entitlements",
    budgetCategory: "socialSecurity",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "povertyRate",
      scope: "national",
    },
    // Phase A2: tradeoff — left expansion reduces economic freedom; right privatization improves it.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "povertyRate" }, [
        { category: "economic", metric: "medianIncome", weight: 0.4 },
        { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
        { category: "social", metric: "foodInsecurity", weight: 0.3 },
        { category: "economic", metric: "laborParticipation", weight: -0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.2 },
    ],
    demographicEffects: [
      { groupId: "retirees", direction: 0.02 }, // SS expansion increases retiree population
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "social_security",
        [
          { name: "Universal Social Security Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Social Security Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Benefit Protection Act", stance: "left", effectDirection: 1 },
          { name: "Social Security Stability Act", stance: "center", effectDirection: 0 },
          { name: "Social Security Reform Act", stance: "right", effectDirection: -1 },
          { name: "Social Security Privatization Act", stance: "right", effectDirection: -1 },
          { name: "Social Security Abolition Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically increase benefits, lower the retirement age, and extend Social Security to cover all workers including gig and part-time",
          "Significantly raise benefit levels, remove the earnings cap on payroll contributions, and expand disability coverage",
          "Modestly increase Social Security benefits through cost-of-living adjustments and targeted supplements for low-income retirees",
          "A moderate level of Social Security benefits sustaining retirement, disability, and survivor payments at standard levels",
          "Gradually raise the retirement age, means-test benefits for wealthy retirees, and introduce voluntary private accounts",
          "Dramatically reduce guaranteed benefits, convert Social Security to private retirement accounts managed by individuals",
          "Eliminate Social Security entirely, leaving retirement savings to individual responsibility and private markets",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "povertyRate",
            // INV: expansion (left) reduces povertyRate; cuts (right) increase it.
            ratePerTurn: TICK_RATES_7_INV[i] ?? 0,
          },
        ],
      })),
      [5303, 4167, 3637, 3182, 2652, 1515, 0]
    ),
    nationalOnly: true,
  },

  // ── Medicare / Medicaid ─────────────────────────────────────────────────
  {
    _id: "us_medicaid",
    countryScope: "us",
    name: "Medicaid Services Act",
    description: "Bills affecting Medicaid eligibility and federal match",
    explanation:
      "The joint federal-state program providing healthcare to low-income Americans. Left positions favor expanded eligibility; right positions favor block grants or work requirements.",
    policyDomain: "healthcare",
    subCategory: "Medicaid",
    budgetCategory: "healthcare",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "uninsuredRate",
      scope: "national",
    },
    // §4.7 (P2b): lifeExpectancy secondary dropped — uninsuredRate (the coverage
    // root primary) is now an ENGINE input to the mortality/life-expectancy chain.
    // Phase A2: tradeoff — left expansion reduces economic freedom; right cuts improve it.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "healthcare", metric: "uninsuredRate" }, [
        { category: "economic", metric: "povertyRate", weight: 0.4 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.25 },
    ],
    demographicEffects: [
      { groupId: "poor", direction: 0.01 }, // Medicaid expansion helps low-income populations
      { groupId: "working_class", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "medicaid",
        [
          { name: "Expand eligibility; federal match", stance: "left", effectDirection: 1 },
          { name: "Federal floor for eligibility", stance: "left", effectDirection: 1 },
          { name: "Maintain expansion; no requirements", stance: "center", effectDirection: 0 },
          { name: "Block grant; current funding", stance: "right", effectDirection: -1 },
          { name: "Cap federal; state flexibility", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt) => ({
        ...opt,
      })),
      // Non-negative per-capita spending: maintaining/expanding Medicaid costs money;
      // block-grant/cap options are the LEAST costly (floored at 0), never negative
      // federal spending. The fiscal effect of capping flows through lower outlay, not
      // a budget credit.
      [1300, 900, 250, 100, 0]
    ),
    nationalOnly: true,
  },

  // ── Minimum wage & labor ───────────────────────────────────────────────
  {
    _id: "us_minimum_wage",
    countryScope: "us",
    name: "Federal Minimum Wage Act",
    description: "Bills affecting the federal minimum wage and tipped minimum",
    explanation:
      "Sets the floor for hourly wages nationwide. Higher minimum wage increases income for low-wage workers but may affect employment and prices. States may set higher minimums.",
    policyDomain: "economic",
    subCategory: "Labor",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "national",
    },
    // unemploymentRate intentionally omitted — minimum wage's effect on
    // unemployment is empirically contested; modelling it either way picks
    // a side, so the seed leaves it as no-op.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "medianIncome" }, [
        { category: "economic", metric: "povertyRate", weight: 0.5 },
        { category: "social", metric: "incomeInequality", weight: 0.4 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "working_class", direction: 0.01 }, // Minimum wage helps workers
      { groupId: "poor", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Education and Labor"),
    policyOptions: policyOptions(
      "minimum_wage",
      [
        { name: "Living Wage Guarantee Act", stance: "left", effectDirection: 1 },
        { name: "Worker Prosperity Act", stance: "left", effectDirection: 1 },
        { name: "Fair Wage Increase Act", stance: "left", effectDirection: 1 },
        { name: "Moderate Wage Standards Act", stance: "center", effectDirection: 0 },
        { name: "State Wage Flexibility Act", stance: "right", effectDirection: -1 },
        { name: "Employer Freedom Act", stance: "right", effectDirection: -1 },
        { name: "Minimum Wage Abolition Act", stance: "right", effectDirection: -1 },
      ],
      "both"
    ).map((opt, i) => ({
      ...opt,
      explanation: [
        "Mandate a $25.00/hour federal minimum wage indexed to inflation, with annual automatic adjustments",
        "Raise the federal minimum wage to $20.00/hour with scheduled annual increases tied to cost of living",
        "Raise the federal minimum wage to $17.00/hour with modest inflation indexing",
        "Set the federal minimum wage at $12.00/hour, balancing worker needs with small business sustainability",
        "Set the federal minimum wage at $7.25/hour and allow states to set their own wage floors based on local costs",
        "Reduce the federal minimum wage to $5.00/hour, letting market forces primarily determine compensation",
        "Eliminate the federal minimum wage ($0.00/hour), allowing wages to be set purely by supply and demand",
      ][i],
      minimumWageRate: [25.0, 20.0, 17.0, 12.0, 7.25, 5.0, 0.0][i],
      metricEffects: [
        {
          category: "economic" as const,
          metricId: "medianIncome",
          ratePerTurn: [0.4, 0.3, 0.2, 0.0, 0.0, -0.3, -0.4][i] ?? 0,
        },
        {
          category: "economic" as const,
          metricId: "smallBusinessFormation",
          ratePerTurn: [0, 0, 0, 0, 0.01, 0.01, 0.02][i] ?? 0,
        },
      ],
    })),
    nationalOnly: true,
  },
  {
    _id: "us_workforce_development",
    countryScope: "us",
    name: "Workforce Development and Training Act",
    description: "Federal job training, apprenticeships, and workforce programs",
    explanation:
      "Funds job training centers, apprenticeship programs, and community college partnerships. Improves workforce skills and employment outcomes, especially for underserved communities.",
    policyDomain: "economic",
    subCategory: "Workforce",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "workforceSkill",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "education", metric: "workforceSkill" }, [
        { category: "social", metric: "socialMobility", weight: 0.4 },
        { category: "publicSafety", metric: "recidivismRate", weight: 0.2 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      [
        {
          id: "workforce_development_opt_0",
          name: "Universal Jobs Guarantee Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -5,
          social: 0,
        },
        {
          id: "workforce_development_opt_1",
          name: "National Workforce Expansion Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -3,
          social: 0,
        },
        {
          id: "workforce_development_opt_2",
          name: "Worker Retraining Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -1,
          social: 0,
        },
        {
          id: "workforce_development_opt_3",
          name: "Workforce Services Act",
          stance: "center" as const,
          effectDirection: 0 as const,
          economic: 0,
          social: 0,
        },
        {
          id: "workforce_development_opt_4",
          name: "Private Sector Workforce Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 1,
          social: 0,
        },
        {
          id: "workforce_development_opt_5",
          name: "Workforce Program Reduction Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 3,
          social: 0,
        },
        {
          id: "workforce_development_opt_6",
          name: "Federal Workforce Elimination Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 5,
          social: 0,
        },
      ].map((opt, i) => ({
        ...opt,
        explanation: [
          "Create a federal jobs guarantee program providing employment to anyone who wants it, with full training and benefits",
          "Significantly expand federal job training, fund free community college partnerships, and create national apprenticeship programs",
          "Modestly increase funding for displaced worker retraining, trade adjustment assistance, and skills certification programs",
          "A moderate level of federal workforce funding supporting job centers, unemployment services, and targeted training grants",
          "Reduce federal workforce programs, incentivize employer-led training through tax credits and deregulation",
          "Dramatically cut federal job training budgets, eliminating most government-run employment programs",
          "Eliminate all federal workforce development programs, leaving job training entirely to employers and private institutions",
        ][i],
      })),
      [261, 174, 87, 43, 22, 9, 0]
    ),
    nationalOnly: true,
  },

  // ── Housing (economic + social: welfare and safety net) ─────────────────
  {
    _id: "us_housing",
    countryScope: "us",
    name: "Affordable Housing Act",
    description:
      "Bills affecting federal housing programs, vouchers, fair housing, and tenant protections",
    explanation:
      "Funds Section 8 vouchers, public housing, and affordable housing development. Left positions favor expanded subsidies and tenant protections; right positions favor local control and private markets.",
    policyDomain: "social",
    subCategory: "Housing",
    budgetCategory: "other",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "homelessnessRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "homelessnessRate" }, [
      { category: "economic", metric: "povertyRate", weight: 0.4 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.4 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
      // populationGrowth removed (§4.7 sweep — emerges from cohort flows); the
      // urbanizationRate lever stays (policy-drivable hybrid, exempt §4.7).
      { category: "population", metric: "urbanizationRate", weight: 0.2 },
    ]),
    demographicEffects: [
      { groupId: "urban", direction: 0.01 }, // Housing programs concentrate in urban areas
      { groupId: "poor", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Financial Services"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "housing",
        [
          { name: "Universal Housing Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Affordable Housing Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Housing Access Act", stance: "left", effectDirection: 1 },
          { name: "Federal Housing Services Act", stance: "center", effectDirection: 0 },
          { name: "Housing Market Freedom Act", stance: "right", effectDirection: -1 },
          { name: "HUD Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Federal Housing Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee housing as a federal right, massively expand public housing construction, and provide universal rental assistance",
          "Significantly expand Section 8 vouchers, fund new affordable housing construction, and strengthen tenant protections",
          "Modestly increase housing subsidies, expand down payment assistance programs, and fund homelessness prevention",
          "A moderate level of federal housing support funding Section 8 vouchers, FHA programs, and targeted homelessness assistance",
          "Reduce federal housing subsidies, ease zoning regulations, and rely on private markets to increase housing supply",
          "Dramatically cut HUD funding, phase out public housing, and eliminate most federal rental assistance programs",
          "Eliminate all federal housing programs, leaving housing entirely to private markets, local zoning, and individual responsibility",
        ][i],
      })),
      [461, 317, 202, 115, 58, 23, 0]
    ),
  },
  {
    _id: "us_state_housing",
    countryScope: "us",
    name: "State Housing and Development Act",
    description: "State housing programs, affordable housing construction, and tenant protections",
    explanation:
      "State-level housing programs including affordable housing construction, rental assistance, and homelessness prevention. Left positions favor expanded subsidies and tenant protections; right positions favor deregulation and private market solutions.",
    policyDomain: "social",
    subCategory: "Housing",
    budgetCategory: "other",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "homelessnessRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "homelessnessRate" }, [
      { category: "economic", metric: "povertyRate", weight: 0.4 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.4 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
    ]),
    demographicEffects: [
      { groupId: "urban", direction: 0.01 }, // Housing programs concentrate in urban areas
      { groupId: "poor", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Housing"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_housing",
        [
          { name: "State Housing Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "State Affordable Housing Act", stance: "left", effectDirection: 1 },
          { name: "State Housing Investment Act", stance: "left", effectDirection: 1 },
          { name: "State Housing Services Act", stance: "center", effectDirection: 0 },
          { name: "State Housing Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Housing Act", stance: "right", effectDirection: -1 },
          { name: "State Housing Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Build state-funded public housing in every county, guarantee rental assistance for all low-income residents, and impose strict rent control",
          "Significantly expand state affordable housing construction, increase rental subsidies, and strengthen tenant eviction protections",
          "Modestly increase state housing trust fund contributions, expand down payment assistance, and fund homelessness shelters",
          "A moderate level of state housing support funding affordable housing grants, rental vouchers, and homelessness programs",
          "Reduce state housing spending, relax zoning restrictions, and incentivize private developers to build affordable units",
          "Cut state housing programs to emergency shelter funding only, eliminating rental assistance and construction subsidies",
          "Eliminate all state housing programs, leaving housing supply and affordability entirely to private markets and local government",
        ][i],
      })),
      [288, 202, 130, 87, 43, 14, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_food_nutrition",
    countryScope: "us",
    name: "National Food Security and Nutrition Act",
    description: "SNAP expansion, school meals, and nutrition assistance",
    explanation:
      "Federal nutrition programs including SNAP, WIC, school meals, and food desert initiatives. Affects food security and public health outcomes.",
    policyDomain: "social",
    subCategory: "Welfare",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foodInsecurity",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "foodInsecurity" }, [
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.2 },
      { category: "healthcare", metric: "publicHealthPreparedness", weight: 0.2 },
      { category: "economic", metric: "povertyRate", weight: 0.3 },
    ]),
    positions: standardCommitteePositions("Agriculture"),
    budgetCategory: "other",
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "food_nutrition",
        [
          { name: "Universal Meal Security Act", stance: "left", effectDirection: 1 },
          { name: "Hunger Elimination Act", stance: "left", effectDirection: 1 },
          { name: "Nutrition Access Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Federal Nutrition Services Act", stance: "center", effectDirection: 0 },
          { name: "Targeted Nutrition Act", stance: "right", effectDirection: -1 },
          { name: "Reduced Federal Nutrition Act", stance: "right", effectDirection: -1 },
          { name: "Federal Nutrition Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee free meals for all Americans through expanded SNAP, universal school meals, and federal community kitchens",
          "Significantly expand SNAP benefits, fund WIC for all eligible families, and guarantee free breakfast and lunch in every school",
          "Modestly expand SNAP eligibility, increase WIC funding, and extend free school meals to more low-income students",
          "A moderate level of federal food assistance funding SNAP, WIC, and school meal programs for qualifying households",
          "Tighten SNAP eligibility, add work requirements, and focus food assistance on verified low-income families with children",
          "Dramatically cut SNAP and WIC budgets, eliminate broad-based school meal programs, and limit food aid to emergency situations",
          "Eliminate all federal food assistance programs, leaving hunger relief to state governments, charities, and food banks",
        ][i],
      })),
      [577, 433, 317, 231, 144, 58, 0]
    ),
  },

  // ── Immigration ─────────────────────────────────────────────────────────
  {
    _id: "us_border_security_enforcement",
    countryScope: "us",
    name: "Border Security and Immigration Enforcement Act",
    description: "Border security funding, enforcement priorities, and deportation policy",
    explanation:
      "Controls border patrol funding, detention facilities, deportation priorities, and interior enforcement. Left positions favor humanitarian enforcement and reduced detention; right positions favor strict enforcement and border barriers.",
    policyDomain: "immigration",
    subCategory: "Border enforcement",
    effectTarget: {
      metricCategoryId: "population",
      metricId: "migrationRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "population", metric: "migrationRate" }, [
        { category: "publicSafety", metric: "publicSafetyConfidence", weight: 0.3 },
        { category: "publicSafety", metric: "crimeRate", weight: 0.2 },
      ])!,
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
      // Right-lane axis metric: tighter enforcement (right, effectDirection -1)
      // raises borderSecurity; open-border options lower it.
      { metricCategoryId: "governance" as const, metricId: "borderSecurity", weight: -1.0 },
      // Two-sided tradeoff: restriction narrows the labor supply, a small cost
      // to economicFreedom; looser entry is a small boost.
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: 0.15 },
    ],
    demographicEffects: [
      { groupId: "rural", direction: 0.01 }, // Border communities affected
    ],
    positions: standardCommitteePositions("Homeland Security"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "border_security_enforcement",
        [
          { name: "Open Borders Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Enforcement Reform Act", stance: "left", effectDirection: 1 },
          { name: "Humane Border Management Act", stance: "left", effectDirection: 1 },
          { name: "Border Security Act", stance: "center", effectDirection: 0 },
          { name: "Enhanced Border Security Act", stance: "right", effectDirection: -1 },
          { name: "Secure the Border Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Border Enforcement Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish ICE and CBP, decriminalize border crossing, and replace enforcement with processing and welcome centers",
          "Significantly reduce deportation operations, end detention of families, and shift funding from enforcement to immigration courts",
          "Modestly reform enforcement with alternatives to detention, asylum processing improvements, and reduced militarization of the border",
          "A moderate level of border enforcement funding supporting CBP operations, immigration courts, and targeted interior enforcement",
          "Increase border patrol staffing, expand surveillance technology, and accelerate deportation of unauthorized immigrants",
          "Dramatically expand border infrastructure, hire thousands of new agents, mandate E-Verify, and fund mass deportation operations",
          "Build comprehensive border barriers, deploy military assets to the border, and establish zero-tolerance enforcement with immediate removal",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "migrationRate",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [20, 32, 48, 64, 100, 160, 280]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_legal_immigration_visas",
    countryScope: "us",
    name: "Legal Immigration and Visa Policy Act",
    description: "Legal immigration levels, visa categories, and pathways to citizenship",
    explanation:
      "Sets annual immigration caps, visa categories (family, employment, diversity), and naturalization requirements. Left positions favor expanded legal pathways; right positions favor reduced immigration and merit-based selection.",
    policyDomain: "immigration",
    subCategory: "Legal pathways",
    effectTarget: {
      metricCategoryId: "population",
      metricId: "migrationRate",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "population", metric: "migrationRate" }, [
        { category: "education", metric: "workforceSkill", weight: 0.3 },
        { category: "economic", metric: "gdpGrowth", weight: 0.2 },
        // populationGrowth removed (§4.7 sweep) — it emerges from the migration flow.
        // Sex composition is NOT wired here: the cohort migration flow already shifts
        // sexRatio via its migrant sex profile, so a direct law effect would
        // double-count (sexRatio stays emergent, §4.7).
      ])!,
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
      // Right-lane axis metric: tighter visa regimes (right) raise borderSecurity
      // modestly; expansion lowers it. Weaker than the enforcement act.
      { metricCategoryId: "governance" as const, metricId: "borderSecurity", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "urban", direction: 0.02 }, // Immigrants tend to settle in urban areas
      { groupId: "young_adults", direction: 0.01 }, // Immigration affects age demographics
    ],
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "legal_immigration_visas",
        [
          { name: "Open Immigration Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Modernization Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Standards Act", stance: "center", effectDirection: 0 },
          { name: "Immigration Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Immigration Restriction Act", stance: "right", effectDirection: -1 },
          { name: "Immigration Moratorium Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically expand legal immigration, create automatic pathways to citizenship, and welcome unlimited refugees and asylum seekers",
          "Significantly increase visa quotas, create new worker pathways, expand refugee admissions, and provide amnesty for long-term residents",
          "Modestly expand legal immigration, streamline visa processing, and create targeted pathways for high-demand occupations",
          "A moderate immigration system processing visa applications, admitting refugees at standard levels, and enforcing overstay rules",
          "Reduce legal immigration quotas, tighten visa requirements, and prioritize merit-based admissions over family reunification",
          "Dramatically cut legal immigration, impose strict caps on all visa categories, and suspend refugee admissions",
          "Halt nearly all legal immigration, eliminate diversity visas, cap family visas, and end refugee resettlement programs",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "migrationRate",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [40, 28, 20, 12, 8, 4, 0]
    ),
    nationalOnly: true,
  },

  // ── Government Ethics ─────────────────────────────────────────────────
  {
    _id: "us_government_ethics",
    countryScope: "us",
    name: "Government Ethics and Transparency Act",
    description: "Ethics rules, lobbying reform, and transparency requirements",
    explanation:
      "Federal ethics standards for officials including financial disclosure, lobbying restrictions, and transparency. Affects public trust and corruption levels.",
    policyDomain: "governance",
    subCategory: "Ethics",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "governmentTransparency" },
      [
        { category: "governance", metric: "publicTrust", weight: 0.5 },
        { category: "mediaInformation", metric: "newsTrust", weight: 0.2 },
      ]
    ),
    positions: standardCommitteePositions("Oversight"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "government_ethics",
        [
          {
            name: "Maximum Transparency and Anti-Corruption Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Government Accountability Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Ethics Reform Act", stance: "left", effectDirection: 1 },
          { name: "Government Ethics Standards Act", stance: "center", effectDirection: 0 },
          { name: "Streamlined Ethics Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Ethics Oversight Act", stance: "right", effectDirection: -1 },
          { name: "Ethics Office Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate full financial disclosure for all officials, ban congressional stock trading, create an independent anti-corruption agency, and expand whistleblower protections",
          "Significantly strengthen inspector general powers, expand lobbying restrictions, and mandate public disclosure of all government contracts",
          "Modestly strengthen conflict-of-interest rules, expand FOIA compliance, and increase ethics office staffing",
          "A moderate level of ethics enforcement covering financial disclosure, revolving door restrictions, and inspector general oversight",
          "Reduce ethics reporting requirements, consolidate inspector general offices, and ease restrictions on post-government employment",
          "Dramatically reduce government ethics enforcement, eliminate most disclosure requirements, and defund inspector general offices",
          "Eliminate all federal ethics oversight agencies, leaving accountability to elections and the court system",
        ][i],
      })),
      [54, 36, 22, 11, 6, 2, 0]
    ),
  },
  {
    _id: "us_civics_voting_rights",
    countryScope: "us",
    name: "Voting Rights and Civic Participation Act",
    description: "Federal voting standards and civic engagement programs",
    explanation:
      "Federal voting rights protections, election standards, and civic education. Complements state voting laws with national standards.",
    policyDomain: "governance",
    subCategory: "Voting",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "civicParticipation",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "civicParticipation" }, [
      { category: "governance", metric: "voterTurnout", weight: 0.5 },
      { category: "governance", metric: "publicTrust", weight: 0.2 },
    ]),
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "civics_voting_rights",
        [
          { name: "Universal Voting Rights Act", stance: "left", effectDirection: 1 },
          { name: "Voting Access Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Civic Participation Act", stance: "left", effectDirection: 1 },
          { name: "Election Administration Act", stance: "center", effectDirection: 0 },
          { name: "Election Integrity Act", stance: "right", effectDirection: -1 },
          { name: "Strict Election Security Act", stance: "right", effectDirection: -1 },
          { name: "Federal Election Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate automatic voter registration, make Election Day a federal holiday, ban gerrymandering, and guarantee universal mail-in voting",
          "Significantly expand early voting, fund election security upgrades, restore voting rights for felons, and ban voter roll purges",
          "Modestly expand voter registration access, increase election security funding, and standardize ballot access requirements",
          "A moderate level of federal election support funding voting infrastructure, poll worker training, and election security",
          "Require voter ID, reduce early voting windows, and tighten voter roll maintenance procedures",
          "Mandate photo ID, proof of citizenship for registration, limit mail-in voting to absentee only, and reduce federal election mandates",
          "Eliminate all federal election mandates and funding, leaving voter eligibility, registration, and election administration entirely to states",
        ][i],
      })),
      [36, 25, 14, 7, 4, 1, 0]
    ),
    nationalOnly: true,
  },

  // ── State Infrastructure ───────────────────────────────────────────────
  {
    _id: "us_state_transportation",
    countryScope: "us",
    name: "State Transportation Act",
    description: "State bills affecting gas taxes, road maintenance, and transit funding",
    explanation:
      "Sets state gas taxes, road maintenance priorities, and transit funding. Affects commute times, economic development, and air quality in the state.",
    policyDomain: "infrastructure",
    subCategory: "Transportation",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "roadCondition",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "roadCondition" },
      [
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "infrastructure", metric: "publicTransit", weight: 0.6 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    demographicEffects: [
      { groupId: "suburban", direction: 0.01 }, // State roads benefit suburbs
      { groupId: "rural", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Transportation"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_transportation",
        [
          { name: "State Transit Transformation Act", stance: "left", effectDirection: 1 },
          { name: "State Road and Transit Expansion Act", stance: "left", effectDirection: 1 },
          { name: "State Infrastructure Improvement Act", stance: "left", effectDirection: 1 },
          { name: "State Transportation Services Act", stance: "center", effectDirection: 0 },
          { name: "State Transportation Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Roads Act", stance: "right", effectDirection: -1 },
          { name: "State Transportation Privatization Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand state highways, build new public transit systems, and fund statewide rail connections",
          "Significantly increase state highway and transit budgets, repair aging bridges, and expand bus networks",
          "Modestly increase state transportation funding for road resurfacing, safety upgrades, and transit improvements",
          "A moderate level of state transportation funding covering road maintenance, bridge inspections, and transit operations",
          "Reduce state transportation budgets through prioritization, deferred maintenance, and toll-funded projects",
          "Cut state transportation spending to emergency repairs only, relying on tolls and local funding for improvements",
          "Eliminate state transportation programs, privatizing roads through toll systems and leaving transit to private operators",
        ][i],
      })),
      [1273, 1018, 806, 595, 382, 170, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_utilities",
    countryScope: "us",
    name: "State Utilities and Infrastructure Act",
    description: "State regulation of utilities, grid modernization, and broadband",
    explanation:
      "Regulates electric, gas, and internet utilities. Affects electricity costs, reliability, renewable energy adoption, and broadband access in rural areas.",
    policyDomain: "infrastructure",
    subCategory: "Broadband / energy",
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "broadbandAccess" },
      [
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "environment", metric: "renewableEnergy", weight: 0.3 },
        { category: "infrastructure", metric: "powerGridReliability", weight: 0.4 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    demographicEffects: [
      { groupId: "rural", direction: 0.02 }, // Utility expansion helps rural areas
    ],
    positions: standardCommitteePositions("Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_utilities",
        [
          { name: "Universal State Utilities Act", stance: "left", effectDirection: 1 },
          { name: "State Utility Modernization Act", stance: "left", effectDirection: 1 },
          { name: "Utility Infrastructure Investment Act", stance: "left", effectDirection: 1 },
          { name: "State Utility Services Act", stance: "center", effectDirection: 0 },
          { name: "Utility Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Utility Act", stance: "right", effectDirection: -1 },
          { name: "State Utility Privatization Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Establish state-run public utilities for water, electricity, and broadband with guaranteed universal service",
          "Significantly expand state utility infrastructure, fund water system upgrades, and build public broadband networks",
          "Modestly increase state spending on water treatment, sewer upgrades, and rural broadband expansion",
          "A moderate level of state utility funding covering water safety, sewer maintenance, and grid reliability",
          "Reduce state utility spending and open markets to private competition for electricity, water, and broadband",
          "Cut state utility budgets to safety-critical functions only, privatizing service delivery",
          "Eliminate state utility programs entirely, selling public infrastructure to private companies",
        ][i],
      })),
      [764, 594, 446, 339, 212, 85, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_emergency_services",
    countryScope: "us",
    name: "Emergency Services Management Act",
    description: "Funding for fire, EMS, and disaster response",
    explanation:
      "Funds fire departments, ambulance services, and disaster response. Affects response times, emergency preparedness, and public safety in the state.",
    policyDomain: "publicSafety",
    subCategory: "Emergency services",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "publicSafety", metric: "publicSafetyConfidence" }, [
        { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
        { category: "healthcare", metric: "preventableMortality", weight: 0.4 },
      ])!,
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: 0.4 },
    ],
    positions: standardCommitteePositions("Public Safety"),
    policyOptions: withPerCapitaCosts(
      [
        {
          id: "emergency_services_opt_0",
          name: "Comprehensive Emergency Services Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -3,
          social: -3,
        },
        {
          id: "emergency_services_opt_1",
          name: "Emergency Services Expansion Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -2,
          social: -2,
        },
        {
          id: "emergency_services_opt_2",
          name: "Emergency Readiness Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -1,
          social: -1,
        },
        {
          id: "emergency_services_opt_3",
          name: "Emergency Services Funding Act",
          stance: "center" as const,
          effectDirection: 0 as const,
          economic: 0,
          social: 0,
        },
        {
          id: "emergency_services_opt_4",
          name: "Emergency Services Efficiency Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 1,
          social: 1,
        },
        {
          id: "emergency_services_opt_5",
          name: "Minimal Emergency Services Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 2,
          social: 2,
        },
        {
          id: "emergency_services_opt_6",
          name: "Emergency Services Privatization Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 3,
          social: 3,
        },
      ].map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee professional fire and EMS in every community, build state disaster response centers, and fund advanced 911 systems with mental health dispatch",
          "Significantly expand state fire and EMS staffing, upgrade disaster preparedness equipment, and fund community emergency training programs",
          "Modestly increase state emergency services funding for equipment upgrades, EMS training, and disaster preparedness planning",
          "A moderate level of state emergency services funding supporting fire departments, EMS operations, and basic disaster response capability",
          "Reduce state emergency costs through volunteer fire departments, consolidated dispatch centers, and mutual aid agreements",
          "Cut state emergency services to bare-minimum 911 dispatch, relying on volunteer firefighters and private ambulance companies",
          "Eliminate state-funded emergency services, privatizing fire, EMS, and disaster response through subscription services and private contracts",
        ][i],
      })),
      [474, 375, 296, 237, 158, 79, 0]
    ),
  },

  // ── State Economic & Labor ─────────────────────────────────────────────
  {
    _id: "us_state_labor",
    countryScope: "us",
    name: "State Labor Standards Act",
    description: "Minimum wage, right-to-work, and union protections",
    explanation:
      "Sets state minimum wage (can exceed federal), union rules, and worker protections. Right-to-work laws prohibit mandatory union fees; left positions favor stronger union rights.",
    policyDomain: "economic",
    subCategory: "Labor",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "medianIncome" }, [
        { category: "economic", metric: "povertyRate", weight: 0.4 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    demographicEffects: [{ groupId: "working_class", direction: 0.01 }],
    positions: standardCommitteePositions("Labor"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_labor",
        [
          { name: "Maximum Worker Protection Act", stance: "left", effectDirection: 1 },
          { name: "Worker Rights Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Fair Workplace Standards Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Labor Standards Act", stance: "center", effectDirection: 0 },
          { name: "Business Flexibility Act", stance: "right", effectDirection: -1 },
          { name: "Right to Work Act", stance: "right", effectDirection: -1 },
          { name: "Full Labor Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate paid family leave, guarantee union organizing rights, require employer-funded benefits, and expand workplace safety enforcement",
          "Significantly strengthen state labor laws with paid sick leave mandates, overtime protections, and anti-retaliation rules",
          "Modestly expand worker protections with enhanced safety inspections, wage theft enforcement, and workplace discrimination rules",
          "A moderate level of state labor regulation covering wage and hour enforcement, safety inspections, and dispute resolution",
          "Reduce state labor regulations, ease overtime rules, and limit employer mandate requirements",
          "Dramatically reduce union power, eliminate most employer mandates, and minimize state labor enforcement",
          "Eliminate all state labor regulations beyond federal minimums, allowing fully market-driven employment terms",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "medianIncome",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [109, 72, 43, 26, 11, 4, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_minimum_wage",
    countryScope: "us",
    name: "State Minimum Wage Act",
    description: "State minimum wage above the federal floor",
    explanation:
      "States can set minimum wages higher than the federal minimum ($7.25). Higher state minimums increase worker pay but may affect small business costs and employment.",
    policyDomain: "economic",
    subCategory: "Labor",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "state",
    },
    // unemploymentRate intentionally omitted — see us_minimum_wage rationale.
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "medianIncome" }, [
        { category: "economic", metric: "povertyRate", weight: 0.5 },
        { category: "social", metric: "incomeInequality", weight: 0.5 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "working_class", direction: 0.01 },
      { groupId: "poor", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Labor"),
    policyOptions: policyOptions(
      "state_minimum_wage",
      [
        { name: "State Living Wage Act", stance: "left", effectDirection: 1 },
        { name: "State Worker Prosperity Act", stance: "left", effectDirection: 1 },
        { name: "State Fair Wage Act", stance: "left", effectDirection: 1 },
        { name: "State Wage Standards Act", stance: "center", effectDirection: 0 },
        { name: "State Wage Deference Act", stance: "right", effectDirection: -1 },
        { name: "State Employer Freedom Act", stance: "right", effectDirection: -1 },
        { name: "State Minimum Wage Abolition Act", stance: "right", effectDirection: -1 },
      ],
      "both"
    ).map((opt, i) => ({
      ...opt,
      explanation: [
        "Mandate a $25.00/hour state minimum wage indexed to inflation, with annual automatic adjustments",
        "Raise the state minimum wage to $20.00/hour with scheduled annual increases tied to cost of living",
        "Raise the state minimum wage to $17.00/hour with modest inflation indexing",
        "Set the state minimum wage at $12.00/hour, balancing worker needs with small business sustainability",
        "Set the state minimum wage at $7.25/hour, deferring to the federal floor",
        "Reduce the state minimum wage to $5.00/hour, letting local market forces determine compensation",
        "Eliminate the state minimum wage entirely, deferring to the federal rate or allowing pure market wages",
      ][i],
      minimumWageRate: [25.0, 20.0, 17.0, 12.0, 7.25, 5.0, 0.0][i],
      metricEffects: [
        {
          category: "economic" as const,
          metricId: "medianIncome",
          ratePerTurn: [0.4, 0.3, 0.2, 0.0, 0.0, -0.3, -0.4][i] ?? 0,
        },
        {
          category: "economic" as const,
          metricId: "smallBusinessFormation",
          ratePerTurn: [0, 0, 0, 0, 0.01, 0.01, 0.02][i] ?? 0,
        },
      ],
    })),
    allowedScope: "state",
  },
  {
    _id: "us_state_workforce_development",
    countryScope: "us",
    name: "State Workforce Development Act",
    description: "State job training and workforce development programs",
    explanation:
      "State-level job training, vocational education, and workforce partnerships. States can tailor programs to local industry needs.",
    policyDomain: "economic",
    subCategory: "Workforce",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "workforceSkill",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "education", metric: "workforceSkill" }, [
        { category: "social", metric: "socialMobility", weight: 0.4 },
        { category: "publicSafety", metric: "recidivismRate", weight: 0.2 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      [
        {
          id: "state_workforce_development_opt_0",
          name: "State Jobs Guarantee Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -5,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_1",
          name: "State Workforce Expansion Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -3,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_2",
          name: "State Retraining Act",
          stance: "left" as const,
          effectDirection: 1 as const,
          economic: -1,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_3",
          name: "State Workforce Services Act",
          stance: "center" as const,
          effectDirection: 0 as const,
          economic: 0,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_4",
          name: "State Private Sector Training Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 1,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_5",
          name: "Minimal State Workforce Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 3,
          social: 0,
        },
        {
          id: "state_workforce_development_opt_6",
          name: "State Workforce Elimination Act",
          stance: "right" as const,
          effectDirection: -1 as const,
          economic: 5,
          social: 0,
        },
      ].map((opt, i) => ({
        ...opt,
        explanation: [
          "Create a state jobs program providing employment to any resident who wants it, with training and placement services",
          "Significantly expand state job training centers, fund community college partnerships, and create state apprenticeship programs",
          "Modestly increase state funding for displaced worker retraining, vocational education, and skills certification",
          "A moderate level of state workforce funding supporting job centers, unemployment offices, and targeted training programs",
          "Reduce state workforce programs, incentivize employer-led training through state tax credits",
          "Cut state job training to bare essentials, eliminating most government-run employment programs",
          "Eliminate all state workforce development programs, leaving job training entirely to employers and private institutions",
        ][i],
      })),
      [174, 109, 65, 43, 22, 9, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_education_funding",
    countryScope: "us",
    name: "State K-12 Education Funding Act",
    description: "State K-12 education spending and school funding formulas",
    explanation:
      "Controls state spending on public schools, teacher salaries, and education programs. Most school funding comes from states and localities, not the federal government.",
    policyDomain: "education",
    subCategory: "State funding",
    budgetCategory: "education",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "state",
    },
    // §4.7 (P2a) sweep, applied here for ticket #826 item 14: the readout
    // secondaries (gradRate/testPerf/literacy/college/workforceSkill)
    // double-counted — this law's education spend now drives them via the
    // engine's spending channel, same as its federal sibling
    // (us_federal_education_funding). Primary educationSpending root only.
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    demographicEffects: [{ groupId: "college", direction: 0.02 }],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_education_funding",
        [
          { name: "Maximum State School Investment Act", stance: "left", effectDirection: 1 },
          { name: "Expanded School Funding Act", stance: "left", effectDirection: 1 },
          { name: "Education Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "State Education Baseline Act", stance: "center", effectDirection: 0 },
          { name: "Education Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Education Act", stance: "right", effectDirection: -1 },
          { name: "State Education Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund universal pre-K, reduce class sizes to 15, and guarantee wraparound services in every school district",
          "Significantly increase per-pupil spending, hire more teachers, and expand special education services",
          "Modestly increase school funding with targeted investments in underperforming districts",
          "A standard level of state K-12 funding covering core instructional needs and facilities",
          "Reduce per-pupil spending through consolidation, larger class sizes, and administrative streamlining",
          "Cut state education funding to essentials only, relying on local property taxes and private alternatives",
          "Eliminate state-funded public education, leaving schooling entirely to local districts and private institutions",
        ][i],
      })),
      [3040, 2432, 1911, 1476, 1042, 521, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_higher_education",
    countryScope: "us",
    name: "State Higher Education Act",
    description: "State university funding and college affordability",
    explanation:
      "Funds state universities, community colleges, and financial aid programs. Affects tuition costs and access to higher education for state residents.",
    policyDomain: "education",
    subCategory: "Higher education",
    effectTarget: {
      metricCategoryId: "education",
      metricId: "universityEnrollment",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "education", metric: "universityEnrollment" },
      [
        { category: "economic", metric: "medianIncome", weight: 0.4 },
        { category: "education", metric: "testPerformance", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.2 },
      ]
    ),
    demographicEffects: [
      { groupId: "college", direction: 0.03 },
      { groupId: "young_adults", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_higher_education",
        [
          { name: "Universal Free College Act", stance: "left", effectDirection: 1 },
          { name: "Free State College Act", stance: "left", effectDirection: 1 },
          { name: "Higher Education Investment Act", stance: "left", effectDirection: 1 },
          { name: "State University Funding Act", stance: "center", effectDirection: 0 },
          { name: "Higher Education Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State College Support Act", stance: "right", effectDirection: -1 },
          { name: "Higher Education Privatization Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee tuition-free public university and community college for all state residents with full living stipends",
          "Guarantee tuition-free public university and community college for all state residents",
          "Significantly expand state university funding, increase financial aid, and freeze tuition rates",
          "A moderate level of state support for public universities and community colleges",
          "Reduce state university subsidies, raise tuition, and prioritize workforce-relevant programs",
          "Drastically cut state university funding, shifting costs almost entirely to students through tuition and loans",
          "Eliminate state funding for public universities, converting them to self-sustaining tuition-driven institutions",
        ][i],
      })),
      [869, 651, 434, 261, 130, 43, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_environment",
    countryScope: "us",
    name: "State Environmental Protection Act",
    description: "State environmental regulations and clean energy mandates",
    explanation:
      "Sets state-level environmental rules, renewable energy standards, and emissions limits. States can be more aggressive than federal policy on climate and pollution.",
    policyDomain: "environment",
    subCategory: "Clean energy",
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "environment", metric: "renewableEnergy" }, [
        { category: "environment", metric: "airQuality", weight: 0.5 },
        { category: "economic", metric: "gdpGrowth", weight: 0.2 },
        { category: "environment", metric: "carbonEmissions", weight: 0.4 },
        { category: "environment", metric: "recyclingRate", weight: 0.5 },
        { category: "environment", metric: "climateResilience", weight: 0.4 },
        { category: "infrastructure", metric: "waterQuality", weight: 0.3 },
        { category: "environment", metric: "protectedLand", weight: 0.4 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "urban", direction: 0.01 },
      { groupId: "college", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_environment",
        [
          { name: "State Green Mandate Act", stance: "left", effectDirection: 1 },
          { name: "State Clean Energy Leadership Act", stance: "left", effectDirection: 1 },
          { name: "State Environmental Investment Act", stance: "left", effectDirection: 1 },
          { name: "State Environmental Standards Act", stance: "center", effectDirection: 0 },
          { name: "State Environmental Streamlining Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Environmental Act", stance: "right", effectDirection: -1 },
          { name: "State Environmental Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate 100% renewable energy for the state, ban fossil fuel vehicles, and create state-run clean energy programs",
          "Significantly expand state renewable energy incentives, tighten emissions standards, and fund electric vehicle infrastructure",
          "Modestly increase state environmental spending on clean water, air quality monitoring, and recycling programs",
          "A moderate level of state environmental regulation and spending covering air quality, water safety, and waste management",
          "Reduce state environmental regulations and permit requirements to attract business investment",
          "Cut state environmental agencies to essential water safety functions only, eliminating climate and conservation programs",
          "Eliminate state environmental agencies and regulations entirely, leaving environmental protection to federal law and private action",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [124, 93, 54, 31, 15, 6, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_business_regulation",
    countryScope: "us",
    name: "State Business Regulation Act",
    description: "State business regulations, licensing, and economic development",
    explanation:
      "Controls business licensing requirements, regulations, and state economic development incentives. Affects business climate and job growth.",
    policyDomain: "economic",
    subCategory: "Business",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        { category: "economic", metric: "costOfLiving", weight: 0.2 },
        // gdpGrowth entry removed: engine-owned metric, the weighted target was
        // dead — converted to the demographicEffects below.
      ]
    ),
    demographicEffects: [
      // Deregulation (right) entrenches pro-market lean among business owners;
      // heavy regulation radicalizes fewer owners than it converts (state
      // scope: full multiplier — flagship lean lever of the v2 tranche).
      { groupId: "small_business", target: "economicLean", direction: 1, magnitude: 1.5 },
      // A business-friendly climate mobilizes owner participation (chambers of
      // commerce networks); a hostile one sees owners disengage from politics.
      { groupId: "small_business", target: "turnout", direction: 0.5 },
    ],
    positions: standardCommitteePositions("Commerce"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_business_regulation",
        [
          {
            name: "Strong worker; limit subsidies",
            stance: "left",
            effectDirection: -1,
          },
          { name: "Paid leave; consumer protections", stance: "left", effectDirection: -1 },
          {
            name: "Balanced regulation; targeted incentives",
            stance: "center",
            effectDirection: 0,
          },
          { name: "Streamline licensing; business-friendly", stance: "right", effectDirection: 1 },
          { name: "Major deregulation; red tape", stance: "right", effectDirection: 1 },
        ],
        "economic"
      ),
      // Non-negative per-capita spending: regulation/incentives cost money; deregulation
      // is the LEAST costly (floored at 0), never a phantom budget credit. Its upside
      // flows through the gdpGrowth/smallBusinessFormation metric effects, not a negative
      // spending line (which rendered as "Economic: -$81M" on the budget page).
      [100, 60, 20, 8, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_healthcare",
    countryScope: "us",
    name: "State Healthcare Policy Act",
    description: "State health insurance regulations and public health",
    explanation:
      "Covers state health insurance exchanges, coverage mandates, and public health programs beyond Medicaid. States can expand access beyond federal requirements.",
    policyDomain: "healthcare",
    subCategory: "State health policy",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "uninsuredRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "healthcare", metric: "uninsuredRate" }, [
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.4 },
      { category: "healthcare", metric: "affordabilityIndex", weight: 0.4 },
      { category: "healthcare", metric: "physicianRate", weight: 0.4 },
      { category: "healthcare", metric: "preventableMortality", weight: 0.4 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_healthcare",
        [
          { name: "Universal State Healthcare Act", stance: "left", effectDirection: 1 },
          { name: "State Healthcare Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Accessible Care Act", stance: "left", effectDirection: 1 },
          { name: "State Healthcare Framework Act", stance: "center", effectDirection: 0 },
          { name: "Healthcare Cost Control Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Healthcare Act", stance: "right", effectDirection: -1 },
          { name: "State Healthcare Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Establish a state-run single-payer system covering all residents with comprehensive benefits",
          "Significantly expand state Medicaid, fund community health centers, and subsidize insurance for working families",
          "Modestly expand state health programs, increase provider reimbursement rates, and fund rural clinics",
          "A moderate level of state healthcare spending covering Medicaid match obligations and basic public health programs",
          "Tighten state Medicaid eligibility, reduce provider payments, and encourage private insurance alternatives",
          "Cut state health programs to federally required minimums, shifting coverage responsibility to private markets",
          "Eliminate all state-funded healthcare programs beyond bare federal mandates, leaving coverage to private markets",
        ][i],
      })),
      [2480, 1860, 1550, 1240, 806, 372, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_policing",
    countryScope: "us",
    name: "State Policing and Community Safety Act",
    description: "State law enforcement policy and criminal justice reform",
    explanation:
      "Covers state police funding, sentencing guidelines, bail reform, and prison policy. States have primary authority over criminal justice.",
    policyDomain: "publicSafety",
    subCategory: "Law enforcement",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "crimeRate",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "publicSafety", metric: "crimeRate" }, [
      { category: "social", metric: "socialCohesion", weight: 0.4 },
      { category: "publicSafety", metric: "violentCrimeRate", weight: 0.5 },
      { category: "publicSafety", metric: "policePerCapita", weight: 0.3 },
      { category: "publicSafety", metric: "publicSafetyConfidence", weight: 0.4 },
    ]),
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_policing",
        [
          { name: "Community Safety Transformation Act", stance: "left", effectDirection: -1 },
          { name: "Police Accountability and Reform Act", stance: "left", effectDirection: -1 },
          { name: "Community Policing Investment Act", stance: "left", effectDirection: -1 },
          { name: "State Law Enforcement Act", stance: "center", effectDirection: 0 },
          { name: "Enhanced Policing Act", stance: "right", effectDirection: 1 },
          { name: "Aggressive Enforcement Act", stance: "right", effectDirection: 1 },
          { name: "Maximum State Policing Act", stance: "right", effectDirection: 1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Replace traditional policing with community responders, social workers, and restorative justice programs",
          "Significantly reduce police budgets, mandate body cameras, ban no-knock warrants, and fund crisis intervention teams",
          "Modestly reform policing with de-escalation training requirements, civilian oversight boards, and community engagement funding",
          "A moderate level of state policing funding supporting patrol operations, investigations, and officer training",
          "Increase state police budgets, expand officer hiring, and invest in surveillance and crime prevention technology",
          "Dramatically expand state police forces, fund specialized drug and gang units, and increase arrest quotas",
          "Massively expand state law enforcement with military-grade equipment, expanded surveillance, and zero-tolerance enforcement",
        ][i],
      })),
      [158, 237, 296, 355, 434, 553, 711]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_prison_rehabilitation",
    countryScope: "us",
    name: "State Prison Reform Act",
    description: "State funding for prisoner reentry and rehabilitation programs",
    explanation:
      "Funds job training, education, mental health services, and substance abuse treatment in state prisons. States house 87% of U.S. prisoners and have primary authority over rehabilitation programs.",
    policyDomain: "publicSafety",
    subCategory: "Criminal justice reform",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "recidivismRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "publicSafety", metric: "recidivismRate" }, [
        { category: "publicSafety", metric: "crimeRate", weight: 0.4 },
        { category: "economic", metric: "unemploymentRate", weight: 0.3 },
        { category: "publicSafety", metric: "incarcerationRate", weight: 0.2 },
        { category: "education", metric: "workforceSkill", weight: 0.2 },
        { category: "social", metric: "socialMobility", weight: 0.2 },
      ])!,
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: 0.4 },
    ],
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_prison_rehabilitation",
        [
          {
            name: "State Decarceration Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "State Rehabilitation Priority Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "State Reentry and Reform Act",
            stance: "left",
            effectDirection: 1,
          },
          {
            name: "State Corrections Act",
            stance: "center",
            effectDirection: 0,
          },
          {
            name: "State Prison Efficiency Act",
            stance: "right",
            effectDirection: -1,
          },
          { name: "State Incarceration Expansion Act", stance: "right", effectDirection: -1 },
          {
            name: "Maximum State Incarceration Act",
            stance: "right",
            effectDirection: -1,
          },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Close state prisons, replace incarceration with supervised community programs and rehabilitation facilities",
          "Dramatically reduce state prison populations, ban private prisons, and fund comprehensive inmate education and treatment",
          "Expand state reentry programs, reduce sentences for nonviolent crimes, and increase mental health services in prisons",
          "A moderate level of state prison funding balancing incarceration capacity with rehabilitation programs",
          "Reduce state prison costs through private contracts, inmate work programs, and consolidated facilities",
          "Build new state prisons, expand capacity, and impose longer sentences for repeat and violent offenders",
          "Massively expand the state prison system with mandatory minimums, three-strikes laws, and elimination of early release",
        ][i],
      })),
      [118, 138, 158, 178, 138, 276, 395]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_voting_rights",
    countryScope: "us",
    name: "State Voting Rights Act",
    description: "State voting laws, election administration, and ballot access",
    explanation:
      "Controls voter ID requirements, early voting, mail-in ballots, and redistricting. States have primary authority over election administration.",
    policyDomain: "social",
    subCategory: "Civil rights",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "voterTurnout",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "voterTurnout" }, [
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "social", metric: "civicParticipation", weight: 0.5 },
    ]),
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_voting_rights",
        [
          { name: "Universal State Voting Act", stance: "left", effectDirection: 1 },
          { name: "State Voting Access Act", stance: "left", effectDirection: 1 },
          { name: "State Civic Engagement Act", stance: "left", effectDirection: 1 },
          { name: "State Election Administration Act", stance: "center", effectDirection: 0 },
          { name: "State Election Integrity Act", stance: "right", effectDirection: -1 },
          { name: "Strict State Voting Act", stance: "right", effectDirection: -1 },
          { name: "Maximum State Election Control Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Implement automatic registration, same-day registration, universal mail-in ballots, and ban all voter ID requirements",
          "Significantly expand early voting locations, fund mobile voting units, restore felon voting rights, and pre-register 16-year-olds",
          "Modestly expand voter registration options, increase polling place funding, and offer online registration",
          "A moderate level of state election support funding polling places, voter rolls, and election worker training",
          "Require voter ID, tighten registration deadlines, and reduce early voting to one week before Election Day",
          "Mandate photo ID with proof of citizenship, eliminate same-day registration, and restrict mail-in voting to verified absentee requests",
          "Impose the strictest voter eligibility verification, eliminate early voting, and require in-person voting only with government-issued ID",
        ][i],
      })),
      [22, 14, 9, 5, 3, 1, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_government_ethics",
    countryScope: "us",
    name: "State Government Ethics Act",
    description: "State ethics rules and transparency requirements",
    explanation:
      "State-level ethics standards for officials and employees. Covers disclosure, conflicts of interest, and government transparency.",
    policyDomain: "governance",
    subCategory: "Ethics",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "governmentTransparency" },
      [
        { category: "governance", metric: "publicTrust", weight: 0.5 },
        { category: "mediaInformation", metric: "newsTrust", weight: 0.2 },
      ]
    ),
    positions: standardCommitteePositions("Oversight"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_government_ethics",
        [
          { name: "Maximum State Transparency Act", stance: "left", effectDirection: 1 },
          { name: "State Accountability Act", stance: "left", effectDirection: 1 },
          { name: "State Ethics Reform Act", stance: "left", effectDirection: 1 },
          { name: "State Ethics Standards Act", stance: "center", effectDirection: 0 },
          { name: "State Ethics Streamlining Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Ethics Act", stance: "right", effectDirection: -1 },
          { name: "State Ethics Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate full financial disclosure for all state officials, ban outside income, and create independent state anti-corruption commissions",
          "Significantly strengthen state ethics commissions, expand lobbying disclosure, and increase penalties for corruption",
          "Modestly strengthen state conflict-of-interest rules, expand open records compliance, and increase ethics office staffing",
          "A moderate level of state ethics enforcement covering financial disclosure, lobbying registration, and open meetings requirements",
          "Reduce state ethics reporting requirements and consolidate oversight functions",
          "Dramatically reduce state ethics enforcement, eliminating most disclosure and lobbying restrictions",
          "Eliminate state ethics oversight entirely, leaving accountability to elections and the court system",
        ][i],
      })),
      [36, 25, 14, 7, 4, 1, 0]
    ),
    allowedScope: "state",
  },
  {
    _id: "us_state_redistricting_authority",
    countryScope: "us",
    name: "State Redistricting Authority Act",
    description: "Who draws the state's congressional district map",
    explanation:
      "Sets whether congressional districts are drawn by an independent commission, a bipartisan commission, or the state legislature. Only a legislature-drawn map lets a governing trifecta redraw the lines.",
    policyDomain: "governance",
    subCategory: "Elections",
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "governance", metric: "governmentTransparency", weight: 0.5 },
    ]),
    positions: standardCommitteePositions("Oversight"),
    policyOptions: policyOptions(
      "state_redistricting_authority",
      [
        { name: "Independent Redistricting Commission Act", stance: "left", effectDirection: 1 },
        { name: "Bipartisan Redistricting Commission Act", stance: "center", effectDirection: 0 },
        { name: "Legislative Redistricting Authority Act", stance: "right", effectDirection: -1 },
      ],
      "social"
    ).map((opt, i) => ({
      ...opt,
      explanation: [
        "An independent, nonpartisan commission draws the maps; the legislature cannot redraw, and maps are renormalized toward registration at each census.",
        "A balanced bipartisan commission draws the maps; no party can unilaterally redraw the lines.",
        "The state legislature draws the maps; a party controlling the legislature and governorship may redraw at each census.",
      ][i],
    })),
    allowedScope: "state",
  },
  {
    _id: "us_state_compactness",
    countryScope: "us",
    name: "State District Compactness Act",
    description: "How compact / non-gerrymandered individual districts must be",
    explanation:
      "Limits how far any single congressional district may deviate from the state's average partisan balance, curbing the packing of voters into lopsided districts.",
    policyDomain: "governance",
    subCategory: "Elections",
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "governance", metric: "governmentTransparency", weight: 0.4 },
    ]),
    positions: standardCommitteePositions("Oversight"),
    policyOptions: policyOptions(
      "state_compactness",
      [
        { name: "Strict Compactness Standard Act", stance: "left", effectDirection: 1 },
        { name: "Moderate Compactness Standard Act", stance: "center", effectDirection: 0 },
        { name: "Minimal Compactness Standard Act", stance: "right", effectDirection: -1 },
      ],
      "social"
    ).map((opt, i) => ({
      ...opt,
      explanation: [
        "Districts must hug the state average closely — no packed safe seats permitted.",
        "Districts may deviate moderately from the state average; a limited number of safe seats is allowed.",
        "Districts may deviate widely; many heavily packed safe seats are permitted.",
      ][i],
    })),
    allowedScope: "state",
  },
  {
    _id: "us_state_fairness",
    countryScope: "us",
    name: "State Electoral Fairness Act",
    description: "Statewide fairness ceiling on the district map (efficiency gap)",
    explanation:
      "Caps the statewide efficiency gap — the asymmetry in wasted votes between parties. A map exceeding the ceiling is illegal to draw and erodes public approval until corrected.",
    policyDomain: "governance",
    subCategory: "Elections",
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "governance", metric: "governmentTransparency", weight: 0.4 },
    ]),
    positions: standardCommitteePositions("Oversight"),
    policyOptions: policyOptions(
      "state_fairness",
      [
        { name: "Strict Electoral Fairness Act", stance: "left", effectDirection: 1 },
        { name: "Moderate Electoral Fairness Act", stance: "center", effectDirection: 0 },
        { name: "Minimal Electoral Fairness Act", stance: "right", effectDirection: -1 },
      ],
      "social"
    ).map((opt, i) => ({
      ...opt,
      explanation: [
        "A tight fairness ceiling: maps must be near-symmetric in wasted votes.",
        "A moderate fairness ceiling tolerating some partisan advantage.",
        "A loose fairness ceiling permitting substantial partisan asymmetry.",
      ][i],
    })),
    allowedScope: "state",
  },

  // ── State Social & Rights ──────────────────────────────────────────────
  {
    _id: "us_reproductive_rights",
    countryScope: "us",
    name: "Reproductive Health Act",
    description: "Abortion access and reproductive healthcare",
    explanation:
      "State laws on abortion access, contraception, and reproductive healthcare. Since Dobbs v. Jackson (2022), states have full authority over abortion policy.",
    policyDomain: "social",
    subCategory: "Civil rights",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "socialCohesion",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "socialCohesion" }, [
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
      { category: "healthcare", metric: "preventableMortality", weight: 0.3 },
      // Reproductive-access lever moves fertility → birthRate driver (§4.2/§4.6).
      // Negative weight: expanding abortion access (left) lowers births; restricting
      // it (right) raises them.
      { category: "population", metric: "birthRate", weight: -0.3 },
    ]),
    demographicEffects: [
      { groupId: "young_adults", direction: 0.01 }, // Reproductive rights affect young women
      { groupId: "urban", direction: 0.01 }, // Pro-choice policies attract urban residents
    ],
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "reproductive_rights",
        [
          { name: "Universal Reproductive Freedom Act", stance: "left", effectDirection: 1 },
          { name: "Reproductive Rights Protection Act", stance: "left", effectDirection: 1 },
          { name: "Reproductive Healthcare Access Act", stance: "left", effectDirection: 1 },
          { name: "Reproductive Policy Act", stance: "center", effectDirection: 0 },
          { name: "Reproductive Regulation Act", stance: "right", effectDirection: -1 },
          { name: "Pro-Life Protection Act", stance: "right", effectDirection: -1 },
          { name: "Total Abortion Ban Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Codify unrestricted abortion access as a federal right, mandate insurance coverage for all reproductive services, and massively expand Title X funding",
          "Guarantee abortion access through the second trimester nationally, expand contraception coverage, and increase family planning grants",
          "Modestly expand access to contraception, protect clinic access zones, and fund comprehensive sex education",
          "A moderate framework allowing states to set their own abortion policies while funding basic family planning services",
          "Restrict federal funding for abortion providers, impose waiting periods, and require parental consent for minors",
          "Ban most abortions after the first trimester, defund organizations that provide abortions, and expand adoption funding",
          "Ban all abortions nationally with no exceptions, eliminate all federal family planning funding, and impose criminal penalties on providers",
        ][i],
      })),
      [18, 11, 6, 3, 1, 1, 0]
    ),
  },

  // ── Paid Family Leave & Child Care ──────────────────────────────────────────
  // §4.6 new-act gap #1: the US is the OECD outlier with no federal paid-leave /
  // childcare law. Lever moves birthRate(+) AND female laborParticipation(+) —
  // childcare lets parents work, so the two rise together (positive labor weight,
  // unlike the pension acts where expansion pulls workers out).
  {
    _id: "us_paid_family_leave",
    countryScope: "us",
    name: "Paid Family Leave & Child Care Act",
    description:
      "Federal paid family and medical leave, child-care subsidies, and early-childhood support",
    explanation:
      "Establishes federal paid family/medical leave and child-care subsidies. Left positions favor universal paid leave and subsidized care; right positions favor market provision and minimal mandates.",
    policyDomain: "social",
    subCategory: "Family policy",
    budgetCategory: "other",
    effectTarget: { metricCategoryId: "population", metricId: "birthRate", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "population", metric: "birthRate" }, [
      // Childcare lets parents (esp. mothers) stay in work → laborParticipation up
      // (§4.6); positive weight, opposite sign to the pension/retirement acts.
      { category: "economic", metric: "laborParticipation", weight: 0.5 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
    ]),
    demographicEffects: [
      { groupId: "young_adults", direction: 0.02 }, // paid leave / childcare supports young families
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "paid_family_leave",
        [
          { name: "Universal Paid Leave & Child Care Act", stance: "left", effectDirection: 1 },
          { name: "Paid Family Leave Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Family Care Access Act", stance: "left", effectDirection: 1 },
          { name: "Family Leave Standards Act", stance: "center", effectDirection: 0 },
          { name: "Employer Flexibility Act", stance: "right", effectDirection: -1 },
          { name: "Family Leave Rollback Act", stance: "right", effectDirection: -1 },
          { name: "Paid Leave Repeal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee 12 months of fully paid family and medical leave and universal subsidized child care for every family",
          "Provide 6 months of paid leave, large child-care subsidies, and expanded early-childhood education funding",
          "Offer 12 weeks of paid leave and means-tested child-care assistance for working families",
          "A moderate federal framework offering partial wage replacement for family leave and targeted child-care credits",
          "Replace mandates with tax credits, leaving paid leave and child care primarily to employers and markets",
          "Roll back federal leave requirements and child-care subsidies in favor of state and private provision",
          "Eliminate all federal paid-leave mandates and child-care subsidies, leaving family support to individuals",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "birthRate",
            // Dedicated stronger array (not shared TICK_RATES_7) so the lever survives
            // the 1/50 US state division and visibly moves birthRate (see array doc).
            // Left (expand) raises birthRate via the positive left entries.
            ratePerTurn: US_BIRTH_RATE_TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [4200, 3100, 2200, 1300, 600, 200, 0]
    ),
    nationalOnly: true,
  },
  {
    _id: "us_gun_control",
    countryScope: "us",
    name: "Firearms Safety Act",
    description: "Firearm regulations, carry laws, and background checks",
    explanation:
      "State firearm regulations including permit requirements, assault weapon bans, red flag laws, and concealed/open carry rules. Varies widely by state.",
    policyDomain: "publicSafety",
    subCategory: "Gun control",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "crimeRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "publicSafety", metric: "crimeRate" }, [
        { category: "social", metric: "socialCohesion", weight: 0.4 },
        { category: "publicSafety", metric: "violentCrimeRate", weight: 0.5 },
      ])!,
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: 0.4 },
      // Right-lane axis metric: restriction (left, effectDirection +1) lowers
      // firearmRights while its crime effects land above; deregulation (right)
      // raises it. The two-sided tradeoff both directions carry.
      { metricCategoryId: "publicSafety" as const, metricId: "firearmRights", weight: -1.0 },
    ],
    demographicEffects: [
      { groupId: "rural", direction: 0.01 }, // Gun rights attract rural residents
    ],
    positions: standardCommitteePositions("Judiciary"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "gun_control",
        [
          { name: "Comprehensive Firearms Ban Act", stance: "left", effectDirection: 1 },
          { name: "Assault Weapons Ban Act", stance: "left", effectDirection: 1 },
          { name: "Gun Safety Reform Act", stance: "left", effectDirection: 1 },
          { name: "Firearms Regulation Act", stance: "center", effectDirection: 0 },
          { name: "Second Amendment Preservation Act", stance: "right", effectDirection: -1 },
          { name: "Gun Rights Expansion Act", stance: "right", effectDirection: -1 },
          { name: "Second Amendment Absolutism Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Ban all semi-automatic weapons, establish a mandatory buyback program, create a national firearms registry, and require annual licensing",
          "Ban assault-style weapons and high-capacity magazines, mandate universal background checks, and fund gun violence research",
          "Expand background checks to all sales, implement red flag laws, raise the purchase age to 21, and fund community violence intervention",
          "A moderate framework supporting background checks for licensed dealers, mental health reporting, and basic safety requirements",
          "Reduce firearms regulations, expand concealed carry reciprocity across states, and limit ATF enforcement authority",
          "Eliminate most federal firearms restrictions, allow unrestricted concealed carry, and defund ATF enforcement operations",
          "Eliminate all federal firearms laws and the ATF, recognizing an unrestricted individual right to own and carry any weapon",
        ][i],
      })),
      [36, 22, 11, 5, 2, 1, 0]
    ),
  },
  {
    _id: "us_medicaid_expansion",
    countryScope: "us",
    name: "Medicaid Expansion Act",
    description: "State adoption of Medicaid expansion and public health",
    explanation:
      "Whether the state expands Medicaid to cover adults up to 138% of poverty level under the ACA. Affects uninsured rates and brings federal matching funds.",
    policyDomain: "healthcare",
    subCategory: "Medicaid",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "uninsuredRate",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "healthcare", metric: "uninsuredRate" }, [
        { category: "healthcare", metric: "lifeExpectancy", weight: 0.4 },
        { category: "economic", metric: "povertyRate", weight: 0.3 },
      ])!,
      // Phase A2: tradeoff — left expansion reduces economic freedom; right cuts improve it
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.25 },
    ],
    demographicEffects: [
      { groupId: "poor", direction: 0.01 },
      { groupId: "working_class", direction: 0.01 },
    ],
    positions: standardCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "medicaid_expansion",
        [
          { name: "Universal Medicaid Act", stance: "left", effectDirection: 1 },
          { name: "Broad Medicaid Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Medicaid Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Medicaid Stabilization Act", stance: "center", effectDirection: 0 },
          { name: "Medicaid Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Medicaid Block Grant Act", stance: "right", effectDirection: -1 },
          { name: "Medicaid Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Extend Medicaid coverage to all residents regardless of income, effectively creating a public insurance floor for every American",
          "Dramatically raise income eligibility thresholds and expand covered services including dental, vision, and mental health",
          "Modestly expand eligibility and add targeted benefits for maternal care, children, and disabled populations",
          "A moderate level of Medicaid funding covering low-income families, disabled individuals, and qualifying seniors",
          "Tighten eligibility requirements, add work requirements, and introduce cost-sharing for non-emergency services",
          "Convert Medicaid to fixed block grants giving states full control over eligibility, benefits, and administration",
          "End the federal Medicaid program entirely, leaving low-income healthcare to state discretion and charity care",
        ][i],
      })),
      [1860, 1488, 1116, 868, 558, 248, 0]
    ),
  },
  {
    _id: "us_state_food_assistance",
    countryScope: "us",
    name: "State Food Assistance Act",
    description: "State supplemental nutrition and food security programs",
    explanation:
      "State-level food assistance beyond federal programs. Includes state SNAP supplements, food banks, and local food security initiatives.",
    policyDomain: "social",
    subCategory: "Welfare",
    effectTarget: {
      metricCategoryId: "social",
      metricId: "foodInsecurity",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "foodInsecurity" }, [
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.2 },
      { category: "economic", metric: "povertyRate", weight: 0.3 },
    ]),
    positions: standardCommitteePositions("Agriculture"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_food_assistance",
        [
          { name: "Universal Meal Security Act", stance: "left", effectDirection: 1 },
          { name: "Hunger Prevention Act", stance: "left", effectDirection: 1 },
          { name: "Food Access Improvement Act", stance: "left", effectDirection: 1 },
          { name: "State Nutrition Services Act", stance: "center", effectDirection: 0 },
          { name: "Targeted Nutrition Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Food Aid Act", stance: "right", effectDirection: -1 },
          { name: "State Food Program Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee free meals for all public school students, fund state food banks in every county, and expand SNAP supplements",
          "Significantly expand state food assistance, increase SNAP benefits, and fund community meal programs",
          "Modestly expand school meal programs, increase food bank funding, and support farmers market vouchers",
          "A moderate level of state food assistance funding school lunch programs and supplemental nutrition aid",
          "Focus food assistance on verified low-income households, add work requirements, and reduce benefit levels",
          "Cut state food assistance to emergency-only provisions, eliminating broad-based nutrition programs",
          "Eliminate all state food assistance programs, leaving hunger relief to federal programs and private charity",
        ][i],
      })),
      [288, 216, 159, 115, 72, 29, 0]
    ),
    allowedScope: "state",
  },

  // ── Media & Communications ───────────────────────────────────────────────
  {
    _id: "us_media_communications",
    countryScope: "us",
    name: "Media and Communications Regulation Act",
    description: "Media regulation, net neutrality, and press freedom",
    explanation:
      "Federal media policy including broadcast regulation, net neutrality, platform liability, and public broadcasting. Affects press freedom and information quality.",
    policyDomain: "mediaInformation",
    subCategory: "Media",
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "mediaInformation", metric: "pressFreedom" },
      [
        { category: "mediaInformation", metric: "mediaPolarization", weight: 0.6 },
        // P6a reconcile: public-interest regulation modestly raises state
        // involvement in media (negative weight: left direction → control UP).
        { category: "mediaInformation", metric: "stateMediaControl", weight: -0.3 },
        { category: "mediaInformation", metric: "socialMediaSentiment", weight: 0.3 },
      ]
    ),
    positions: standardCommitteePositions("Commerce"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "media_communications",
        [
          { name: "Public Media and Net Neutrality Act", stance: "left", effectDirection: 1 },
          { name: "Media Accountability Act", stance: "left", effectDirection: 1 },
          { name: "Digital Fairness Act", stance: "left", effectDirection: 1 },
          { name: "Communications Standards Act", stance: "center", effectDirection: 0 },
          { name: "Media Market Freedom Act", stance: "right", effectDirection: -1 },
          { name: "Communications Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "FCC Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand public broadcasting, mandate strict net neutrality, break up media monopolies, and regulate social media content moderation",
          "Significantly strengthen FCC oversight, enforce net neutrality, expand public media funding, and impose media ownership limits",
          "Modestly strengthen net neutrality protections, increase public broadcasting funding, and regulate targeted online advertising",
          "A moderate level of FCC regulation covering broadcast licensing, spectrum allocation, and basic consumer protections",
          "Relax media ownership limits, reduce FCC regulatory burden, and allow ISPs to manage network traffic freely",
          "Dramatically reduce FCC authority, eliminate net neutrality rules, defund public broadcasting, and deregulate telecom markets",
          "Eliminate federal media and communications regulation entirely, leaving broadcast and internet governance to market forces",
        ][i],
      })),
      [36, 25, 14, 7, 4, 1, 0]
    ),
  },
  {
    _id: "us_state_media_communications",
    countryScope: "us",
    name: "State Media Regulation Act",
    description: "State press protections and local media policy",
    explanation:
      "State-level media policy including shield laws, public records access, and local broadcasting. Complements federal media regulation.",
    policyDomain: "mediaInformation",
    subCategory: "Media",
    effectTarget: {
      metricCategoryId: "mediaInformation",
      metricId: "pressFreedom",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "mediaInformation", metric: "pressFreedom" },
      [
        { category: "mediaInformation", metric: "mediaPolarization", weight: 0.6 },
        // P6a reconcile: public-interest regulation modestly raises state
        // involvement in media (negative weight: left direction → control UP).
        { category: "mediaInformation", metric: "stateMediaControl", weight: -0.3 },
        { category: "mediaInformation", metric: "socialMediaSentiment", weight: 0.3 },
      ]
    ),
    positions: standardCommitteePositions("Commerce"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "state_media_communications",
        [
          { name: "State Digital Rights Act", stance: "left", effectDirection: 1 },
          { name: "State Media Accountability Act", stance: "left", effectDirection: 1 },
          { name: "State Digital Consumer Act", stance: "left", effectDirection: 1 },
          { name: "State Communications Standards Act", stance: "center", effectDirection: 0 },
          { name: "State Telecom Freedom Act", stance: "right", effectDirection: -1 },
          { name: "Minimal State Media Regulation Act", stance: "right", effectDirection: -1 },
          { name: "State Media Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate state-level net neutrality, fund public access media, regulate data collection, and require algorithmic transparency from tech companies",
          "Significantly strengthen state consumer protections for broadband, expand public access channels, and regulate online privacy",
          "Modestly expand state broadband consumer protections, fund local public media, and regulate telemarketing and data brokers",
          "A moderate level of state telecom regulation covering consumer complaints, franchise agreements, and basic privacy rules",
          "Reduce state telecom regulations, streamline franchise agreements, and limit local broadband restrictions",
          "Cut state media oversight to complaint processing only, eliminating consumer protection and privacy programs",
          "Eliminate all state media and communications regulation, leaving telecom and broadcast entirely to federal law and market forces",
        ][i],
      })),
      [22, 14, 9, 5, 2, 1, 0]
    ),
    allowedScope: "state",
  },

  // ── Tax Rate Legislation ────────────────────────────────────────────────
  {
    _id: "us_federal_income_tax_rate",
    countryScope: "us",
    name: "Federal Income Tax Rate",
    description: "Set the federal income tax rate",
    explanation:
      "The top marginal income tax rate paid by individuals. Higher rates increase revenue but may affect economic growth; lower rates reduce revenue but may stimulate investment.",
    policyDomain: "tax",
    subCategory: "Federal tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "povertyRate", weight: 0.4 },
      { category: "economic", metric: "gdpGrowth", weight: 0.3 },
      // Progressive income tax compresses inequality: a higher rate (left) must
      // LOWER inequality, so the weight is negative (matches UK/DE/IE/CN).
      { category: "social", metric: "incomeInequality", weight: -0.4 },
    ]),
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("federal_income_tax_rate", [
      {
        rate: 0,
        name: "Abolish the Income Tax",
        description:
          "Eliminate federal income taxation entirely, funding government through tariffs and consumption taxes",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Minimal Revenue Levy",
        description: "A token income tax rate, dramatically shrinking federal revenue capacity",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Flat Tax Revolution",
        description: "A simple low flat tax replacing the progressive bracket system",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Supply-Side Tax Compact",
        description: "Deep rate cuts to unleash private investment and economic growth",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 20,
        name: "Taxpayer Relief Act",
        description: "Meaningful rate reductions while preserving core federal functions",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "Working Families Tax Framework",
        description: "A moderate rate balancing revenue needs with household affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Shared Prosperity Tax Plan",
        description: "Modestly higher rates to fund expanded public services",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 35,
        name: "Fair Contribution Act",
        description: "Restore historically higher rates to close the deficit gap",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 40,
        name: "Progressive Revenue Act",
        description: "Significantly higher top rates to fund healthcare and education expansion",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 45,
        name: "Wealth Equity Tax Act",
        description: "Near-historic top rates to aggressively redistribute income",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Redistribution Act",
        description:
          "A steeply progressive top marginal rate targeting the highest earners to maximize federal revenue and fund sweeping social programs",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "incomeTax",
    },
    nationalOnly: true,
  },
  {
    _id: "us_federal_domestic_corporate_tax_rate",
    countryScope: "us",
    name: "Federal Domestic Corporate Tax Rate",
    description: "Set the federal tax rate on corporations headquartered in the United States",
    explanation:
      "Tax rate on profits of US-headquartered corporations. Higher rates increase revenue; lower rates may attract capital retention. Foreign corporations operating in the US are taxed separately (see Federal Foreign Corporate Tax Rate).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    // gdpGrowth primary removed: engine-owned metric, the weighted target was
    // dead — converted to the demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
      // Corporate tax falls on capital owners: a higher rate (left) must LOWER
      // inequality, so the weight is negative (matches ie_corporate_tax_rate).
      { metricCategoryId: "social", metricId: "incomeInequality", weight: -0.4 },
    ],
    // Federal scope divides by 1/50 per state, hence the high magnitudes.
    demographicEffects: [
      // A low-corporate-tax environment (right) entrenches pro-market economics
      // among business owners; high rates pull owner opinion back left.
      { groupId: "small_business", target: "economicLean", direction: 0.75, magnitude: 2 },
      // A tax-cutting agenda energizes the anti-tax base; a high-tax regime
      // demoralizes it.
      { groupId: "libertarians", target: "turnout", direction: 0.5, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("federal_domestic_corporate_tax_rate", [
      {
        rate: 0,
        name: "Corporate Tax Elimination Act",
        description:
          "Abolish taxation on corporate profits entirely, relying on shareholder-level taxes for revenue",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 4,
        name: "Business Liberation Act",
        description:
          "A near-zero corporate rate designed to make the US the world's most competitive tax destination",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 8,
        name: "Enterprise Growth Compact",
        description:
          "A low flat rate to attract multinational headquarters and stimulate domestic investment",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 12,
        name: "Small Business Prosperity Act",
        description: "Rate cuts favoring capital formation and small business expansion",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 16,
        name: "Competitive Markets Tax Plan",
        description: "A globally competitive rate aligned with OECD averages",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 20,
        name: "Balanced Corporate Revenue Act",
        description: "A moderate rate balancing business competitiveness with public revenue needs",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Corporate Accountability Tax",
        description:
          "Higher rates requiring corporations to contribute a larger share of federal revenue",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 28,
        name: "Corporate Fair Share Act",
        description:
          "Rates approaching historically traditional levels to close revenue gaps and fund public services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 32,
        name: "Corporate Excess Profits Act",
        description:
          "Elevated rates targeting outsized corporate earnings to fund public investment",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 36,
        name: "Corporate Wealth Recapture Act",
        description:
          "Rates exceeding the historic norm, extracting substantial revenue from corporate profits",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Corporate Extraction Act",
        description:
          "The highest modern corporate tax rate, capturing nearly half of all corporate profits for public use",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "domesticCorporateTax",
    },
    nationalOnly: true,
  },
  {
    _id: "us_federal_foreign_corporate_tax_rate",
    countryScope: "us",
    name: "Federal Foreign Corporate Tax Rate",
    description: "Set the federal tax rate on corporations headquartered outside the United States",
    explanation:
      "Tax rate on profits earned in the US by foreign-headquartered corporations. Higher rates pressure multinationals and protect domestic competitors; lower rates attract foreign direct investment. Applied to all non-US-HQ corporations uniformly — no country targeting.",
    policyDomain: "tax",
    subCategory: "Foreign corporate taxation",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    // gdpGrowth primary removed: engine-owned metric, the weighted target was
    // dead — converted to the demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.2 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: 0.2 },
    ],
    demographicEffects: [
      // FDI-driven multinational white-collar employment normalizes
      // market-friendly economics among professionals; taxing foreign capital
      // out (left) removes that pull. Federal 1/50 scope, hence magnitude.
      { groupId: "secular_professionals", target: "economicLean", direction: 0.5, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("us_federal_foreign_corporate_tax_rate", [
      {
        rate: 0,
        name: "Open Markets for Capital Act",
        description:
          "Abolish taxation on foreign corporate profits, positioning the US as a free-market destination for global capital",
        stance: "right",
        economic: 5,
        social: 1,
      },
      {
        rate: 6,
        name: "Foreign Investment Attraction Act",
        description:
          "A near-zero foreign rate to draw multinational headquarters and FDI to the United States",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 12,
        name: "Business-Friendly Foreign Rate",
        description:
          "A low foreign corporate rate to encourage cross-border investment without abandoning tax revenue",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 18,
        name: "Moderate Investor Act",
        description:
          "A slightly-below-parity foreign rate signaling an investment-friendly climate",
        stance: "center",
        economic: 1,
        social: 0,
      },
      {
        rate: 24,
        name: "Parity with Domestic Corporate Rate",
        description:
          "Tax foreign corporations at the same rate as domestic firms — a neutral, non-discriminatory policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Modestly Protective Foreign Rate",
        description:
          "A marginally higher foreign rate to tilt competitive advantage toward domestic corporations",
        stance: "center",
        economic: -1,
        social: 0,
      },
      {
        rate: 36,
        name: "Foreign Capital Accountability Act",
        description:
          "A meaningfully higher foreign rate, funded by profits extracted by multinational corporations operating in the US",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 42,
        name: "Domestic Workers Defense Act",
        description:
          "Elevated foreign rates funding domestic workforce programs and discouraging offshoring",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        // High foreign-corp rate ⇒ economically left; stance corrected from a
        // sovereignty theme so the effectDirection ladder stays monotone (Bug #0962).
        rate: 48,
        name: "America First Foreign Corporate Tax",
        description:
          "A nationalist foreign tax regime, protecting American business interests from foreign competition",
        stance: "left",
        economic: -3,
        social: -2,
      },
      {
        rate: 54,
        name: "Economic Sovereignty Act",
        description:
          "A near-punitive foreign rate asserting American economic independence from multinational capital",
        stance: "left",
        economic: -4,
        social: -3,
      },
      {
        rate: 60,
        name: "Multinational Profit Extraction Act",
        description:
          "The highest foreign corporate rate, maximizing revenue capture from transnational profits",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "foreignCorporateTax",
    },
    nationalOnly: true,
  },
  {
    _id: "us_federal_payroll_tax_rate",
    countryScope: "us",
    name: "Federal Payroll Tax Rate",
    description: "Set the federal payroll tax rate (Social Security and Medicare)",
    explanation:
      "Combined employer/employee tax funding Social Security (12.4%) and Medicare (2.9%). Split evenly between employers and workers. Higher rates strengthen entitlements but reduce take-home pay.",
    policyDomain: "tax",
    subCategory: "Federal tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "povertyRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "povertyRate" }, [
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
    ]),
    demographicEffects: [
      { groupId: "retirees", direction: 0.01 }, // Payroll taxes fund SS/Medicare
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("federal_payroll_tax_rate", [
      {
        rate: 0,
        name: "Payroll Tax Abolition Act",
        description:
          "Eliminate payroll taxes entirely, privatizing Social Security and Medicare funding",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 3,
        name: "Entitlement Privatization Act",
        description:
          "A minimal payroll contribution paired with private retirement and health savings accounts",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 6,
        name: "Personal Responsibility Compact",
        description:
          "Dramatically reduced payroll burden, shifting retirement and healthcare costs to individuals",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 9,
        name: "Payroll Relief Act",
        description:
          "Significant cuts to payroll taxes to boost take-home pay for working families",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 12,
        name: "Worker Affordability Act",
        description:
          "Reduced payroll contributions easing the burden on employers and low-wage workers",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 15,
        name: "Social Insurance Preservation Act",
        description:
          "A rate sufficient to fund core Social Security and Medicare obligations without expansion or reduction",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 18,
        name: "Entitlement Security Act",
        description:
          "Higher contributions to shore up Social Security and Medicare trust fund solvency",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 21,
        name: "Expanded Benefits Act",
        description:
          "Increased payroll funding to expand Medicare eligibility and raise Social Security benefits",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 24,
        name: "Universal Entitlement Act",
        description:
          "Substantially higher payroll taxes funding universal healthcare and enhanced retirement benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 27,
        name: "Cradle-to-Grave Security Act",
        description:
          "Near-European payroll rates funding comprehensive social insurance from birth to death",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 30,
        name: "Maximum Social Insurance Act",
        description:
          "The highest payroll tax rate, funding a full European-style welfare state through employer and worker contributions",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "payrollTax",
    },
    nationalOnly: true,
  },
  {
    _id: "us_federal_tariff_rate",
    countryScope: "us",
    name: "Federal Tariff Rate",
    description: "Set the federal tariff rate on imports",
    explanation:
      "Tax on imported goods. Higher tariffs protect domestic industries but raise consumer prices; lower tariffs support free trade but may cost manufacturing jobs.",
    policyDomain: "tax",
    subCategory: "Federal tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    // gdpGrowth primary removed: engine-owned metric, the weighted target was
    // dead — converted to the demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "medianIncome", weight: 0.3 },
      // Higher tariffs raise consumer prices: negative weight pushes cost of
      // living UP under protectionist (right) options. Matches DE/IE/CN tariff
      // bills; magnitude -0.4 mirrors those peers.
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.2 },
    ],
    demographicEffects: [
      // Protection (right, positive score) revives mill-town civic confidence
      // and union GOTV capacity; free-trade shocks (left) depress turnout in
      // manufacturing communities. Federal 1/50 scope, hence magnitude.
      { groupId: "union_trades", target: "turnout", direction: 0.75, magnitude: 2 },
    ],
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("federal_tariff_rate", [
      {
        rate: 0,
        name: "Universal Free Trade Act",
        description: "Abolish all tariffs and embrace unrestricted global free trade",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 2,
        name: "Open Markets Accord",
        description: "Minimal revenue tariffs only, maximizing trade openness and consumer choice",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5,
        name: "Free Trade Preservation Act",
        description: "Low tariffs limited to specific trade agreement enforcement mechanisms",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 8,
        name: "Fair Trade Compact",
        description:
          "Modest tariffs targeting unfair trade practices while preserving open markets",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 12,
        name: "Reciprocal Trade Act",
        description: "Tariffs calibrated to match rates imposed by trading partners",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 15,
        name: "Balanced Trade Act",
        description:
          "A moderate tariff rate balancing domestic industry protection with consumer affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Domestic Industry Shield Act",
        description:
          "Elevated tariffs protecting key manufacturing sectors from foreign competition",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "American Production First Act",
        description:
          "Broad tariffs designed to incentivize reshoring of factories and supply chains",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 30,
        name: "Industrial Fortress Act",
        description:
          "High protective tariffs across most imported goods to rebuild domestic manufacturing",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 40,
        name: "Economic Nationalism Act",
        description: "Sweeping tariffs walling off the domestic economy from global competition",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Protectionist Act",
        description:
          "The highest peacetime tariff rates, designed to achieve near-total economic self-sufficiency",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "tariffs",
    },
    nationalOnly: true,
  },
  {
    _id: "us_federal_sales_tax_rate",
    countryScope: "us",
    name: "Federal Sales Tax Rate",
    description: "Set a national sales tax rate (default: none)",
    explanation:
      "A hypothetical national consumption tax. The US currently has no federal sales tax; this would be added on top of state sales taxes. More regressive than income taxes.",
    policyDomain: "tax",
    subCategory: "Federal tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "gdpGrowth", weight: -0.3 },
      // Sales tax is a consumption tax on an INVERTED axis (high rate = right):
      // a higher rate must RAISE poverty and cost of living, so both weights are
      // negative (matches ie_vat_rate).
      { category: "economic", metric: "povertyRate", weight: -0.4 },
      { category: "economic", metric: "costOfLiving", weight: -0.3 },
    ]),
    positions: standardCommitteePositions("Ways and Means"),
    policyOptions: taxRateOptions("federal_sales_tax_rate", [
      {
        rate: 0,
        name: "Sales Tax Prohibition Act",
        description:
          "No federal sales or consumption tax, preserving purchasing power for low-income households",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 2,
        name: "Minimal Consumption Levy",
        description:
          "A token federal consumption tax generating modest revenue with limited impact on consumers",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5,
        name: "Modest Revenue Supplement Act",
        description: "A small federal sales tax supplementing income tax revenue",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 8,
        name: "Broadened Tax Base Act",
        description: "A moderate consumption tax shifting some tax burden from income to spending",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 10,
        name: "Balanced Consumption Tax Act",
        description:
          "A significant sales tax used to offset reductions in income or corporate taxation",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 12,
        name: "Revenue Diversification Act",
        description:
          "A substantial consumption tax forming a major pillar of federal revenue alongside income taxes",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 15,
        name: "Consumer Contribution Act",
        description:
          "A high federal sales tax replacing a significant portion of income tax revenue",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 17,
        name: "Flat Consumption Tax Act",
        description:
          "An elevated consumption tax designed to simplify the tax code by reducing reliance on income taxes",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 20,
        name: "National VAT Act",
        description: "A European-style value-added tax replacing most progressive income taxation",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 22,
        name: "Consumption-First Tax Act",
        description:
          "A near-total shift from income taxation to consumption-based revenue collection",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum Consumption Tax Act",
        description:
          "The highest consumption tax rate, fully replacing income taxation with a regressive spending-based system",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "federal",
      taxType: "salesTax",
    },
    nationalOnly: true,
  },

  // ── State Tax Rate Legislation ──────────────────────────────────────────
  {
    _id: "us_state_income_tax_rate",
    countryScope: "us",
    name: "State Income Tax Rate",
    description: "Set the state income tax rate",
    explanation:
      "State tax on individual income, ranging from 0% (Texas, Florida) to 13% (California). Funds state services but affects competitiveness for attracting residents and businesses.",
    policyDomain: "tax",
    subCategory: "State tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "povertyRate", weight: 0.4 },
    ]),
    positions: standardCommitteePositions("Finance"),
    policyOptions: taxRateOptions("state_income_tax_rate", [
      {
        rate: 0,
        name: "Income Tax Free State Act",
        description: "Abolish state income taxation, following the model of no-income-tax states",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 2,
        name: "Minimal State Income Levy",
        description: "A token state income tax generating limited revenue for essential services",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 5,
        name: "Low-Burden Revenue Act",
        description: "A low state income tax minimizing the burden on workers and businesses",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 7,
        name: "Taxpayer-Friendly Revenue Act",
        description:
          "A modest state income tax rate prioritizing affordability over public spending",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 9,
        name: "Lean Government Revenue Act",
        description:
          "A below-average rate keeping state government lean while funding core obligations",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 12,
        name: "Standard State Revenue Act",
        description: "A mid-range state income tax rate funding a typical level of public services",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 14,
        name: "Enhanced Services Revenue Act",
        description:
          "An above-average rate enabling expanded education and infrastructure spending",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 16,
        name: "Progressive State Revenue Act",
        description: "A higher rate funding robust public services and social safety net programs",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 19,
        name: "Comprehensive Services Act",
        description: "Elevated state income taxes funding comprehensive public investment",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 22,
        name: "High-Investment State Tax Act",
        description:
          "Among the highest state income tax rates, funding expansive government programs",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum State Income Tax Act",
        description:
          "The highest state income tax bracket, extracting maximum revenue for broad public services and redistribution",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "state",
      taxType: "incomeTax",
    },
    allowedScope: "state",
  },
  {
    _id: "us_state_sales_tax_rate",
    countryScope: "us",
    name: "State Sales Tax Rate",
    description: "Set the state sales tax rate",
    explanation:
      "Tax on retail purchases. Ranges from 0% (Oregon, Montana) to 10%+ with local additions (Tennessee). More regressive but stable revenue source for states.",
    policyDomain: "tax",
    subCategory: "State tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "gdpGrowth", weight: -0.25 },
      // Consumption tax on an INVERTED axis (high rate = right): higher rate
      // must RAISE poverty and cost of living, so both weights are negative.
      { category: "economic", metric: "povertyRate", weight: -0.3 },
      { category: "economic", metric: "costOfLiving", weight: -0.3 },
    ]),
    positions: standardCommitteePositions("Finance"),
    policyOptions: taxRateOptions("state_sales_tax_rate", [
      {
        rate: 0,
        name: "Sales Tax Free State Act",
        description:
          "No state sales tax, relying entirely on income and property taxes for revenue",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 2,
        name: "Minimal Sales Levy",
        description: "A token sales tax generating modest revenue with limited consumer impact",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 4,
        name: "Low-Impact Consumer Tax",
        description:
          "A low sales tax keeping consumer costs down while providing supplemental revenue",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 6,
        name: "Moderate Consumer Tax Act",
        description: "A mid-range sales tax balancing consumer burden with state revenue needs",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 8,
        name: "Broad-Base Revenue Act",
        description: "A substantial sales tax forming a significant portion of state revenue",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 10,
        name: "Balanced Consumption Revenue Act",
        description:
          "A high sales tax rate serving as a primary revenue source alongside income taxes",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 12,
        name: "Revenue Shift Act",
        description: "An elevated sales tax enabling reductions in state income taxation",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 14,
        name: "Consumption-Priority Revenue Act",
        description: "A high consumption tax shifting the tax burden from earnings to spending",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 16,
        name: "Consumer-Funded Government Act",
        description: "Heavy reliance on sales tax revenue to minimize income and business taxation",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 18,
        name: "Consumption-First State Act",
        description:
          "Near-total reliance on consumption taxes, dramatically reducing or eliminating state income tax",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Maximum State Sales Tax Act",
        description:
          "The highest state sales tax rate, funding government almost entirely through consumer spending",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "state",
      taxType: "salesTax",
    },
    allowedScope: "state",
  },
  {
    _id: "us_state_domestic_corporate_tax_rate",
    countryScope: "us",
    name: "State Domestic Corporate Tax Rate",
    description: "Set the state tax rate on corporations headquartered in the United States",
    explanation:
      "State tax on profits of US-headquartered corporations operating in this state. Lower rates attract domestic businesses; higher rates fund state services. Foreign corporations operating here are taxed separately (see State Foreign Corporate Tax Rate).",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "state",
    },
    // gdpGrowth primary removed: engine-owned metric, the weighted target was
    // dead — converted to the demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.4 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: 0.3 },
    ],
    demographicEffects: [
      // State corporate tax posture shapes local business-owner lean directly
      // (state scope: full multiplier — the fast lever vs the federal rate).
      { groupId: "small_business", target: "economicLean", direction: 0.75 },
    ],
    positions: standardCommitteePositions("Finance"),
    policyOptions: taxRateOptions("state_domestic_corporate_tax_rate", [
      {
        rate: 0,
        name: "Business Tax Haven Act",
        description:
          "Eliminate state corporate taxation entirely to attract business headquarters and investment",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 2,
        name: "Pro-Business Climate Act",
        description:
          "A token corporate tax rate positioning the state as a premier destination for enterprise",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 4,
        name: "Enterprise Attraction Act",
        description: "A low corporate rate designed to lure businesses from higher-tax states",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 6,
        name: "Business-Friendly Revenue Act",
        description:
          "A modest corporate tax balancing revenue needs with a competitive business environment",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 8,
        name: "Moderate Business Tax Act",
        description: "A below-average corporate rate encouraging business retention and growth",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 10,
        name: "Balanced Business Revenue Act",
        description:
          "A mid-range corporate tax rate providing steady revenue without discouraging investment",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 13,
        name: "Corporate Responsibility Tax",
        description:
          "An above-average rate requiring businesses to contribute more to state services",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 16,
        name: "Business Fair Share Act",
        description:
          "A higher corporate rate funding expanded public infrastructure and workforce programs",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 19,
        name: "Corporate Revenue Maximization Act",
        description:
          "Elevated corporate taxes funding comprehensive state investment in education and services",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 22,
        name: "Corporate Wealth Capture Act",
        description:
          "Among the highest state corporate rates, extracting substantial revenue from business profits",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 25,
        name: "Maximum State Corporate Tax Act",
        description:
          "The highest state corporate tax rate, maximizing revenue extraction from businesses operating in the state",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "state",
      taxType: "domesticCorporateTax",
    },
    allowedScope: "state",
  },
  {
    _id: "us_state_foreign_corporate_tax_rate",
    countryScope: "us",
    name: "State Foreign Corporate Tax Rate",
    description: "Set the state tax rate on corporations headquartered outside the United States",
    explanation:
      "State-level tax on profits earned in this state by foreign-headquartered corporations. Lower rates attract FDI to this state; higher rates protect local industry. Applied uniformly to all non-US-HQ corporations operating here — no country targeting.",
    policyDomain: "tax",
    subCategory: "Foreign corporate taxation",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "state",
    },
    // gdpGrowth primary removed: engine-owned metric, the weighted target was
    // dead — converted to the demographicEffects below.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "unemploymentRate", weight: 0.2 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
    ],
    demographicEffects: [
      // A state courting FDI (right) builds a multinational professional class
      // that normalizes market-friendly economics; taxing it away reverses the
      // pull (state scope: full multiplier).
      { groupId: "secular_professionals", target: "economicLean", direction: 0.5 },
    ],
    positions: standardCommitteePositions("Finance"),
    policyOptions: taxRateOptions("us_state_foreign_corporate_tax_rate", [
      {
        rate: 0,
        name: "Open State for Foreign Capital",
        description:
          "Eliminate state taxation on foreign corporations to aggressively attract headquarters and investment",
        stance: "right",
        economic: 5,
        social: 1,
      },
      {
        rate: 4,
        name: "Foreign Investment Magnet Act",
        description: "A minimal foreign rate to draw multinational operations into the state",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 8,
        name: "FDI-Friendly State Rate",
        description: "A low foreign corporate rate encouraging cross-border operations in-state",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 12,
        name: "Moderate Foreign Investor Act",
        description: "A below-parity foreign rate signaling an investment-friendly state climate",
        stance: "center",
        economic: 1,
        social: 0,
      },
      {
        rate: 16,
        name: "State Parity Rate",
        description:
          "Tax foreign corporations at the same state rate as domestic — a neutral, non-discriminatory policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Modestly Protective State Rate",
        description: "A marginally higher state foreign rate favoring in-state businesses",
        stance: "center",
        economic: -1,
        social: 0,
      },
      {
        rate: 24,
        name: "State Foreign Accountability Act",
        description:
          "A meaningfully higher state rate funding services from foreign corporate profits",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 28,
        name: "State Workers Defense Act",
        description:
          "Elevated state rates funding local workforce programs and discouraging foreign offshoring",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        // High foreign-corp rate ⇒ economically left; stance corrected from a
        // sovereignty theme so the effectDirection ladder stays monotone (Bug #0962).
        rate: 32,
        name: "State-First Foreign Corp Tax",
        description:
          "A nationalist state regime protecting in-state business interests from outside competition",
        stance: "left",
        economic: -3,
        social: -2,
      },
      {
        rate: 36,
        name: "State Sovereignty Tax",
        description:
          "A near-punitive state rate asserting local economic control over foreign capital",
        stance: "left",
        economic: -4,
        social: -3,
      },
      {
        rate: 40,
        name: "Maximum State Foreign Extraction Act",
        description:
          "The highest state-level foreign corporate rate, maximizing revenue from multinational profits",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
    taxRateChange: {
      scope: "state",
      taxType: "foreignCorporateTax",
    },
    allowedScope: "state",
  },
  {
    _id: "us_state_property_tax_rate",
    countryScope: "us",
    name: "State Property Tax Rate",
    description: "Set the state property tax rate",
    explanation:
      "Annual tax based on property value. Primary funding source for local schools and services. Higher rates increase housing costs; lower rates may underfund schools.",
    policyDomain: "tax",
    subCategory: "State tax rates",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "medianIncome",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "social", metric: "homelessnessRate", weight: 0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.4 },
    ]),
    demographicEffects: [
      { groupId: "suburban", direction: 0.01 }, // Property taxes affect homeownership
    ],
    positions: standardCommitteePositions("Finance"),
    policyOptions: taxRateOptions("state_property_tax_rate", [
      {
        rate: 0,
        name: "Property Tax Abolition Act",
        description:
          "Eliminate property taxation entirely, removing the primary funding source for local schools and services",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 0.25,
        name: "Minimal Property Assessment",
        description:
          "A near-zero property tax rate dramatically reducing homeowner and landlord tax burden",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 0.5,
        name: "Homeowner Relief Act",
        description:
          "A low property tax rate prioritizing housing affordability over local revenue",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 0.75,
        name: "Low-Burden Property Levy",
        description:
          "A modest property tax keeping housing costs low while funding essential local services",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 1.0,
        name: "Affordable Housing Tax Act",
        description:
          "A below-average property tax rate balancing homeownership costs with school funding needs",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 1.5,
        name: "Standard Property Revenue Act",
        description:
          "A mid-range property tax rate providing reliable funding for schools, roads, and emergency services",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 2.0,
        name: "Enhanced Local Services Levy",
        description:
          "An above-average property tax funding expanded schools, parks, and public infrastructure",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 2.5,
        name: "Community Investment Tax Act",
        description:
          "A higher property tax enabling robust investment in local education and municipal services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 3.0,
        name: "Public Infrastructure Priority Act",
        description:
          "Elevated property taxes funding comprehensive local government services and capital improvements",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 4.0,
        name: "Maximum Local Investment Act",
        description:
          "Among the highest property tax rates, extracting substantial revenue from property owners for public use",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5.0,
        name: "Maximum Property Tax Act",
        description:
          "The highest property tax rate, maximizing local revenue extraction from real estate holdings",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: {
      scope: "state",
      taxType: "propertyTax",
    },
    allowedScope: "state",
  },

  // ── UK Legislation Types ────────────────────────────────────────────────
  // 55 types: 7 tax (5 national + 2 regional) + 48 policy (34 national + 14 regional)
  // See docs/plans/archive/2026-04/2026-04-05-uk-legislation-overhaul-design.md

  // ── A. UK Tax Types (11 brackets) ─────────────────────────────────────

  // A1. Income Tax Rate (National)
  {
    _id: "uk_income_tax_rate",
    countryScope: "uk",
    name: "Income Tax Rate Act",
    description: "Sets the UK income tax rate on earned income",
    policyDomain: "tax",
    subCategory: "Personal taxation",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "economic", metric: "povertyRate", weight: 0.5 },
      { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      { category: "social", metric: "incomeInequality", weight: -0.6 },
      { category: "economic", metric: "costOfLiving", weight: 0.3 },
    ]),
    demographicEffects: [{ groupId: "wealthy", direction: -0.02 }],
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_income_tax_rate", [
      {
        rate: 0,
        name: "Abolish Income Tax Act",
        description:
          "Eliminate income taxation entirely, funding the state through VAT and consumption taxes alone",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 4,
        name: "Minimal Revenue Levy",
        description:
          "A token income tax dramatically shrinking HMRC revenue capacity and the size of government",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 8,
        name: "Flat Tax Revolution Act",
        description: "A simple low flat tax replacing the progressive band system entirely",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 12,
        name: "Enterprise Britain Tax Act",
        description:
          "Deep rate cuts to unleash private investment and make Britain globally competitive",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 16,
        name: "Taxpayer Relief Act",
        description:
          "Meaningful rate reductions while preserving core public services and NHS funding",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 20,
        name: "Working Families Tax Framework",
        description: "A moderate rate balancing revenue needs with household affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Shared Prosperity Tax Plan",
        description: "Modestly higher rates to fund expanded public services and reduce inequality",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 28,
        name: "Fair Contribution Act",
        description:
          "Restore historically higher rates to close the deficit and fund NHS expansion",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 32,
        name: "Progressive Revenue Act",
        description:
          "Significantly higher rates to fund comprehensive healthcare and education expansion",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 36,
        name: "Wealth Equity Tax Act",
        description: "Near-historic top rates to aggressively redistribute income across society",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Redistribution Act",
        description:
          "A steeply progressive rate targeting the highest earners to maximise Treasury revenue and fund sweeping social programmes",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "incomeTax" },
  },

  // A2. National Insurance Rate (National)
  {
    _id: "uk_national_insurance",
    countryScope: "uk",
    name: "National Insurance Rate Act",
    description: "Sets the combined employer and employee National Insurance contribution rate",
    policyDomain: "tax",
    subCategory: "Payroll contributions",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "healthcare", metric: "nhsWaitingTime", weight: -0.5 },
      { category: "healthcare", metric: "lifeExpectancy", weight: 0.4 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
    ]),
    demographicEffects: [{ groupId: "retirees", direction: 0.01 }],
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_national_insurance", [
      {
        rate: 0,
        name: "National Insurance Abolition Act",
        description:
          "Eliminate NI contributions entirely, privatising pension and healthcare funding",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 2.4,
        name: "Entitlement Privatisation Act",
        description:
          "A minimal NI contribution paired with private pension and health savings accounts",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 4.8,
        name: "Personal Responsibility Compact",
        description:
          "Dramatically reduced NI burden, shifting retirement and healthcare costs to individuals",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 7.2,
        name: "NI Relief Act",
        description:
          "Significant cuts to National Insurance to boost take-home pay for working families",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 9.6,
        name: "Worker Affordability Act",
        description: "Reduced NI contributions easing the burden on employers and low-wage workers",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 12,
        name: "Social Insurance Preservation Act",
        description:
          "A rate sufficient to fund core NHS and State Pension obligations without expansion or reduction",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 14.4,
        name: "NHS Security Act",
        description: "Higher contributions to shore up NHS funding and State Pension solvency",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 16.8,
        name: "Expanded Benefits Act",
        description: "Increased NI funding to expand NHS services and raise State Pension payments",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 19.2,
        name: "Universal Entitlement Act",
        description:
          "Substantially higher NI taxes funding comprehensive healthcare and enhanced pension benefits",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 21.6,
        name: "Cradle-to-Grave Security Act",
        description: "High NI rates funding comprehensive social insurance from birth to death",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 24,
        name: "Maximum Social Insurance Act",
        description:
          "The highest NI rate, funding a fully comprehensive welfare state through employer and worker contributions",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "payrollTax" },
  },

  // A3. VAT Rate (National) — regressive: higher rate = right
  {
    _id: "uk_vat",
    countryScope: "uk",
    name: "VAT Rate Act",
    description: "Sets the UK standard Value Added Tax rate on goods and services",
    policyDomain: "tax",
    subCategory: "Consumption tax",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    // VAT is a consumption tax on an INVERTED axis (high rate = right). Cost of
    // living stays the headline effect but must carry a NEGATIVE weight (higher
    // VAT raises consumer prices); poverty likewise rises. Written as an explicit
    // array because weightedTargets() forces the primary to +1.0. Mirrors
    // ie_vat_rate.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -1.0 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.25 },
      { metricCategoryId: "economic", metricId: "povertyRate", weight: -0.5 },
      // Higher VAT raises food costs, worsening food insecurity (value up).
      { metricCategoryId: "social", metricId: "foodInsecurity", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
    ],
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_vat", [
      {
        rate: 0,
        name: "VAT Abolition Act",
        description:
          "Eliminate Value Added Tax entirely, preserving purchasing power for low-income households",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 4,
        name: "Minimal Consumption Levy",
        description:
          "A token VAT rate generating modest revenue with limited impact on consumer prices",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 8,
        name: "Reduced VAT Act",
        description:
          "A low VAT rate significantly reducing the cost of living for ordinary families",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 12,
        name: "Consumer Relief Act",
        description:
          "A moderate consumption tax shifting some burden away from regressive VAT toward income taxes",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 16,
        name: "Balanced Consumption Tax Act",
        description:
          "A below-standard VAT rate used to offset increases in progressive income taxation",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 20,
        name: "Standard VAT Act",
        description:
          "The standard VAT rate balancing Treasury revenue needs with consumer affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 24,
        name: "Revenue Diversification Act",
        description:
          "An elevated VAT replacing a portion of income tax revenue with consumption-based collection",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 28,
        name: "Consumption Priority Act",
        description:
          "A high VAT designed to simplify the tax code by reducing reliance on income taxes",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 32,
        name: "European-Level VAT Act",
        description:
          "A continental-style VAT rate replacing significant progressive income taxation",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 36,
        name: "Consumption-First Tax Act",
        description:
          "A near-total shift from income taxation to consumption-based revenue collection",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 40,
        name: "Maximum Consumption Tax Act",
        description:
          "The highest VAT rate, fully replacing income taxation with a regressive spending-based system",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "salesTax" },
  },

  // A4. Corporation Tax Rate (National)
  {
    _id: "uk_domestic_corporation_tax",
    countryScope: "uk",
    name: "Domestic Corporation Tax Rate Act",
    description: "Sets the UK corporation tax rate on profits of UK-headquartered companies",
    policyDomain: "tax",
    subCategory: "Corporate taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        { category: "economic", metric: "gdpGrowth", weight: 0.5 },
        // A lower corporate tax (right) eases hiring, so a higher rate must RAISE
        // unemployment: positive weight (matches US/JP/IE corporate-tax bills).
        { category: "economic", metric: "unemploymentRate", weight: 0.4 },
        { category: "economic", metric: "medianIncome", weight: 0.3 },
      ]
    ),
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_domestic_corporation_tax", [
      {
        rate: 0,
        name: "Corporation Tax Elimination Act",
        description:
          "Abolish taxation on corporate profits entirely, making Britain the world's most competitive tax destination",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 5,
        name: "Business Liberation Act",
        description:
          "A near-zero corporate rate designed to attract multinational headquarters to the City of London",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 10,
        name: "Enterprise Growth Compact",
        description:
          "A low flat rate to attract global investment and stimulate domestic business expansion",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 15,
        name: "Small Business Prosperity Act",
        description: "Rate cuts favouring capital formation and SME growth across Britain",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 20,
        name: "Competitive Markets Tax Plan",
        description:
          "A globally competitive rate aligned with OECD averages to attract inward investment",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "Balanced Corporate Revenue Act",
        description: "A moderate rate balancing business competitiveness with public revenue needs",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 30,
        name: "Corporate Accountability Tax",
        description:
          "Higher rates requiring corporations to contribute a larger share of Treasury revenue",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 35,
        name: "Corporate Fair Share Act",
        description:
          "Rates approaching historically traditional levels to close revenue gaps and fund public services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 40,
        name: "Corporate Excess Profits Act",
        description:
          "Elevated rates targeting outsized corporate earnings to fund public investment",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 45,
        name: "Corporate Wealth Recapture Act",
        description:
          "Rates exceeding the historic norm, extracting substantial revenue from corporate profits",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Corporate Extraction Act",
        description:
          "The highest modern corporate tax rate, capturing half of all corporate profits for public use",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
  },

  // A4b. Foreign Corporation Tax Rate (National)
  {
    _id: "uk_foreign_corporation_tax",
    countryScope: "uk",
    name: "Foreign Corporation Tax Rate Act",
    description: "Sets the UK tax rate on profits of companies headquartered outside the UK",
    policyDomain: "tax",
    subCategory: "Foreign corporate taxation",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "gdpGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      { category: "economic", metric: "unemploymentRate", weight: 0.2 },
      { category: "economic", metric: "smallBusinessFormation", weight: -0.3 },
      { category: "economic", metric: "costOfLiving", weight: 0.2 },
    ]),
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_foreign_corporation_tax", [
      {
        rate: 0,
        name: "Open Markets for Capital Act",
        description:
          "Abolish British taxation on foreign corporate profits, making Britain the ultimate free-market destination for global capital",
        stance: "right",
        economic: 5,
        social: 1,
      },
      {
        rate: 6,
        name: "Global Britain Investment Act",
        description:
          "A near-zero foreign rate to establish London as the world's multinational headquarters hub",
        stance: "right",
        economic: 4,
        social: 1,
      },
      {
        rate: 13,
        name: "Business-Friendly Foreign Rate",
        description: "A low foreign corporate rate encouraging FDI and City of London operations",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 19,
        name: "Moderate Investor Act",
        description: "A slightly-below-parity foreign rate signaling an open-for-business climate",
        stance: "center",
        economic: 1,
        social: 0,
      },
      {
        rate: 26,
        name: "Parity with Domestic Corporation Tax",
        description:
          "Tax foreign corporations at the same rate as British firms — a neutral, non-discriminatory policy",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 32,
        name: "Modestly Protective Foreign Rate",
        description: "A marginally higher rate favoring British-headquartered companies",
        stance: "center",
        economic: -1,
        social: 0,
      },
      {
        rate: 39,
        name: "Foreign Capital Accountability Act",
        description:
          "A meaningfully higher rate funded by profits extracted by multinational corporations operating in Britain",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 45,
        name: "British Workers Defence Act",
        description:
          "Elevated rates funding domestic workforce programmes and discouraging foreign offshoring",
        stance: "left",
        economic: -3,
        social: -1,
      },
      {
        // High foreign-corp rate ⇒ economically left; stance must match the tax
        // level (was "right" on a sovereignty theme, breaking the monotone ladder
        // optionIntensity relies on — Bug #0962).
        rate: 52,
        name: "Britain First Foreign Corp Tax",
        description:
          "A Brexit-era sovereignty regime protecting British business interests from foreign competition",
        stance: "left",
        economic: -3,
        social: -2,
      },
      {
        rate: 58,
        name: "British Economic Sovereignty Act",
        description:
          "A near-punitive foreign rate asserting British economic independence from multinational capital",
        stance: "left",
        economic: -4,
        social: -3,
      },
      {
        rate: 65,
        name: "Multinational Extraction Act",
        description:
          "The highest British foreign corporate rate, maximizing revenue from transnational profits",
        stance: "left",
        economic: -5,
        social: -2,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
  },

  // A5. Excise and Customs Duties (National) — regressive: higher rate = right (protectionist)
  {
    _id: "uk_excise_customs",
    countryScope: "uk",
    name: "Excise and Customs Duties Act",
    description: "Sets UK excise duties and post-Brexit customs tariff rates",
    policyDomain: "tax",
    subCategory: "Duties / excise",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "national" },
    // Cost of living stays the headline effect of customs duties but with a
    // NEGATIVE weight: higher tariffs raise consumer prices. Written as an
    // explicit array (not weightedTargets, which forces the primary to +1.0)
    // so the sign can be inverted. Magnitude -0.4 matches the DE/IE/CN bills.
    effectTargetsWeighted: [
      { metricCategoryId: "economic", metricId: "costOfLiving", weight: -0.4 },
      { metricCategoryId: "economic", metricId: "gdpGrowth", weight: -0.3 },
      { metricCategoryId: "economic", metricId: "smallBusinessFormation", weight: -0.3 },
      { metricCategoryId: "environment", metricId: "carbonEmissions", weight: -0.2 },
    ],
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: taxRateOptions("uk_excise_customs", [
      {
        rate: 0,
        name: "Free Trade and Zero Duty Act",
        description:
          "Abolish all excise duties and customs tariffs, embracing unrestricted global free trade",
        stance: "left",
        economic: -5,
        social: 0,
      },
      {
        rate: 2,
        name: "Open Markets Accord",
        description: "Minimal revenue duties only, maximising trade openness and consumer choice",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5,
        name: "Free Trade Preservation Act",
        description: "Low duties limited to specific trade agreement enforcement mechanisms",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 8,
        name: "Fair Trade Compact",
        description: "Modest duties targeting unfair trade practices while preserving open markets",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 12,
        name: "Reciprocal Trade Act",
        description: "Duties calibrated to match rates imposed by trading partners",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 15,
        name: "Balanced Trade and Excise Act",
        description:
          "A moderate duty rate balancing domestic industry protection with consumer affordability",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 20,
        name: "Domestic Industry Shield Act",
        description:
          "Elevated duties protecting key British manufacturing sectors from foreign competition",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 25,
        name: "British Production First Act",
        description:
          "Broad duties designed to incentivise reshoring of factories and supply chains",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 30,
        name: "Industrial Fortress Act",
        description:
          "High protective duties across most imported goods to rebuild domestic manufacturing",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 40,
        name: "Economic Nationalism Act",
        description: "Sweeping duties walling off the domestic economy from global competition",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 50,
        name: "Maximum Protectionist Act",
        description:
          "The highest peacetime duty rates, designed to achieve near-total economic self-sufficiency",
        stance: "right",
        economic: 5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "federal", taxType: "tariffs" },
  },

  // A6. Council Tax Rate (Regional)
  {
    _id: "uk_council_tax",
    countryScope: "uk",
    name: "Council Tax Rate Act",
    description: "Sets the regional council tax rate on residential property",
    policyDomain: "tax",
    subCategory: "Local property tax",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "economic", metricId: "costOfLiving", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "costOfLiving" }, [
      { category: "social", metric: "housingAffordability", weight: 0.6 },
      { category: "economic", metric: "propertyValueIndex", weight: -0.3 },
    ]),
    positions: standardUKCommitteePositions("Finance"),
    policyOptions: taxRateOptions("uk_council_tax", [
      {
        rate: 0,
        name: "Council Tax Abolition Act",
        description:
          "Eliminate council tax entirely, removing the primary funding source for local services",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 0.25,
        name: "Minimal Council Assessment",
        description: "A near-zero council tax rate dramatically reducing household tax burden",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 0.5,
        name: "Householder Relief Act",
        description: "A low council tax rate prioritising housing affordability over local revenue",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 0.75,
        name: "Low-Burden Council Levy",
        description:
          "A modest council tax keeping housing costs low while funding essential local services",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 1.0,
        name: "Affordable Housing Tax Act",
        description:
          "A below-average council tax rate balancing homeownership costs with local service funding",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 1.5,
        name: "Standard Council Tax Act",
        description:
          "A mid-range council tax rate providing reliable funding for local schools, roads, and emergency services",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 2.0,
        name: "Enhanced Local Services Levy",
        description:
          "An above-average council tax funding expanded schools, parks, and public infrastructure",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 2.5,
        name: "Community Investment Tax Act",
        description:
          "A higher council tax enabling robust investment in local education and municipal services",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 3.0,
        name: "Public Infrastructure Priority Act",
        description:
          "Elevated council tax funding comprehensive local government services and capital improvements",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 4.0,
        name: "Maximum Local Investment Act",
        description:
          "Among the highest council tax rates, extracting substantial revenue from property owners for public use",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 5.0,
        name: "Maximum Council Tax Act",
        description:
          "The highest council tax rate, maximising local revenue extraction from residential property",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
    taxRateChange: { scope: "state", taxType: "propertyTax" },
  },

  // A7. Business Rates (Regional)
  {
    _id: "uk_business_rates",
    countryScope: "uk",
    name: "Business Rates Act",
    description: "Sets the regional business rates on commercial property",
    policyDomain: "tax",
    subCategory: "Commercial property tax",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        { category: "economic", metric: "commercialValueIndex", weight: -0.4 },
        { category: "economic", metric: "unemploymentRate", weight: -0.3 },
      ]
    ),
    positions: standardUKCommitteePositions("Finance"),
    policyOptions: taxRateOptions("uk_business_rates", [
      {
        rate: 0,
        name: "Business Rate Abolition Act",
        description:
          "Eliminate business rates entirely to attract commercial investment and enterprise to the region",
        stance: "right",
        economic: 5,
        social: 0,
      },
      {
        rate: 10,
        name: "Enterprise Zone Act",
        description:
          "A near-zero rate positioning the region as a premier destination for business",
        stance: "right",
        economic: 4,
        social: 0,
      },
      {
        rate: 20,
        name: "Business Attraction Act",
        description: "A low rate designed to lure businesses from higher-tax regions and overseas",
        stance: "right",
        economic: 3,
        social: 0,
      },
      {
        rate: 30,
        name: "Business-Friendly Revenue Act",
        description:
          "A modest rate balancing revenue needs with a competitive commercial environment",
        stance: "right",
        economic: 2,
        social: 0,
      },
      {
        rate: 40,
        name: "Moderate Business Rate Act",
        description: "A below-average rate encouraging business retention and growth in the region",
        stance: "right",
        economic: 1,
        social: 0,
      },
      {
        rate: 50,
        name: "Balanced Business Rate Act",
        description:
          "A mid-range business rate providing steady revenue without discouraging commercial investment",
        stance: "center",
        economic: 0,
        social: 0,
      },
      {
        rate: 60,
        name: "Commercial Responsibility Rate",
        description:
          "An above-average rate requiring businesses to contribute more to local services",
        stance: "left",
        economic: -1,
        social: 0,
      },
      {
        rate: 70,
        name: "Business Fair Share Act",
        description:
          "A higher rate funding expanded public infrastructure and workforce programmes",
        stance: "left",
        economic: -2,
        social: 0,
      },
      {
        rate: 80,
        name: "Commercial Revenue Maximisation Act",
        description:
          "Elevated rates funding comprehensive regional investment in education and services",
        stance: "left",
        economic: -3,
        social: 0,
      },
      {
        rate: 90,
        name: "Commercial Wealth Capture Act",
        description:
          "Among the highest business rates, extracting substantial revenue from commercial property",
        stance: "left",
        economic: -4,
        social: 0,
      },
      {
        rate: 100,
        name: "Maximum Business Rate Act",
        description:
          "The highest business rate, maximising revenue extraction from commercial premises in the region",
        stance: "left",
        economic: -5,
        social: 0,
      },
    ]),
  },

  // ── B. UK Policy Types (7 options) ────────────────────────────────────

  // ── B1. Healthcare ────────────────────────────────────────────────────

  // uk_nhs_funding — NHS Budget Act (National)
  {
    _id: "uk_nhs_funding",
    countryScope: "uk",
    name: "NHS Budget Act",
    description: "Controls the overall NHS England budget and healthcare spending commitments",
    policyDomain: "healthcare",
    subCategory: "NHS budget",
    budgetCategory: "healthcare",
    nationalOnly: true,
    // §4.7 (P2b): the NHS budget IS the mechanism — its healthcare spend now
    // drives waiting times/physicians/mortality via the engine's spending
    // channel, so the direct readout targets double-counted. Re-pointed to the
    // system-capacity root (publicHealthPreparedness).
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [{ category: "economic", metric: "economicFreedom", weight: -0.15 }]
    ),
    demographicEffects: [{ groupId: "retirees", direction: 0.01 }],
    positions: standardUKCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_nhs_funding",
        [
          { name: "Universal NHS Expansion Act", stance: "left", effectDirection: 1 },
          { name: "NHS Investment and Modernisation Act", stance: "left", effectDirection: 1 },
          { name: "NHS Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "NHS Sustainability Act", stance: "center", effectDirection: 0 },
          { name: "NHS Efficiency and Reform Act", stance: "right", effectDirection: -1 },
          { name: "NHS Marketisation Act", stance: "right", effectDirection: -1 },
          { name: "NHS Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand NHS capacity with new hospitals, eliminate all waiting lists, and guarantee same-day GP access for every resident",
          "Significantly increase NHS funding to hire thousands of new doctors and nurses, rebuild aging hospitals, and expand mental health services",
          "Modestly increase NHS budgets to reduce waiting times, fund new treatments, and improve staff retention through better pay",
          "A moderate level of NHS funding sustaining standard service levels, maintaining hospitals, and meeting demographic demand",
          "Reduce NHS spending through private sector partnerships, outsourced services, and market-based efficiency reforms",
          "Dramatically cut direct NHS provision, expanding private healthcare delivery through insurance-based co-payment models",
          "Abolish the National Health Service as a public provider, replacing it with a private insurance-based healthcare market",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [4396, 3419, 2833, 2345, 1758, 977, 0]
    ),
  },

  // uk_social_care — Social Care and Elderly Services Act (National)
  {
    _id: "uk_social_care",
    countryScope: "uk",
    name: "Social Care and Elderly Services Act",
    description: "Adult social care funding, elderly care, and domiciliary support",
    policyDomain: "healthcare",
    subCategory: "Social care",
    budgetCategory: "healthcare",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "socialCareQuality",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "socialCareQuality" },
      [
        { category: "healthcare", metric: "lifeExpectancy", weight: 0.3 },
        { category: "social", metric: "socialMobility", weight: 0.2 },
        // Free/expanded social care (left) reduces poverty: positive weight.
        { category: "economic", metric: "povertyRate", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    demographicEffects: [{ groupId: "retirees", direction: 0.02 }],
    positions: standardUKCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_social_care",
        [
          { name: "Universal Free Social Care Act", stance: "left", effectDirection: 1 },
          { name: "Social Care Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Care Quality Investment Act", stance: "left", effectDirection: 1 },
          { name: "Social Care Framework Act", stance: "center", effectDirection: 0 },
          { name: "Social Care Reform Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Social Care Act", stance: "right", effectDirection: -1 },
          { name: "Social Care Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee free personal care for all adults regardless of means, nationalise care homes, and fund comprehensive domiciliary support",
          "Significantly expand state-funded care, cap individual care costs at £50,000 lifetime, and raise carer pay to NHS nurse levels",
          "Modestly increase social care funding to reduce council waiting lists, improve care home inspections, and expand respite services",
          "A moderate level of social care funding sustaining standard means-tested provision and care home regulation",
          "Tighten means-testing, encourage private insurance for care costs, and incentivise family-based care over state provision",
          "Dramatically reduce state social care to emergency safeguarding only, leaving elderly care to private providers and families",
          "Eliminate all state-funded social care, leaving elderly and disabled support entirely to private insurance and family responsibility",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [1465, 1075, 781, 537, 342, 147, 0]
    ),
  },

  // uk_mental_health — Mental Health Services Act (National)
  {
    _id: "uk_mental_health",
    countryScope: "uk",
    name: "Mental Health Services Act",
    description: "NHS mental health services funding and access",
    policyDomain: "healthcare",
    subCategory: "Mental health",
    budgetCategory: "healthcare",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "mentalHealthAccess",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "mentalHealthAccess" },
      [
        { category: "healthcare", metric: "preventableMortality", weight: 0.3 },
        { category: "economic", metric: "unemploymentRate", weight: -0.2 },
        { category: "publicSafety", metric: "crimeRate", weight: -0.2 },
        { category: "social", metric: "socialCohesion", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_mental_health",
        [
          { name: "Universal Mental Health Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Mental Health Parity Act", stance: "left", effectDirection: 1 },
          { name: "Mental Health Investment Act", stance: "left", effectDirection: 1 },
          { name: "Mental Health Services Act", stance: "center", effectDirection: 0 },
          { name: "Mental Health Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Mental Health Provision Act", stance: "right", effectDirection: -1 },
          { name: "Mental Health Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee same-day access to mental health services for all, fund therapeutic support in every school and workplace, and eliminate all waiting lists",
          "Significantly increase mental health funding to achieve true parity with physical health services across the NHS",
          "Modestly expand IAPT services, increase crisis team staffing, and reduce waiting times for therapy and psychiatric care",
          "A moderate level of mental health funding sustaining NHS psychological services and crisis intervention capacity",
          "Reduce direct NHS mental health provision, encouraging private therapy services and digital mental health platforms",
          "Cut NHS mental health services to crisis intervention only, leaving routine therapy and counselling to private providers",
          "Eliminate dedicated NHS mental health services, leaving psychiatric care to GPs, private therapists, and charitable organisations",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [586, 440, 293, 195, 122, 49, 0]
    ),
  },

  // uk_public_health — Public Health and Prevention Act (National)
  {
    _id: "uk_public_health",
    countryScope: "uk",
    name: "Public Health and Prevention Act",
    description: "Public health infrastructure, disease prevention, and pandemic preparedness",
    policyDomain: "healthcare",
    subCategory: "Public health",
    budgetCategory: "healthcare",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "national",
    },
    // §4.7 (P2b): derived-readout secondaries dropped — preparedness (the root
    // primary) and the law's healthcare spend now drive them via the engine.
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [{ category: "economic", metric: "economicFreedom", weight: -0.15 }]
    ),
    positions: standardUKCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_public_health",
        [
          { name: "Comprehensive Public Health Act", stance: "left", effectDirection: 1 },
          { name: "Public Health Workforce Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Community Health Investment Act", stance: "left", effectDirection: 1 },
          { name: "Public Health Services Act", stance: "center", effectDirection: 0 },
          { name: "Targeted Public Health Act", stance: "right", effectDirection: -1 },
          { name: "Public Health Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Public Health Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand UKHSA, fund universal screening programmes, build pandemic preparedness infrastructure, and guarantee health visitors for every family",
          "Significantly increase public health staffing, expand disease research grants, and invest in community health infrastructure",
          "Modestly increase public health funding for vaccination drives, smoking cessation, obesity prevention, and health education",
          "A moderate level of public health funding supporting disease monitoring, vaccination programmes, and emergency preparedness",
          "Focus public health spending on critical threats only, reducing broad prevention and health promotion programmes",
          "Substantially cut UKHSA and public health budgets, deferring disease prevention to NHS GPs and local councils",
          "Eliminate dedicated public health agencies, leaving disease prevention and health promotion entirely to the NHS and private sector",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [147, 107, 73, 44, 24, 10, 0]
    ),
  },

  // uk_regional_health — Regional Health Services Act (Regional)
  {
    _id: "uk_regional_health",
    countryScope: "uk",
    name: "Regional Health Services Act",
    description: "Regional health commissioning, community clinics, and local health initiatives",
    policyDomain: "healthcare",
    subCategory: "Regional health",
    budgetCategory: "healthcare",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "healthcare",
      metricId: "publicHealthPreparedness",
      scope: "state",
    },
    // §4.7 (P2b): nhsWaitingTime/mentalHealthAccess secondaries dropped (engine
    // spending channel drives them); the non-channel socialCohesion term stays.
    effectTargetsWeighted: weightedTargets(
      { category: "healthcare", metric: "publicHealthPreparedness" },
      [
        { category: "social", metric: "socialCohesion", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Health"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_health",
        [
          { name: "Comprehensive Regional Health Act", stance: "left", effectDirection: 1 },
          { name: "Regional Health Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Community Wellness Act", stance: "left", effectDirection: 1 },
          { name: "Regional Health Services Act", stance: "center", effectDirection: 0 },
          { name: "Lean Regional Health Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Regional Health Act", stance: "right", effectDirection: -1 },
          { name: "Regional Health Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund community health centres in every neighbourhood, guarantee health visitors for all families, and run extensive local screening programmes",
          "Significantly expand council health services, fund local clinics, and invest in community mental health and addiction programmes",
          "Modestly increase regional health spending on community clinics, health visiting, and local prevention campaigns",
          "A moderate level of regional health funding supporting community clinics, health visitors, and basic local health programmes",
          "Reduce council health spending, focusing only on statutory public health obligations and essential community services",
          "Cut regional health services to mandatory safeguarding and emergency public health functions only",
          "Eliminate all council-funded health services, leaving community health provision entirely to the NHS and voluntary sector",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [244, 186, 127, 83, 49, 20, 0]
    ),
  },

  // ── B2. Education ─────────────────────────────────────────────────────

  // uk_tuition_fees — Tuition Fees and Higher Education Act (National)
  {
    _id: "uk_tuition_fees",
    countryScope: "uk",
    name: "Tuition Fees and Higher Education Act",
    description: "University tuition fee policy and student loan terms",
    policyDomain: "education",
    subCategory: "Higher education / fees",
    budgetCategory: "education",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "universityEnrollment",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "education", metric: "universityEnrollment" },
      [
        { category: "social", metric: "socialMobility", weight: 0.5 },
        // Free/subsidised tuition (left) reduces income inequality: positive weight.
        { category: "social", metric: "incomeInequality", weight: 0.3 },
        { category: "education", metric: "workforceSkill", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.2 },
      ]
    ),
    demographicEffects: [{ groupId: "college", direction: 0.01 }],
    positions: standardUKCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_tuition_fees",
        [
          { name: "Free University Education Act", stance: "left", effectDirection: 1 },
          { name: "Tuition Fee Reduction Act", stance: "left", effectDirection: 1 },
          { name: "Graduate Affordability Act", stance: "left", effectDirection: 1 },
          { name: "Higher Education Funding Act", stance: "center", effectDirection: 0 },
          { name: "University Market Reform Act", stance: "right", effectDirection: -1 },
          { name: "Higher Education Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "University Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish tuition fees entirely, fund all universities through general taxation, and provide maintenance grants for every student",
          "Halve maximum tuition fees to £4,500, expand maintenance grants, and increase direct university funding from Treasury",
          "Modestly reduce tuition fees, lower student loan interest rates, and raise the repayment threshold to ease graduate debt burden",
          "A moderate level of university funding sustaining the established tuition fee and student loan framework",
          "Raise the tuition fee cap to reflect true costs, reduce direct subsidies, and encourage universities to compete on price and quality",
          "Remove the fee cap entirely, let universities set market rates, and replace grants with private student loans",
          "Eliminate all public university funding, converting institutions to fully private tuition-driven enterprises",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [553, 415, 304, 221, 138, 55, 0]
    ),
  },

  // uk_education_standards — Education Standards and Schools Act (National)
  {
    _id: "uk_education_standards",
    countryScope: "uk",
    name: "Education Standards and Schools Act",
    description: "National curriculum, Ofsted inspections, and academy policy",
    policyDomain: "education",
    subCategory: "Schools / curriculum",
    budgetCategory: "education",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "education", metricId: "gcseAttainment", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "gcseAttainment" }, [
      { category: "education", metric: "testPerformance", weight: 0.6 },
      { category: "education", metric: "literacyRate", weight: 0.4 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardUKCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_education_standards",
        [
          { name: "Universal Public Education Standards Act", stance: "left", effectDirection: 1 },
          { name: "Education Equity Act", stance: "left", effectDirection: 1 },
          { name: "School Standards Partnership Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Education Standards Act", stance: "center", effectDirection: 0 },
          { name: "Academy Expansion Act", stance: "right", effectDirection: -1 },
          { name: "Parental Choice in Education Act", stance: "right", effectDirection: -1 },
          { name: "Full Education Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate a national curriculum for all schools, abolish academies and free schools, and return all schools to local authority control with full Ofsted accountability",
          "Strengthen national curriculum requirements, restrict academy expansion, and increase Ofsted powers to close underperforming schools",
          "Modestly strengthen Ofsted oversight, encourage voluntary national standards adoption, and fund support for underperforming schools",
          "A moderate approach allowing a mix of academies and local authority schools with standard Ofsted inspection regimes",
          "Expand the academy and free school programme, give headteachers more autonomy over curriculum, and reduce Ofsted burden",
          "Dramatically expand free schools, introduce school vouchers, and allow parents to opt out of the national curriculum",
          "Abolish the national curriculum and Ofsted entirely, giving all schools full autonomy over teaching standards and methods",
        ][i],
      })),
      [277, 210, 155, 111, 72, 33, 0]
    ),
  },

  // uk_education_funding — National Schools Budget Act (National)
  {
    _id: "uk_education_funding",
    countryScope: "uk",
    name: "National Schools Budget Act",
    description: "Overall national schools funding via the National Funding Formula",
    policyDomain: "education",
    subCategory: "Schools funding",
    budgetCategory: "education",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "education",
      metricId: "educationSpending",
      scope: "national",
    },
    // §4.7 (P2a): the readout secondaries (gcse/testPerf/literacy/workforceSkill)
    // double-counted — this law's education spend now drives them via the
    // engine's spending channel. Primary educationSpending root only.
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    demographicEffects: [{ groupId: "college", direction: 0.01 }],
    positions: standardUKCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_education_funding",
        [
          { name: "Maximum Schools Investment Act", stance: "left", effectDirection: 1 },
          { name: "Schools Funding Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Education Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "National Schools Funding Act", stance: "center", effectDirection: 0 },
          { name: "Schools Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Schools Funding Act", stance: "right", effectDirection: -1 },
          { name: "Schools Funding Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively increase per-pupil funding, reduce class sizes to 15, guarantee free school meals for all, and fund wraparound childcare in every school",
          "Significantly increase per-pupil spending, hire more teachers, expand SEND provision, and fund breakfast clubs in all primary schools",
          "Modestly increase school funding with targeted investments in underperforming regions and expanded SEND support",
          "A moderate level of per-pupil funding covering core teaching, facilities maintenance, and standard SEND provision",
          "Reduce per-pupil spending through school mergers, larger class sizes, and streamlined administration",
          "Cut national schools funding to essentials only, relying on academy sponsors and private fundraising to supplement",
          "Eliminate national schools funding, leaving education financing entirely to regional councils and private providers",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [1991, 1549, 1217, 940, 664, 332, 0]
    ),
  },

  // uk_research_science — Research and Science Funding Act (National)
  {
    _id: "uk_research_science",
    countryScope: "uk",
    name: "Research and Science Funding Act",
    description: "UKRI, university research grants, and industrial strategy R&D",
    policyDomain: "education",
    subCategory: "Science funding",
    budgetCategory: "education",
    nationalOnly: true,
    // §4.7 (P2a): research FUNDING — its education-category spend drives the
    // workforceSkill/universityEnrollment readouts via the spending channel, so
    // those direct targets double-counted. Re-pointed to rdIntensity (R&D root,
    // TFP input); the non-education coexistence terms stay.
    effectTarget: { metricCategoryId: "economic", metricId: "rdIntensity", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "rdIntensity" }, [
      { category: "economic", metric: "gdpGrowth", weight: 0.4 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    demographicEffects: [{ groupId: "college", direction: 0.01 }],
    positions: standardUKCommitteePositions("Science"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_research_science",
        [
          { name: "Moonshot Research Initiative Act", stance: "left", effectDirection: 1 },
          { name: "Scientific Discovery Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Applied Research Growth Act", stance: "left", effectDirection: 1 },
          { name: "Research Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Industry-Led Innovation Act", stance: "right", effectDirection: -1 },
          { name: "Science Spending Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Research Funding Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Double UKRI budgets, fund transformative research programmes, and guarantee university research grants across all disciplines",
          "Significantly expand UKRI, UK Space Agency, and Catapult centre funding to accelerate breakthroughs in medicine, technology, and clean energy",
          "Modestly increase research grants with emphasis on practical applications, STEM workforce development, and industrial partnerships",
          "A moderate level of research funding supporting ongoing UKRI programmes, university grants, and UK Space Agency operations",
          "Shift research toward public-private partnerships, reducing direct government-funded basic research in favour of commercial R&D",
          "Substantially cut UKRI budgets, relying on private sector and universities to fund their own research programmes",
          "Eliminate UKRI and government science agencies, leaving all research funding to the private sector and university endowments",
        ][i],
        metricEffects: [
          {
            // §4.7 (P2a): was workforceSkill (spend-driven readout) — re-pointed
            // to the R&D root, matching the weighted targets above.
            category: "economic" as const,
            metricId: "rdIntensity",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [387, 277, 194, 133, 83, 33, 0]
    ),
  },

  // uk_regional_education — Regional Education Services Act (Regional)
  {
    _id: "uk_regional_education",
    countryScope: "uk",
    name: "Regional Education Services Act",
    description: "Local school funding, early years provision, and educational support services",
    policyDomain: "education",
    subCategory: "Regional education",
    budgetCategory: "education",
    nationalOnly: false,
    allowedScope: "state",
    // §4.7 (P2a): regional education FUNDING — its spend drives gcseAttainment/
    // literacyRate via the spending channel, so those direct targets
    // double-counted. Primary re-pointed to the educationSpending root (was a
    // 0.3 secondary); childPoverty relief (early-years provision) is a distinct
    // non-spending-channel mechanism and stays.
    effectTarget: { metricCategoryId: "education", metricId: "educationSpending", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "education", metric: "educationSpending" }, [
      { category: "social", metric: "childPoverty", weight: -0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.2 },
    ]),
    positions: standardUKCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_education",
        [
          { name: "Maximum Regional Education Act", stance: "left", effectDirection: 1 },
          { name: "Regional Education Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Education Support Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Education Services Act", stance: "center", effectDirection: 0 },
          { name: "Education Services Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Regional Education Act", stance: "right", effectDirection: -1 },
          { name: "Regional Education Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund universal free nursery places, guarantee free school meals for all pupils, and provide wraparound childcare and holiday programmes in every school",
          "Significantly expand early years places, extend free school meals eligibility, and fund after-school programmes across the region",
          "Modestly increase regional education spending on nursery provision, school meals expansion, and educational psychologist services",
          "A moderate level of regional education funding covering statutory early years provision, school support services, and SEND coordination",
          "Reduce regional education spending through consolidated services, tighter nursery eligibility, and means-tested school meals",
          "Cut regional education services to statutory minimums, eliminating discretionary early years and school support programmes",
          "Eliminate all council-funded education services beyond statutory obligations, leaving provision to schools and private nurseries",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [553, 415, 304, 221, 138, 55, 0]
    ),
  },

  // uk_regional_skills — Regional Skills and Further Education Act (Regional)
  {
    _id: "uk_regional_skills",
    countryScope: "uk",
    name: "Regional Skills and Further Education Act",
    description: "FE colleges, apprenticeships, adult education, and skills training",
    policyDomain: "education",
    subCategory: "Regional skills",
    budgetCategory: "education",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "education", metricId: "apprenticeshipRate", scope: "state" },
    // §4.7 (P2a): workforceSkill secondary dropped — apprenticeshipRate (the
    // primary) is now an ENGINE input to workforceSkill, so the secondary
    // double-counted the same lever via the root pass-through.
    effectTargetsWeighted: weightedTargets(
      { category: "education", metric: "apprenticeshipRate" },
      [
        // Skills/training (left) lowers unemployment: positive weight.
        { category: "economic", metric: "unemploymentRate", weight: 0.4 },
        { category: "social", metric: "socialMobility", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.2 },
      ]
    ),
    positions: standardUKCommitteePositions("Education"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_skills",
        [
          { name: "Universal Skills Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Skills and Apprenticeship Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Skills Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Skills Services Act", stance: "center", effectDirection: 0 },
          { name: "Skills Market Reform Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Skills Provision Act", stance: "right", effectDirection: -1 },
          { name: "Skills Funding Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee free lifelong learning for all adults, massively expand FE college capacity, and fund apprenticeships in every sector",
          "Significantly expand regional apprenticeship programmes, increase FE college funding, and create adult retraining centres",
          "Modestly increase FE college funding, expand apprenticeship places, and fund targeted adult education in high-demand sectors",
          "A moderate level of regional skills funding supporting FE colleges, apprenticeship coordination, and basic adult education",
          "Reduce council skills spending, incentivise employer-led training through local partnerships, and consolidate FE provision",
          "Cut regional skills funding to essential apprenticeship coordination only, leaving adult education to private providers",
          "Eliminate all council-funded skills and further education services, leaving training entirely to employers and private colleges",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [332, 249, 166, 111, 66, 28, 0]
    ),
  },

  // ── B3. Economic ──────────────────────────────────────────────────────

  // uk_fiscal_spending — Fiscal Spending and Economic Policy Act (National)
  {
    _id: "uk_fiscal_spending",
    countryScope: "uk",
    name: "Fiscal Spending and Economic Policy Act",
    description: "Overall government discretionary spending and fiscal stance",
    policyDomain: "economic",
    subCategory: "Fiscal / austerity",
    budgetCategory: "economic",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "gdpGrowth", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "gdpGrowth" }, [
      // Fiscal spending (left) lowers unemployment and poverty: positive weights
      // (matches us_federal_spending_stimulus). budgetBalance stays negative.
      { category: "economic", metric: "unemploymentRate", weight: 0.5 },
      { category: "economic", metric: "povertyRate", weight: 0.3 },
      { category: "governance", metric: "budgetBalance", weight: -0.6 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Treasury"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_fiscal_spending",
        [
          { name: "New Deal for Britain Act", stance: "left", effectDirection: 1 },
          { name: "Economic Stimulus and Jobs Act", stance: "left", effectDirection: 1 },
          { name: "Targeted Investment Act", stance: "left", effectDirection: 1 },
          { name: "Fiscal Balance Act", stance: "center", effectDirection: 0 },
          { name: "Spending Discipline Act", stance: "right", effectDirection: -1 },
          { name: "Austerity and Deficit Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Government Spending Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massive government spending programme funding jobs, infrastructure, and direct economic stimulus across all sectors",
          "Significantly increase Treasury discretionary spending to boost employment, wages, and public investment",
          "Modestly increase government spending focused on shovel-ready projects and workforce programmes",
          "A moderate level of government discretionary spending balancing investment needs with deficit management",
          "Reduce government discretionary spending through department consolidation and programme elimination",
          "Dramatically cut government spending to reduce the deficit and shrink the size of the state",
          "Eliminate nearly all discretionary spending, funding only essential functions of the state",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "gdpGrowth",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [1624, 1299, 1029, 812, 541, 271, 0]
    ),
  },

  // uk_local_government_funding — Local Government Funding Act (National)
  {
    _id: "uk_local_government_funding",
    countryScope: "uk",
    name: "Local Government Funding Act",
    description:
      "Westminster grant to regional councils setting the central government funding envelope",
    policyDomain: "economic",
    subCategory: "Local government funding",
    budgetCategory: "economic",
    isGrant: true,
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "budgetBalance", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "budgetBalance" }, [
      { category: "governance", metric: "devolutionSatisfaction", weight: 0.5 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Levelling Up"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_local_government_funding",
        [
          { name: "Maximum Devolution Funding Act", stance: "left", effectDirection: 1 },
          { name: "Local Government Investment Act", stance: "left", effectDirection: 1 },
          { name: "Council Funding Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Local Government Settlement Act", stance: "center", effectDirection: 0 },
          { name: "Council Self-Reliance Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Central Funding Act", stance: "right", effectDirection: -1 },
          { name: "Local Government Funding Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively increase central government grants to local authorities, providing the most generous funding settlement in modern British history",
          "Significantly increase the local government funding settlement, enabling councils to expand services and hire more staff",
          "Modestly increase central grants to councils, reducing pressure on council tax rises and preventing service cuts",
          "A moderate level of central government funding sustaining standard council service levels and statutory obligations",
          "Reduce central government grants, requiring councils to raise more revenue locally through council tax and business rates",
          "Dramatically cut the local government settlement, forcing councils to make deep service cuts or raise local taxes significantly",
          "Eliminate central government grants to councils entirely, leaving local authorities to fund themselves through local taxation alone",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
      })),
      [1895, 1516, 1191, 920, 650, 325, 0]
    ),
  },

  // uk_regional_economic_development — Regional Economic Development Act (Regional)
  {
    _id: "uk_regional_economic_development",
    countryScope: "uk",
    name: "Regional Economic Development Act",
    description:
      "Regional council spending on business support, enterprise zones, and regeneration",
    policyDomain: "economic",
    subCategory: "Regional economic development",
    budgetCategory: "economic",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "smallBusinessFormation" },
      [
        // Regional economic-development spending (left) creates jobs → LOWERS
        // unemployment: positive weight (matches jp_regional_economic_development).
        { category: "economic", metric: "unemploymentRate", weight: 0.4 },
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "economic", metric: "propertyValueIndex", weight: 0.3 },
        { category: "economic", metric: "commercialValueIndex", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Economy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_economic_development",
        [
          { name: "Regional New Deal Act", stance: "left", effectDirection: 1 },
          { name: "Regional Economic Stimulus Act", stance: "left", effectDirection: 1 },
          { name: "Regional Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Economic Services Act", stance: "center", effectDirection: 0 },
          { name: "Market-Led Development Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Economic Development Act", stance: "right", effectDirection: -1 },
          { name: "Economic Development Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massive regional spending on job creation, public works, business grants, and comprehensive economic regeneration programmes",
          "Significantly increase council spending on business support, enterprise grants, and local infrastructure investment",
          "Modestly increase economic development spending on business advice services, small grants, and targeted regeneration",
          "A moderate level of council economic development spending supporting business liaison, planning services, and inward investment",
          "Reduce council economic development spending, relying on private sector investment and market forces to drive growth",
          "Cut regional economic spending to essential planning services only, eliminating business grants and regeneration programmes",
          "Eliminate all council-funded economic development, leaving business support and investment promotion to the private sector",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "smallBusinessFormation",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [217, 162, 108, 68, 41, 16, 0]
    ),
  },

  // ── B4. Infrastructure ────────────────────────────────────────────────

  // uk_transport_rail — National Transport and Rail Act (National)
  {
    _id: "uk_transport_rail",
    countryScope: "uk",
    name: "National Transport and Rail Act",
    description: "National rail infrastructure, HS2, motorways, and strategic transport investment",
    policyDomain: "infrastructure",
    subCategory: "Transport / rail",
    budgetCategory: "infrastructure",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "publicTransit",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "publicTransit" },
      [
        { category: "infrastructure", metric: "roadCondition", weight: 0.5 },
        { category: "economic", metric: "gdpGrowth", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    demographicEffects: [{ groupId: "urban", direction: 0.01 }],
    positions: standardUKCommitteePositions("Transport"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_transport_rail",
        [
          { name: "National Transit Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Rail and Motorway Modernisation Act", stance: "left", effectDirection: 1 },
          { name: "Transport Investment Act", stance: "left", effectDirection: 1 },
          { name: "National Transport Funding Act", stance: "center", effectDirection: 0 },
          { name: "Transport Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Transport Privatisation Act", stance: "right", effectDirection: -1 },
          { name: "National Transport Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand high-speed rail beyond HS2, renationalise all railways, and fund free public transport for under-25s and pensioners",
          "Significantly increase transport funding, complete HS2 in full, electrify regional rail lines, and rebuild aging motorway junctions",
          "Modestly increase Network Rail funding, continue HS2 construction, and fund targeted improvements to congested motorway corridors",
          "A moderate level of transport investment sustaining rail maintenance, motorway upkeep, and committed infrastructure projects",
          "Reduce national transport spending, scale back HS2 scope, and encourage private investment through rail franchise competition",
          "Dramatically cut government transport spending, fully privatise rail operations, and fund roads through tolls and user charges",
          "Eliminate government transport investment entirely, leaving rail and road infrastructure to private operators and toll-funded maintenance",
        ][i],
      })),
      [736, 552, 398, 276, 169, 77, 0]
    ),
  },

  // uk_energy_grid — Energy and Grid Infrastructure Act (National)
  {
    _id: "uk_energy_grid",
    countryScope: "uk",
    name: "Energy and Grid Infrastructure Act",
    description:
      "National energy grid, power generation, broadband infrastructure, and energy security",
    policyDomain: "infrastructure",
    subCategory: "Energy / grid",
    budgetCategory: "infrastructure",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "powerGridReliability",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "powerGridReliability" },
      [
        { category: "infrastructure", metric: "broadbandAccess", weight: 0.5 },
        { category: "environment", metric: "renewableEnergy", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_energy_grid",
        [
          { name: "Universal Energy and Broadband Act", stance: "left", effectDirection: 1 },
          { name: "Energy and Digital Infrastructure Act", stance: "left", effectDirection: 1 },
          { name: "Connected Britain Act", stance: "left", effectDirection: 1 },
          { name: "Energy Infrastructure Services Act", stance: "center", effectDirection: 0 },
          { name: "Market-Driven Energy Act", stance: "right", effectDirection: -1 },
          { name: "Energy Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Energy Infrastructure Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Build a publicly owned national energy company, guarantee universal full-fibre broadband, and fully modernise the national grid for renewables",
          "Significantly expand grid capacity for renewables, fund new nuclear power stations, and subsidise rural broadband rollout",
          "Modestly increase energy grid investment, fund targeted broadband expansion for underserved areas, and support grid upgrades for heat pumps",
          "A moderate level of energy and broadband funding supporting ongoing grid maintenance, generation capacity, and broadband deployment",
          "Reduce government energy investment, relying on private energy companies and market competition to fund grid upgrades and broadband",
          "Dramatically cut government energy programmes, deregulate utility markets, and let private investment drive all infrastructure decisions",
          "Eliminate government energy and broadband programmes, leaving all infrastructure investment to private companies",
        ][i],
      })),
      [429, 322, 230, 153, 92, 37, 0]
    ),
  },

  // uk_regional_transport — Regional Transport Act (Regional)
  {
    _id: "uk_regional_transport",
    countryScope: "uk",
    name: "Regional Transport Act",
    description: "Local roads, bus services, cycling infrastructure, and local transport planning",
    policyDomain: "infrastructure",
    subCategory: "Regional transport",
    budgetCategory: "infrastructure",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "infrastructure", metricId: "roadCondition", scope: "state" },
    effectTargetsWeighted: weightedTargets(
      { category: "infrastructure", metric: "roadCondition" },
      [
        { category: "infrastructure", metric: "publicTransit", weight: 0.5 },
        { category: "economic", metric: "propertyValueIndex", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Transport"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_transport",
        [
          { name: "Regional Transit Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Regional Transport Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Local Transport Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Transport Services Act", stance: "center", effectDirection: 0 },
          { name: "Transport Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Regional Transport Act", stance: "right", effectDirection: -1 },
          { name: "Regional Transport Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand local bus networks, build comprehensive cycling infrastructure, and fund free local public transport for all residents",
          "Significantly increase council transport budgets, subsidise bus routes, repair local roads, and expand park-and-ride facilities",
          "Modestly increase regional transport spending on road resurfacing, bus shelter upgrades, and cycling lane expansion",
          "A moderate level of council transport funding covering road maintenance, bus subsidies, and basic cycling provision",
          "Reduce council transport budgets through prioritisation, deferred road maintenance, and reduced bus subsidies",
          "Cut regional transport spending to emergency road repairs only, eliminating bus subsidies and cycling programmes",
          "Eliminate council transport spending, leaving roads to toll-funded maintenance and bus services to fully commercial operators",
        ][i],
      })),
      [307, 230, 169, 123, 77, 31, 0]
    ),
  },

  // uk_regional_utilities — Regional Utilities and Services Act (Regional)
  {
    _id: "uk_regional_utilities",
    countryScope: "uk",
    name: "Regional Utilities and Services Act",
    description: "Waste collection, recycling, street lighting, parks, and leisure centres",
    policyDomain: "infrastructure",
    subCategory: "Regional utilities",
    budgetCategory: "infrastructure",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "infrastructure", metricId: "waterQuality", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "infrastructure", metric: "waterQuality" }, [
      { category: "environment", metric: "recyclingRate", weight: 0.5 },
      { category: "social", metric: "socialCohesion", weight: 0.2 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_utilities",
        [
          { name: "Comprehensive Regional Services Act", stance: "left", effectDirection: 1 },
          { name: "Regional Services Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Local Services Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Utilities Services Act", stance: "center", effectDirection: 0 },
          { name: "Services Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Council Services Act", stance: "right", effectDirection: -1 },
          { name: "Council Services Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee weekly waste collection, fund leisure centres in every neighbourhood, maintain all parks to the highest standard, and expand recycling to near-zero waste",
          "Significantly expand council services with enhanced waste collection, new leisure facilities, and comprehensive parks maintenance",
          "Modestly increase council spending on waste services, park improvements, and leisure facility upgrades",
          "A moderate level of council service spending covering regular waste collection, parks maintenance, street lighting, and leisure provision",
          "Reduce council service costs through fortnightly waste collection, outsourced leisure management, and reduced parks budgets",
          "Cut council services to statutory waste collection only, closing leisure centres and reducing parks to basic safety maintenance",
          "Eliminate council-run services entirely, outsourcing waste, leisure, and parks to private contractors and community trusts",
        ][i],
      })),
      [245, 184, 138, 107, 67, 31, 0]
    ),
  },

  // ── B5. Environment ───────────────────────────────────────────────────

  // uk_climate_net_zero — Climate and Net Zero Act (National)
  {
    _id: "uk_climate_net_zero",
    countryScope: "uk",
    name: "Climate and Net Zero Act",
    description: "UK net zero targets, carbon reduction, and the fossil fuel transition",
    policyDomain: "environment",
    subCategory: "Net zero / carbon",
    budgetCategory: "environment",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "carbonEmissions",
      scope: "national",
    },
    // §4.7 (P3c): KEEP-LISTED regulatory mechanism (net-zero mandates) on its
    // carbon primary; the airQuality secondary was dropped — air follows carbon
    // through the engine (pass-through double-count).
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "carbonEmissions" }, [
      { category: "environment", metric: "renewableEnergy", weight: 0.6 },
      { category: "environment", metric: "climateResilience", weight: 0.5 },
      { category: "economic", metric: "gdpGrowth", weight: -0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_climate_net_zero",
        [
          { name: "Green New Deal for Britain Act", stance: "left", effectDirection: 1 },
          { name: "Accelerated Net Zero Act", stance: "left", effectDirection: 1 },
          { name: "Climate Investment Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Climate Policy Act", stance: "center", effectDirection: 0 },
          { name: "Pragmatic Climate Act", stance: "right", effectDirection: -1 },
          { name: "Net Zero Rollback Act", stance: "right", effectDirection: -1 },
          { name: "Climate Policy Abolition Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate net zero within fifteen years, ban all fossil fuel vehicles, retrofit every home in Britain, and create a national green jobs programme",
          "Bring forward the net zero target by a decade, impose a carbon tax on heavy industry, and massively subsidise heat pump and solar installation",
          "Modestly accelerate decarbonisation through expanded renewable subsidies, EV charging infrastructure, and home insulation grants",
          "A moderate approach meeting the existing net zero target through a mix of regulation, incentives, and market mechanisms",
          "Delay non-essential net zero milestones, reduce green levies on energy bills, and prioritise energy affordability over speed of transition",
          "Scrap most net zero commitments, end renewable subsidies, and allow unrestricted domestic fossil fuel production",
          "Repeal the Climate Change Act, withdraw from international climate agreements, and eliminate all decarbonisation programmes",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
        // carbonEmissions: higher = worse, left reduces it
      })),
      [531, 376, 243, 155, 77, 22, 0]
    ),
  },

  // uk_north_sea_energy — North Sea Energy and Resources Act (National)
  {
    _id: "uk_north_sea_energy",
    countryScope: "uk",
    name: "North Sea Energy and Resources Act",
    description: "North Sea oil and gas licensing, offshore wind, and the energy transition",
    policyDomain: "environment",
    subCategory: "Fossil fuels / energy security",
    budgetCategory: "environment",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "environment",
      metricId: "renewableEnergy",
      scope: "national",
    },
    // §4.7 (P3c): the carbonEmissions secondary was dropped — licensing acts on
    // the renewables root and the engine derives carbon from it.
    // Power-grid reliability is intentionally NOT a target here: this is an energy-SOURCE
    // licensing bill (oil/gas vs offshore wind), not grid investment. Both sides have a
    // credible grid-reliability case — dispatchable North Sea gas firms the grid, while
    // intermittent offshore wind can stress it without storage — so a directional grid
    // effect isn't defensible either way. (Grid-investment bills like uk_energy_grid /
    // the broadband-infrastructure acts keep powerGridReliability, where it IS directional.)
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "renewableEnergy" }, [
      // NEGATIVE weight: North Sea oil & gas is a major GDP/revenue driver, so the
      // pro-extraction (right) options LIFT near-term GDP while banning licensing (left)
      // costs it — the opposite of the default left=growth convention for this bill.
      { category: "economic", metric: "gdpGrowth", weight: -0.3 },
      { category: "environment", metric: "protectedLand", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Energy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_north_sea_energy",
        [
          { name: "North Sea Conservation Act", stance: "left", effectDirection: 1 },
          { name: "Managed Transition Act", stance: "left", effectDirection: 1 },
          { name: "Green North Sea Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Energy Resources Act", stance: "center", effectDirection: 0 },
          { name: "Energy Security Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Extraction Act", stance: "right", effectDirection: -1 },
          { name: "Unrestricted Resource Exploitation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Ban all new oil and gas licensing, mandate decommissioning of existing platforms, and convert the entire North Sea to offshore wind and marine energy",
          "Phase out North Sea oil and gas licensing over ten years, invest heavily in offshore wind, and fund retraining for fossil fuel workers",
          "Modestly restrict new licensing, expand offshore wind investment, and require operators to fund environmental remediation",
          "A moderate approach allowing continued licensing alongside offshore wind expansion, balancing energy security with environmental goals",
          "Prioritise North Sea oil and gas production for energy security, streamline licensing, and reduce environmental restrictions on operators",
          "Aggressively expand North Sea licensing, offer tax breaks to operators, and prioritise fossil fuel extraction over renewables",
          "Eliminate all environmental restrictions on North Sea extraction, end the windfall tax, and open all waters to drilling with no climate conditions",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [177, 133, 88, 55, 33, 13, 0]
    ),
  },

  // uk_regional_environment — Regional Environment Act (Regional)
  {
    _id: "uk_regional_environment",
    countryScope: "uk",
    name: "Regional Environment Act",
    description: "Local environmental services, air quality, green spaces, and flood defence",
    policyDomain: "environment",
    subCategory: "Regional environment",
    budgetCategory: "environment",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "environment", metricId: "airQuality", scope: "state" },
    // §4.7 (P3c): KEEP-LISTED sub-allocation (local services → air quality); the
    // direct floodRisk secondary was dropped — flood defence acts through the
    // climateResilience root this law already targets (engine derives floodRisk).
    effectTargetsWeighted: weightedTargets({ category: "environment", metric: "airQuality" }, [
      { category: "environment", metric: "recyclingRate", weight: 0.5 },
      { category: "environment", metric: "climateResilience", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Environment"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_environment",
        [
          { name: "Regional Green Mandate Act", stance: "left", effectDirection: 1 },
          { name: "Regional Environmental Leadership Act", stance: "left", effectDirection: 1 },
          { name: "Regional Environmental Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Environmental Services Act", stance: "center", effectDirection: 0 },
          { name: "Environmental Streamlining Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Regional Environmental Act", stance: "right", effectDirection: -1 },
          { name: "Regional Environmental Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate regional carbon neutrality, expand green spaces in every neighbourhood, fund comprehensive flood defences, and achieve zero-waste recycling targets",
          "Significantly expand council environmental spending on air quality monitoring, tree planting, flood prevention, and enhanced recycling services",
          "Modestly increase council environmental spending on clean air zones, park expansion, and improved recycling collection",
          "A moderate level of council environmental spending covering statutory air quality duties, basic flood maintenance, and standard recycling provision",
          "Reduce council environmental spending, focusing only on statutory obligations and essential flood risk management",
          "Cut council environmental services to legally required air quality reporting and emergency flood response only",
          "Eliminate all discretionary council environmental spending, leaving environmental protection to national agencies and private action",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [133, 100, 66, 40, 22, 9, 0]
    ),
  },

  // ── B6. Law & Justice ─────────────────────────────────────────────────

  // uk_policing_crime — Policing and Crime Act (National)
  {
    _id: "uk_policing_crime",
    countryScope: "uk",
    name: "Policing and Crime Act",
    description: "National policing policy, Home Office funding, and sentencing guidelines",
    policyDomain: "publicSafety",
    subCategory: "Policing / crime",
    budgetCategory: "publicSafety",
    nationalOnly: true,
    // §4.7 (P3b): pure Home Office FUNDING law — police capacity / crime /
    // confidence are engine-derived from the publicSafety spending channel, so
    // direct readout targets double-counted. A mild community-policing cohesion
    // mechanism is all that remains outside the channel.
    effectTarget: { metricCategoryId: "social", metricId: "socialCohesion", scope: "national" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.3 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_policing_crime",
        [
          { name: "Transformative Justice Act", stance: "left", effectDirection: 1 },
          { name: "Justice Reinvestment Act", stance: "left", effectDirection: 1 },
          { name: "Community Policing and Reform Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Policing Act", stance: "center", effectDirection: 0 },
          { name: "Law and Order Reinforcement Act", stance: "right", effectDirection: -1 },
          { name: "Tough on Crime Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Enforcement Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Defund national policing agencies, redirect spending to community services, restorative justice, and social workers as first responders",
          "Significantly reduce Home Office policing budgets, end stop-and-search powers, and fund diversion programmes for young offenders",
          "Modestly reform policing standards, increase accountability through enhanced IOPC powers, and fund neighbourhood policing teams",
          "A moderate level of Home Office policing funding supporting investigation, counter-terrorism, and community policing grants",
          "Increase national policing budgets, expand stop-and-search powers, and strengthen sentencing for violent and drug-related offences",
          "Dramatically expand policing powers, impose mandatory minimum sentences, and increase funding for the National Crime Agency",
          "Massively expand police powers, militarise border and drug enforcement, and impose the harshest sentencing guidelines in British history",
        ][i],
        // #887: direct crimeRate stance effect so the bill visibly moves crime.
        // Enforcement (right, index 6) lowers crime; reform (left) raises it
        // short-term. On crime's native per-100k scale. The police→crime
        // spending channel (publicSafety.ts) is trimmed to avoid double-count.
      })),
      [38, 64, 89, 115, 153, 216, 306]
    ),
  },

  // uk_prison_rehabilitation — Prison and Rehabilitation Act (National)
  {
    _id: "uk_prison_rehabilitation",
    countryScope: "uk",
    name: "Prison and Rehabilitation Act",
    description: "UK prison system, overcrowding, rehabilitation, and sentencing reform",
    policyDomain: "publicSafety",
    subCategory: "Prison / rehabilitation",
    budgetCategory: "publicSafety",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "incarcerationRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "incarcerationRate" },
      [
        { category: "publicSafety", metric: "recidivismRate", weight: 0.6 },
        { category: "publicSafety", metric: "crimeRate", weight: 0.3 },
        { category: "social", metric: "socialMobility", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Justice"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_prison_rehabilitation",
        [
          { name: "Abolish Mass Incarceration Act", stance: "left", effectDirection: 1 },
          { name: "Comprehensive Rehabilitation Act", stance: "left", effectDirection: 1 },
          { name: "Second Chance Act", stance: "left", effectDirection: 1 },
          { name: "Corrections Funding Act", stance: "center", effectDirection: 0 },
          { name: "Prison Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Incarceration Expansion Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Incarceration Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Close prisons, replace incarceration with community supervision, restorative justice, and rehabilitation centres across the country",
          "Dramatically reduce prison populations through early release, ban private prisons, and fund education and job training for inmates",
          "Expand reentry programmes, increase prison education funding, and reduce sentences for nonviolent offenders",
          "A moderate level of prison funding balancing incarceration with rehabilitation and reentry services",
          "Reduce prison costs through expanded private prison contracts, work programmes, and streamlined administration",
          "Build new prisons, expand capacity, and lengthen sentences for repeat offenders and violent criminals",
          "Massively expand the prison system, impose life sentences for violent felons, and eliminate early release programmes",
        ][i],
      })),
      [128, 102, 77, 56, 38, 89, 153]
    ),
  },

  // uk_regional_policing — Regional Policing Act (Regional)
  {
    _id: "uk_regional_policing",
    countryScope: "uk",
    name: "Regional Policing Act",
    description: "Regional council funding for local police forces and community safety",
    policyDomain: "publicSafety",
    subCategory: "Regional policing",
    budgetCategory: "publicSafety",
    nationalOnly: false,
    allowedScope: "state",
    // §4.7 (P3b): pure council FUNDING law — police capacity / crime / ASB /
    // confidence are engine-derived from the publicSafety spending channel, so
    // direct readout targets double-counted. A mild community-safety cohesion
    // mechanism is all that remains outside the channel.
    effectTarget: { metricCategoryId: "social", metricId: "socialCohesion", scope: "state" },
    effectTargetsWeighted: [
      { metricCategoryId: "social", metricId: "socialCohesion", weight: 0.2 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.15 },
    ],
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_policing",
        [
          { name: "Community Safety Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Police Accountability and Reform Act", stance: "left", effectDirection: 1 },
          { name: "Community Policing Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Policing Act", stance: "center", effectDirection: 0 },
          { name: "Enhanced Policing Act", stance: "right", effectDirection: -1 },
          { name: "Aggressive Enforcement Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Regional Policing Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Replace traditional policing with community responders, youth workers, and restorative justice programmes funded by the council",
          "Significantly reform local policing with mandatory body cameras, civilian oversight panels, and expanded mental health crisis teams",
          "Modestly increase council policing budgets for neighbourhood officers, de-escalation training, and community engagement programmes",
          "A moderate level of council policing funding supporting local police forces, community safety officers, and basic CCTV provision",
          "Increase council policing budgets, expand CCTV networks, and fund additional officers for anti-social behaviour enforcement",
          "Dramatically expand local police presence, fund specialised drug and gang units, and invest in surveillance technology",
          "Massively expand local law enforcement with advanced surveillance, zero-tolerance enforcement, and maximum officer deployment",
        ][i],
        // #887: direct crimeRate stance effect (state scope) so local policing
        // visibly moves local crime. Enforcement (right) lowers it, reform
        // (left) raises it short-term. Native per-100k scale; paired with the
        // trimmed police→crime spending channel to avoid double-count.
      })),
      [89, 128, 166, 204, 255, 319, 408]
    ),
  },

  // uk_regional_justice — Regional Justice and Community Safety Act (Regional)
  {
    _id: "uk_regional_justice",
    countryScope: "uk",
    name: "Regional Justice and Community Safety Act",
    description:
      "Youth offending teams, domestic violence services, and community safety partnerships",
    policyDomain: "publicSafety",
    subCategory: "Regional justice",
    budgetCategory: "publicSafety",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "publicSafety", metricId: "recidivismRate", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "publicSafety", metric: "recidivismRate" }, [
      { category: "publicSafety", metric: "antiSocialBehaviourRate", weight: 0.4 },
      { category: "social", metric: "socialCohesion", weight: 0.3 },
      { category: "publicSafety", metric: "publicSafetyConfidence", weight: 0.3 },
      { category: "economic", metric: "economicFreedom", weight: -0.15 },
    ]),
    positions: standardUKCommitteePositions("Justice"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_justice",
        [
          { name: "Comprehensive Community Justice Act", stance: "left", effectDirection: 1 },
          { name: "Community Justice Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Justice Services Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Justice Services Act", stance: "center", effectDirection: 0 },
          { name: "Justice Services Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Justice Services Act", stance: "right", effectDirection: -1 },
          { name: "Justice Services Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund restorative justice centres in every neighbourhood, guarantee domestic violence refuge places, and provide youth mentoring for all at-risk young people",
          "Significantly expand youth offending services, domestic violence support, and community mediation programmes across the region",
          "Modestly increase council justice spending on youth diversion programmes, victim support services, and community safety partnerships",
          "A moderate level of council justice funding supporting youth offending teams, domestic violence referrals, and community safety coordination",
          "Reduce council justice spending through consolidated services, volunteer-led programmes, and partnerships with charities",
          "Cut council justice services to statutory youth offending obligations only, leaving victim support to national charities",
          "Eliminate all discretionary council justice spending, leaving community safety and victim support entirely to national agencies and charities",
        ][i],
        // recidivismRate: higher = worse, left reduces it
      })),
      [102, 77, 51, 33, 18, 8, 0]
    ),
  },

  // ── B7. Defence ───────────────────────────────────────────────────────

  // uk_defence_spending — Defence Spending Act (National)
  {
    _id: "uk_defence_spending",
    countryScope: "uk",
    name: "Defence Spending Act",
    description:
      "Overall MoD budget, armed forces, equipment procurement, and alliance commitments",
    policyDomain: "defense",
    subCategory: "Defence spending",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "economic", metric: "unemploymentRate", weight: -0.2 },
      { category: "governance", metric: "budgetBalance", weight: -0.4 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.1 },
    ]),
    demographicEffects: [{ groupId: "veterans", direction: 0.01 }],
    positions: standardUKCommitteePositions("Defence"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_defence_spending",
        [
          { name: "Peace Dividend Act", stance: "left", effectDirection: -1 },
          { name: "Military Drawdown Act", stance: "left", effectDirection: -1 },
          { name: "Responsible Defence Act", stance: "left", effectDirection: -1 },
          { name: "National Defence Act", stance: "center", effectDirection: 0 },
          { name: "Military Readiness Act", stance: "right", effectDirection: 1 },
          { name: "Peace Through Strength Act", stance: "right", effectDirection: 1 },
          { name: "Maximum Military Capability Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically slash the defence budget, withdraw from overseas deployments, reduce international alliance commitments, and redirect military spending to domestic programmes",
          "Significantly reduce defence spending, end foreign deployments, and shrink the armed forces to a purely defensive posture",
          "Modestly reduce defence spending by cutting procurement waste, consolidating bases, and cancelling underperforming equipment programmes",
          "A moderate level of defence spending sustaining force readiness, equipment modernisation, and international alliance commitments",
          "Increase defence spending to modernise the Royal Navy, expand the RAF, and strengthen missile defence systems",
          "Dramatically expand the military with new aircraft carriers, increased troop levels, and expanded global basing alongside allies",
          "The largest peacetime military buildup in British history, ensuring full-spectrum force projection capability across every domain",
        ][i],
      })),
      [194, 387, 581, 775, 1017, 1307, 1646]
    ),
  },

  // uk_trident_defence — Trident and Nuclear Deterrent Act (National)
  {
    _id: "uk_trident_defence",
    countryScope: "uk",
    name: "Trident and Nuclear Deterrent Act",
    description: "UK independent nuclear deterrent and Trident submarine programme",
    policyDomain: "defense",
    subCategory: "Nuclear deterrent",
    budgetCategory: "defense",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "governance", metric: "budgetBalance", weight: -0.3 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.1 },
    ]),
    positions: standardUKCommitteePositions("Defence"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_trident_defence",
        [
          { name: "Nuclear Disarmament Act", stance: "left", effectDirection: -1 },
          { name: "Trident Phase-Out Act", stance: "left", effectDirection: -1 },
          { name: "Reduced Deterrent Act", stance: "left", effectDirection: -1 },
          { name: "Continuous At-Sea Deterrent Act", stance: "center", effectDirection: 0 },
          { name: "Trident Renewal Act", stance: "right", effectDirection: 1 },
          { name: "Enhanced Nuclear Capability Act", stance: "right", effectDirection: 1 },
          { name: "Maximum Nuclear Deterrent Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Scrap Trident entirely, decommission all nuclear warheads, and commit to full unilateral nuclear disarmament",
          "Cancel the Trident replacement programme, maintain existing submarines until end of life, and pursue multilateral disarmament negotiations",
          "Scale back the nuclear deterrent to a minimum credible capability with fewer submarines and warheads",
          "A moderate level of nuclear spending sustaining continuous at-sea deterrence with the existing Trident system",
          "Fully fund the Trident replacement programme with new Dreadnought-class submarines and modernised warheads",
          "Expand the nuclear arsenal beyond existing levels, increase warhead stockpiles, and develop new delivery systems",
          "Massively expand Britain's nuclear capability with multiple delivery systems, expanded warhead production, and enhanced first-strike readiness",
        ][i],
      })),
      [0, 15, 29, 48, 73, 107, 145]
    ),
  },

  // ── B8. Foreign Policy ────────────────────────────────────────────────

  // uk_foreign_policy — Foreign Policy and International Aid Act (National)
  {
    _id: "uk_foreign_policy",
    countryScope: "uk",
    name: "Foreign Policy and International Aid Act",
    description: "FCDO budget, foreign aid, diplomatic missions, and international engagement",
    policyDomain: "foreign_policy",
    subCategory: "Foreign aid / diplomacy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "publicTrust", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "publicTrust" }, [
      { category: "governance", metric: "governmentTransparency", weight: 0.3 },
      { category: "social", metric: "socialCohesion", weight: 0.2 },
      { category: "governance", metric: "budgetBalance", weight: -0.3 },
    ]),
    demographicEffects: [{ groupId: "immigrants", direction: 0.01 }],
    positions: standardUKCommitteePositions("Foreign Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_foreign_policy",
        [
          { name: "Global Leadership and Aid Act", stance: "left", effectDirection: 1 },
          { name: "Diplomacy First Act", stance: "left", effectDirection: 1 },
          { name: "International Partnership Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Foreign Engagement Act", stance: "center", effectDirection: 0 },
          { name: "Britain First Diplomacy Act", stance: "right", effectDirection: -1 },
          { name: "Foreign Aid Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Isolationist Foreign Policy Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand foreign aid beyond the 0.7% target, triple FCDO staffing, and lead international development with generous funding commitments",
          "Significantly increase diplomatic staffing, restore the 0.7% aid target, and strengthen multilateral engagement and treaty commitments",
          "Modestly increase foreign aid and diplomatic funding, focusing on strategic partnerships and humanitarian assistance",
          "A moderate level of diplomatic and foreign aid spending supporting embassies, key alliances, and targeted development programmes",
          "Reduce foreign aid, close underperforming embassies, and condition remaining assistance on alignment with British interests",
          "Dramatically cut FCDO budgets, withdraw from international development commitments, and end most foreign assistance",
          "Eliminate foreign aid and diplomatic programmes, withdraw from international commitments, and end all overseas development spending",
        ][i],
        economic: ([-3, -2, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 3, 5] as const)[i],
      })),
      [741, 529, 370, 254, 159, 64, 0]
    ),
  },

  // ── B9. Welfare & Benefits ────────────────────────────────────────────

  // uk_universal_credit — Universal Credit and Welfare Reform Act (National)
  {
    _id: "uk_universal_credit",
    countryScope: "uk",
    name: "Universal Credit and Welfare Reform Act",
    description: "Universal Credit rates, conditionality, and the welfare benefits system",
    policyDomain: "social",
    subCategory: "Benefits / welfare",
    budgetCategory: "social",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "social", metricId: "childPoverty", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "childPoverty" }, [
      { category: "economic", metric: "povertyRate", weight: 0.6 },
      { category: "social", metric: "foodInsecurity", weight: 0.5 },
      { category: "social", metric: "homelessnessRate", weight: 0.4 },
      { category: "social", metric: "socialMobility", weight: 0.4 },
      { category: "social", metric: "incomeInequality", weight: 0.3 },
    ]),
    positions: standardUKCommitteePositions("Work & Pensions"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_universal_credit",
        [
          { name: "Universal Basic Income Act", stance: "left", effectDirection: 1 },
          { name: "Welfare Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Welfare Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Universal Credit Framework Act", stance: "center", effectDirection: 0 },
          { name: "Welfare Reform Act", stance: "right", effectDirection: -1 },
          { name: "Welfare Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Welfare Abolition Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Replace Universal Credit with a guaranteed basic income for every adult, eliminating means-testing and conditionality entirely",
          "Dramatically increase UC payment rates, remove the two-child limit and benefit cap, and end sanctions for jobseekers",
          "Modestly increase UC standard allowances, expand childcare support, and reduce the taper rate to let claimants keep more earnings",
          "A moderate level of welfare spending sustaining standard UC payment rates, conditionality requirements, and work incentives",
          "Tighten UC conditionality, reduce payment rates for childless adults, and increase work search requirements for claimants",
          "Dramatically cut UC payments, impose strict time limits on claims, and require community service for continued eligibility",
          "Eliminate Universal Credit entirely, leaving income support to private charity, family responsibility, and employer-provided benefits",
        ][i],
        // childPoverty: higher = worse, left reduces it
      })),
      [4457, 3438, 2674, 2038, 1401, 637, 0]
    ),
  },

  // uk_childcare — Childcare & Family Support Act (National)
  // §4.6 new-act gap #2: the UK seeds had social care + pensions but no childcare/
  // family-support law. Lever moves birthRate(+) AND laborParticipation(+) —
  // childcare lets parents work (positive labor weight, like the US act).
  {
    _id: "uk_childcare",
    countryScope: "uk",
    name: "Childcare & Family Support Act",
    description: "Free childcare hours, family support funding, and early-years provision",
    explanation:
      "Funds free childcare hours, early-years provision, and family support. Left positions favor universal subsidized childcare; right positions favor market provision and targeted support.",
    policyDomain: "social",
    subCategory: "Family policy",
    budgetCategory: "social",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "population", metricId: "birthRate", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "population", metric: "birthRate" }, [
      // Childcare keeps parents in work → laborParticipation up (§4.6); positive
      // weight, opposite sign to the pension acts.
      { category: "economic", metric: "laborParticipation", weight: 0.5 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
    ]),
    positions: standardUKCommitteePositions("Family"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_childcare",
        [
          { name: "Universal Childcare Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Childcare Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Family Support Act", stance: "left", effectDirection: 1 },
          { name: "Childcare Framework Act", stance: "center", effectDirection: 0 },
          { name: "Childcare Market Act", stance: "right", effectDirection: -1 },
          { name: "Childcare Subsidy Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Childcare Subsidy Repeal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee free full-time childcare from the end of parental leave and fund a large expansion of early-years places",
          "Substantially extend free childcare hours, raise the early-years pupil premium, and fund new nursery capacity",
          "Modestly expand free childcare hours and increase targeted support for working families",
          "A moderate framework of free part-time childcare hours and targeted family support",
          "Shift toward tax-free childcare accounts and market provision with reduced direct subsidy",
          "Reduce free childcare hours and family-support funding in favor of means-tested help",
          "Eliminate universal childcare subsidies, leaving provision to parents and the market",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "birthRate",
            // Dedicated stronger array (not shared TICK_RATES_7) so the lever survives
            // the 1/12 UK region division and visibly moves birthRate (see array doc).
            ratePerTurn: UK_BIRTH_RATE_TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [320, 240, 170, 100, 45, 15, 0]
    ),
  },

  // uk_state_pensions — State Pension Act (National)
  {
    _id: "uk_state_pensions",
    countryScope: "uk",
    name: "State Pension Act",
    description: "State Pension rates, triple lock guarantee, and pension age policy",
    policyDomain: "social",
    subCategory: "Pensions / triple lock",
    budgetCategory: "social",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "povertyRate", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "povertyRate" }, [
      { category: "social", metric: "socialMobility", weight: 0.3 },
      { category: "economic", metric: "costOfLiving", weight: -0.2 },
      { category: "governance", metric: "budgetBalance", weight: -0.4 },
      // Pension-age lever → older-worker laborParticipation → labor force L (§5.1).
      // Negative weight: expanding pensions / earlier retirement (left) lowers
      // participation; raising the age (right) lifts it. §4.6 aging-society wire.
      { category: "economic", metric: "laborParticipation", weight: -0.3 },
    ]),
    demographicEffects: [{ groupId: "retirees", direction: 0.02 }],
    positions: standardUKCommitteePositions("Work & Pensions"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_state_pensions",
        [
          { name: "Universal Pension Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Pension Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Pensioner Protection Act", stance: "left", effectDirection: 1 },
          { name: "State Pension Stability Act", stance: "center", effectDirection: 0 },
          { name: "Pension Reform Act", stance: "right", effectDirection: -1 },
          { name: "Pension Privatisation Act", stance: "right", effectDirection: -1 },
          { name: "State Pension Abolition Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically increase the State Pension, lower the pension age, and extend pension credit to guarantee no pensioner lives in poverty",
          "Significantly raise State Pension rates above the triple lock, expand pension credit eligibility, and freeze the pension age",
          "Modestly increase State Pension payments through enhanced triple lock protections and targeted supplements for the poorest pensioners",
          "A moderate level of State Pension spending sustaining the triple lock guarantee and the established pension age trajectory",
          "Means-test the State Pension for wealthy retirees, raise the pension age, and encourage private pension saving through auto-enrolment",
          "Dramatically reduce the State Pension, accelerate pension age increases, and shift retirement provision to private workplace pensions",
          "Eliminate the State Pension entirely, leaving retirement income to private pensions, personal savings, and individual responsibility",
        ][i],
        // povertyRate: higher = worse, left reduces it
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "povertyRate",
            ratePerTurn: TICK_RATES_7_INV[i] ?? 0,
          },
        ],
      })),
      [3820, 3056, 2420, 1910, 1401, 637, 0]
    ),
  },

  // uk_regional_housing_support — Regional Housing and Homelessness Act (Regional)
  {
    _id: "uk_regional_housing_support",
    countryScope: "uk",
    name: "Regional Housing and Homelessness Act",
    description: "Council spending on social housing, homelessness services, and housing support",
    policyDomain: "social",
    subCategory: "Regional housing support",
    budgetCategory: "social",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "social", metricId: "homelessnessRate", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "homelessnessRate" }, [
      { category: "social", metric: "roughSleeping", weight: 0.7 },
      { category: "social", metric: "childPoverty", weight: 0.3 },
      { category: "social", metric: "housingAffordability", weight: 0.3 },
    ]),
    positions: standardUKCommitteePositions("Housing"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_housing_support",
        [
          { name: "Regional Housing Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Social Housing Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Housing Support Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Housing Services Act", stance: "center", effectDirection: 0 },
          { name: "Housing Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Housing Support Act", stance: "right", effectDirection: -1 },
          { name: "Housing Support Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Build council housing in every ward, guarantee emergency accommodation for all homeless residents, and fund comprehensive tenancy support services",
          "Significantly expand council house building, increase homelessness prevention funding, and strengthen tenant eviction protections",
          "Modestly increase council housing spending on homelessness prevention, temporary accommodation, and housing advice services",
          "A moderate level of council housing funding covering statutory homelessness duties, housing register management, and basic tenant support",
          "Reduce council housing spending through housing association partnerships, tighter homelessness eligibility, and outsourced advice services",
          "Cut council housing services to emergency statutory homelessness duties only, eliminating discretionary housing programmes",
          "Eliminate all discretionary council housing spending, leaving homelessness and housing support to housing associations and charities",
        ][i],
        // homelessnessRate: higher = worse, left reduces it
      })),
      [509, 382, 255, 159, 96, 38, 0]
    ),
  },

  // ── B10. Immigration ──────────────────────────────────────────────────

  // uk_immigration_asylum — Immigration and Asylum Act (National)
  {
    _id: "uk_immigration_asylum",
    countryScope: "uk",
    name: "Immigration and Asylum Act",
    description: "Border enforcement, asylum processing, and the Channel crossings debate",
    policyDomain: "immigration",
    subCategory: "Asylum / borders",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "population", metricId: "migrationRate", scope: "national" },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "population", metric: "migrationRate" }, [
        { category: "social", metric: "socialCohesion", weight: -0.4 },
        { category: "governance", metric: "publicTrust", weight: 0.3 },
        { category: "publicSafety", metric: "publicSafetyConfidence", weight: 0.2 },
      ])!,
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    demographicEffects: [{ groupId: "immigrants", direction: 0.02 }],
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_immigration_asylum",
        [
          { name: "Open Borders Act", stance: "left", effectDirection: 1 },
          { name: "Humanitarian Asylum Act", stance: "left", effectDirection: 1 },
          { name: "Humane Border Management Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Immigration Enforcement Act", stance: "center", effectDirection: 0 },
          { name: "Enhanced Border Security Act", stance: "right", effectDirection: -1 },
          { name: "Secure the Border Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Border Enforcement Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish border enforcement for asylum seekers, grant automatic refugee status to all arrivals, and fund comprehensive resettlement programmes",
          "Significantly expand safe legal routes, end immigration detention, and invest in community-based asylum processing with full support services",
          "Modestly reform asylum processing with faster decisions, alternatives to detention, and expanded legal aid for asylum seekers",
          "A moderate level of border enforcement funding supporting Border Force operations, asylum processing, and immigration courts",
          "Increase Border Force staffing, expand surveillance of Channel crossings, and accelerate deportation of failed asylum seekers",
          "Dramatically expand border infrastructure, fund offshore asylum processing, and impose strict detention for all illegal arrivals",
          "Deploy military assets to prevent all Channel crossings, establish zero-tolerance enforcement, and deport all illegal arrivals immediately",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "migrationRate",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [12, 20, 29, 38, 58, 102, 175]
    ),
  },

  // uk_work_visas — Work Visas and Legal Immigration Act (National)
  {
    _id: "uk_work_visas",
    countryScope: "uk",
    name: "Work Visas and Legal Immigration Act",
    description: "Points-based immigration system, work visas, and legal migration routes",
    policyDomain: "immigration",
    subCategory: "Legal immigration / visas",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "population", metricId: "migrationRate", scope: "national" },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "population", metric: "migrationRate" }, [
        { category: "economic", metric: "unemploymentRate", weight: -0.3 },
        { category: "education", metric: "workforceSkill", weight: 0.3 },
        { category: "economic", metric: "gdpGrowth", weight: 0.2 },
      ])!,
      { metricCategoryId: "social" as const, metricId: "housingAffordability", weight: -0.4 },
    ],
    demographicEffects: [{ groupId: "immigrants", direction: 0.01 }],
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_work_visas",
        [
          { name: "Open Immigration Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Immigration Modernisation Act", stance: "left", effectDirection: 1 },
          { name: "Points-Based Immigration Act", stance: "center", effectDirection: 0 },
          { name: "Immigration Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Immigration Restriction Act", stance: "right", effectDirection: -1 },
          { name: "Immigration Moratorium Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Dramatically expand legal immigration, lower the points threshold to near-zero, and create automatic pathways to settlement for all workers",
          "Significantly increase visa quotas across all categories, reduce salary thresholds, and expand family reunification rights",
          "Modestly expand the skilled worker route, streamline visa processing, and create targeted pathways for shortage occupations",
          "A moderate immigration system processing visa applications at standard levels, balancing economic needs with population management",
          "Raise salary thresholds, reduce visa quotas, and tighten the points system to prioritise only the highest-skilled applicants",
          "Dramatically cut legal immigration across all visa categories, impose strict caps, and suspend lower-skilled worker routes",
          "Halt nearly all legal immigration, close most visa routes, and restrict entry to exceptional circumstances only",
        ][i],
        metricEffects: [
          {
            category: "population" as const,
            metricId: "migrationRate",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [23, 18, 12, 7, 5, 2, 0]
    ),
  },

  // ── B11. Labour & Workforce ───────────────────────────────────────────

  // uk_workers_rights — Workers' Rights and Employment Act (National)
  {
    _id: "uk_workers_rights",
    countryScope: "uk",
    name: "Workers' Rights and Employment Act",
    description:
      "Employment law, trade union rights, zero-hours contracts, and workplace protections",
    policyDomain: "social",
    subCategory: "Workers' rights",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "economic", metricId: "medianIncome", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "medianIncome" }, [
      { category: "social", metric: "incomeInequality", weight: 0.5 },
      { category: "economic", metric: "smallBusinessFormation", weight: -0.3 },
      { category: "social", metric: "socialMobility", weight: 0.3 },
    ]),
    demographicEffects: [{ groupId: "union", direction: 0.01 }],
    positions: standardUKCommitteePositions("Work & Pensions"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_workers_rights",
        [
          { name: "Maximum Worker Protection Act", stance: "left", effectDirection: 1 },
          { name: "Worker Rights Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Fair Work Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Employment Standards Act", stance: "center", effectDirection: 0 },
          { name: "Business Flexibility Act", stance: "right", effectDirection: -1 },
          { name: "Employment Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Full Labour Market Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Ban zero-hours contracts, mandate sectoral collective bargaining, guarantee paid family leave from day one, and give unions automatic recognition rights",
          "Significantly strengthen employment protections with enhanced sick pay, expanded parental leave, and restrictions on fire-and-rehire practices",
          "Modestly expand worker protections with enhanced tribunal access, improved whistleblower rights, and minimum notice period requirements",
          "A moderate level of employment regulation covering statutory sick pay, unfair dismissal protections, and basic trade union rights",
          "Reduce employment regulations, ease dismissal procedures, and limit trade union strike ballot requirements",
          "Dramatically reduce worker protections, restrict trade union powers, and allow maximum employer flexibility in hiring and firing",
          "Eliminate all employment regulations beyond basic health and safety, allowing fully market-driven employment terms",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "medianIncome",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [159, 108, 64, 38, 19, 6, 0]
    ),
  },

  // uk_workforce_development — Workforce Development Act (National)
  {
    _id: "uk_workforce_development",
    countryScope: "uk",
    name: "Workforce Development Act",
    description: "National skills strategy, apprenticeship levy, and employment support programmes",
    policyDomain: "education",
    subCategory: "Workforce development",
    budgetCategory: "education",
    nationalOnly: true,
    // §4.7 (P2a): workforceSkill is now DERIVED (gradRate/testPerf/apprenticeship
    // + the spending channel), so the direct primary double-counted. Re-pointed
    // to apprenticeshipRate — the vocational ROOT driver the engine folds into
    // workforceSkill (was a 0.5 secondary). Non-education terms stay.
    effectTarget: {
      metricCategoryId: "education",
      metricId: "apprenticeshipRate",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "education", metric: "apprenticeshipRate" },
      [
        // Workforce development / jobs guarantee (left) lowers unemployment:
        // positive weight (matches us_workforce_development).
        { category: "economic", metric: "unemploymentRate", weight: 0.5 },
        { category: "social", metric: "socialMobility", weight: 0.3 },
        { category: "economic", metric: "economicFreedom", weight: -0.2 },
      ]
    ),
    positions: standardUKCommitteePositions("Work & Pensions"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_workforce_development",
        [
          { name: "Universal Jobs Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "National Workforce Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Worker Retraining Act", stance: "left", effectDirection: 1 },
          { name: "Workforce Services Act", stance: "center", effectDirection: 0 },
          { name: "Private Sector Workforce Act", stance: "right", effectDirection: -1 },
          { name: "Workforce Programme Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Workforce Programme Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Create a government jobs programme providing employment to anyone who wants it, with full training, placement, and benefits",
          "Significantly expand the apprenticeship levy, fund free retraining for all adults, and create national skills academies in every region",
          "Modestly increase funding for displaced worker retraining, expand apprenticeship places, and strengthen Jobcentre Plus services",
          "A moderate level of workforce funding supporting Jobcentre Plus, the apprenticeship levy, and targeted training grants",
          "Reform the apprenticeship levy to give employers more flexibility, reduce Jobcentre Plus provision, and incentivise employer-led training",
          "Dramatically cut government employment programmes, abolish the apprenticeship levy, and leave skills training to employers",
          "Eliminate all government workforce development, close Jobcentre Plus, and leave employment support entirely to the private sector",
        ][i],
        economic: ([-5, -3, -1, 0, 1, 3, 5] as const)[i],
        social: ([-3, -2, -1, 0, 1, 2, 3] as const)[i],
      })),
      [318, 223, 127, 76, 38, 13, 0]
    ),
  },

  // uk_regional_labour — Regional Labour Standards Act (Regional)
  {
    _id: "uk_regional_labour",
    countryScope: "uk",
    name: "Regional Labour Standards Act",
    description: "Council-level employment support, local job fairs, and living wage promotion",
    policyDomain: "social",
    subCategory: "Regional labour",
    budgetCategory: "social",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: { metricCategoryId: "economic", metricId: "unemploymentRate", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "unemploymentRate" }, [
      { category: "education", metric: "apprenticeshipRate", weight: 0.4 },
      { category: "education", metric: "workforceSkill", weight: 0.3 },
      { category: "social", metric: "socialMobility", weight: 0.2 },
    ]),
    positions: standardUKCommitteePositions("Economy"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_labour",
        [
          { name: "Regional Living Wage Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Regional Employment Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Employment Support Investment Act", stance: "left", effectDirection: 1 },
          { name: "Regional Employment Services Act", stance: "center", effectDirection: 0 },
          { name: "Employment Services Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Employment Support Act", stance: "right", effectDirection: -1 },
          { name: "Employment Services Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate a regional living wage for all council contracts, fund comprehensive employment advice centres, and guarantee apprenticeship places for all young people",
          "Significantly expand council employment services, fund local job fairs, and create employer partnership programmes for apprenticeship matching",
          "Modestly increase council employment spending on job advice centres, local skills matching, and support for the long-term unemployed",
          "A moderate level of council employment funding supporting local job centres, business liaison, and basic careers advice",
          "Reduce council employment spending, partnering with charities and private providers to deliver advice services",
          "Cut council employment services to statutory obligations only, eliminating job fairs and employer partnership programmes",
          "Eliminate all council-funded employment support, leaving job advice and placement entirely to Jobcentre Plus and the private sector",
        ][i],
        // unemploymentRate: higher = worse, left reduces it
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "unemploymentRate",
            ratePerTurn: TICK_RATES_7_INV[i] ?? 0,
          },
        ],
      })),
      [159, 115, 76, 45, 19, 6, 0]
    ),
  },

  // ── B12. Housing ──────────────────────────────────────────────────────

  // uk_housing_planning — Housing and Planning Act (National)
  {
    _id: "uk_housing_planning",
    countryScope: "uk",
    name: "Housing and Planning Act",
    description: "National housing policy, planning reform, and housebuilding targets",
    policyDomain: "social",
    subCategory: "Housing supply",
    budgetCategory: "social",
    nationalOnly: true,
    // §4.7 (P3d): housing/planning law acts on the SUPPLY root it actually
    // controls — affordability pressure, homelessness, and rough sleeping are
    // engine-derived from it. (The old direct housingAffordability ticks were
    // also sign-inverted: "build housing" options RAISED the lower-is-better
    // metric — raw option ticks bypass isHigherBetter.)
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingSupplyGrowth",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "housingSupplyGrowth" }, [
      { category: "economic", metric: "propertyValueIndex", weight: 0.3 },
      { category: "population", metric: "urbanizationRate", weight: 0.2 },
    ]),
    demographicEffects: [{ groupId: "urban", direction: 0.01 }],
    positions: standardUKCommitteePositions("Housing"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_housing_planning",
        [
          { name: "National Housing Guarantee Act", stance: "left", effectDirection: 1 },
          { name: "Affordable Housing Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Housing Access Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Housing Policy Act", stance: "center", effectDirection: 0 },
          { name: "Planning Liberalisation Act", stance: "right", effectDirection: -1 },
          { name: "Market Housing Act", stance: "right", effectDirection: -1 },
          { name: "Housing Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee housing as a right, mandate 500,000 new homes per year, build massive council housing estates, and abolish right-to-buy",
          "Significantly expand social housing construction, strengthen section 106 requirements, and increase Housing Association grants",
          "Modestly increase housebuilding through targeted planning reform, expanded Help to Buy, and first-time buyer support programmes",
          "A moderate level of housing investment supporting steady housebuilding targets, standard planning processes, and basic first-time buyer assistance",
          "Reform planning laws to speed up development, relax green belt restrictions in targeted areas, and reduce section 106 burdens on developers",
          "Dramatically deregulate planning, open green belt land to development, and rely entirely on private developers to meet housing demand",
          "Eliminate national planning controls, abolish social housing requirements, and leave all housing provision to private markets and landowners",
        ][i],
        // §4.7 (P3d): ticks act on the supply ROOT (higher = more building,
        // left options build more — signs align naturally).
      })),
      [658, 481, 329, 203, 101, 40, 0]
    ),
  },

  // uk_leasehold_reform — Leasehold and Property Reform Act (National)
  {
    _id: "uk_leasehold_reform",
    countryScope: "uk",
    name: "Leasehold and Property Reform Act",
    description: "Leasehold reform, ground rents, and the push to commonhold",
    policyDomain: "social",
    subCategory: "Leasehold / property",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "social",
      metricId: "housingAffordability",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "housingAffordability" }, [
      { category: "economic", metric: "propertyValueIndex", weight: 0.3 },
      { category: "governance", metric: "publicTrust", weight: 0.2 },
    ]),
    positions: standardUKCommitteePositions("Housing"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_leasehold_reform",
        [
          { name: "Leasehold Abolition Act", stance: "left", effectDirection: 1 },
          { name: "Comprehensive Leasehold Reform Act", stance: "left", effectDirection: 1 },
          { name: "Leaseholder Protection Act", stance: "left", effectDirection: 1 },
          { name: "Leasehold Standards Act", stance: "center", effectDirection: 0 },
          { name: "Property Market Freedom Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Leasehold Regulation Act", stance: "right", effectDirection: -1 },
          { name: "Property Deregulation Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish leasehold entirely, convert all existing leases to commonhold or freehold at no cost to leaseholders, and ban ground rent",
          "Ban new leasehold houses, make commonhold the default for flats, cap ground rent at a peppercorn, and give leaseholders right to manage",
          "Modestly strengthen leaseholder rights with capped service charges, easier right-to-buy freehold, and enhanced transparency requirements",
          "A moderate framework regulating ground rent levels, service charge transparency, and dispute resolution through tribunals",
          "Maintain the leasehold system with light-touch regulation, streamlined dispute resolution, and voluntary codes of practice",
          "Reduce government intervention in the leasehold market, leaving disputes to contract law and voluntary arbitration",
          "Eliminate all leasehold-specific regulation, leaving property relationships entirely to contract law and market negotiation",
        ][i],
        // housingAffordability is a PRESSURE index (lower better) — left
        // options (leaseholder protection) must LOWER it (P3d sign fix; raw
        // ticks bypass isHigherBetter).
      })),
      [76, 51, 30, 15, 8, 3, 0]
    ),
  },

  // uk_regional_housing_development — Regional Housing Development Act (Regional)
  {
    _id: "uk_regional_housing_development",
    countryScope: "uk",
    name: "Regional Housing Development Act",
    description:
      "Council planning departments, affordable housing enforcement, and brownfield regeneration",
    policyDomain: "social",
    subCategory: "Regional housing development",
    budgetCategory: "social",
    nationalOnly: false,
    allowedScope: "state",
    // §4.7 (P3d): regional housebuilding acts on the SUPPLY root; pressure and
    // homelessness are engine-derived from it.
    effectTarget: { metricCategoryId: "social", metricId: "housingSupplyGrowth", scope: "state" },
    effectTargetsWeighted: weightedTargets({ category: "social", metric: "housingSupplyGrowth" }, [
      { category: "economic", metric: "propertyValueIndex", weight: 0.4 },
      { category: "population", metric: "urbanizationRate", weight: 0.2 },
    ]),
    positions: standardUKCommitteePositions("Housing"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_housing_development",
        [
          { name: "Maximum Regional Housebuilding Act", stance: "left", effectDirection: 1 },
          { name: "Regional Housing Investment Act", stance: "left", effectDirection: 1 },
          { name: "Housing Development Enhancement Act", stance: "left", effectDirection: 1 },
          { name: "Regional Housing Development Act", stance: "center", effectDirection: 0 },
          { name: "Housing Development Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Housing Development Act", stance: "right", effectDirection: -1 },
          { name: "Housing Development Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand council planning departments, directly build council housing on all available land, and fund comprehensive brownfield regeneration",
          "Significantly increase council housing development budgets, expand planning department capacity, and fund affordable housing on council-owned land",
          "Modestly increase council planning and development spending on local plan preparation, brownfield identification, and affordable housing monitoring",
          "A moderate level of council housing development funding covering planning department operations, local plan maintenance, and standard enforcement",
          "Reduce council planning spending, streamline local plan processes, and rely on private developers to identify and build on suitable sites",
          "Cut council housing development to statutory planning obligations only, eliminating proactive site identification and affordable housing programmes",
          "Eliminate all discretionary council housing development spending, leaving planning and development entirely to private applicants and market forces",
        ][i],
        // §4.7 (P3d): ticks act on the supply ROOT (left builds more).
      })),
      [354, 253, 177, 111, 61, 25, 0]
    ),
  },

  // ── B13. Governance ───────────────────────────────────────────────────

  // uk_devolution_local_powers — Devolution and Local Powers Act (National)
  {
    _id: "uk_devolution_local_powers",
    countryScope: "uk",
    name: "Devolution and Local Powers Act",
    description:
      "Regional autonomy, devolved powers, and the balance between Westminster and regions",
    policyDomain: "governance",
    subCategory: "Devolution",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "devolutionSatisfaction",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "devolutionSatisfaction" },
      [
        { category: "governance", metric: "governmentTransparency", weight: 0.3 },
        { category: "social", metric: "civicParticipation", weight: 0.3 },
      ]
    ),
    positions: standardUKCommitteePositions("Levelling Up"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_devolution_local_powers",
        [
          { name: "Maximum Devolution Act", stance: "left", effectDirection: 1 },
          { name: "Enhanced Devolution Act", stance: "left", effectDirection: 1 },
          { name: "Devolution Extension Act", stance: "left", effectDirection: 1 },
          { name: "Devolution Settlement Act", stance: "center", effectDirection: 0 },
          { name: "Westminster Primacy Act", stance: "right", effectDirection: -1 },
          { name: "Devolution Rollback Act", stance: "right", effectDirection: -1 },
          { name: "Abolish Devolution Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Devolve all domestic policy to regional governments, grant full tax-raising powers, and create a federal structure with Westminster handling only defence and foreign affairs",
          "Significantly expand devolved powers including regional income tax variation, full control over welfare delivery, and regional borrowing rights",
          "Modestly expand devolved competencies with additional planning powers, transport authority, and enhanced local decision-making",
          "A moderate devolution framework maintaining the established balance of powers between Westminster and regional governments",
          "Reassert Westminster authority over devolved areas, reduce regional government autonomy, and centralise key policy decisions",
          "Dramatically reduce devolved powers, return most competencies to Westminster, and limit regional governments to administrative functions",
          "Eliminate devolved governments entirely, centralising all domestic policy at Westminster and replacing regional assemblies with appointed administrators",
        ][i],
      })),
      [60, 42, 27, 15, 7, 3, 0]
    ),
  },

  // uk_government_ethics — Government Ethics and Transparency Act (National)
  {
    _id: "uk_government_ethics",
    countryScope: "uk",
    name: "Government Ethics and Transparency Act",
    description: "Standards in public life, ministerial conduct, and lobbying regulation",
    policyDomain: "governance",
    subCategory: "Ethics / transparency",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "national",
    },
    // NOTE (Bug #0962 #5): corruptionIndex is an ENGINE-DERIVED READOUT of
    // governmentTransparency (§4.7 root→readout edge; see mediaGovernanceSweep.test).
    // Targeting it here would double-count — the engine already lowers corruption when
    // transparency rises. So the anti-corruption law targets the transparency ROOT; the
    // graded-chip fix (Bug #0962) now surfaces that transparency effect on same-side bills.
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "governmentTransparency" },
      [
        { category: "governance", metric: "publicTrust", weight: 0.5 },
        { category: "social", metric: "civicParticipation", weight: 0.2 },
      ]
    ),
    positions: standardUKCommitteePositions("Standards"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_government_ethics",
        [
          {
            name: "Maximum Transparency and Anti-Corruption Act",
            stance: "left",
            effectDirection: 1,
          },
          { name: "Government Accountability Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Ethics Reform Act", stance: "left", effectDirection: 1 },
          { name: "Government Ethics Standards Act", stance: "center", effectDirection: 0 },
          { name: "Streamlined Ethics Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Ethics Oversight Act", stance: "right", effectDirection: -1 },
          { name: "Ethics Office Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate full financial disclosure for all officials, ban MPs' second jobs, create an independent anti-corruption agency, and expand whistleblower protections",
          "Significantly strengthen the Committee on Standards, expand lobbying restrictions, and mandate public disclosure of all ministerial meetings",
          "Modestly strengthen conflict-of-interest rules, expand Freedom of Information compliance, and increase ethics office staffing",
          "A moderate level of ethics enforcement covering financial disclosure, revolving door restrictions, and standards committee oversight",
          "Reduce ethics reporting requirements, consolidate oversight bodies, and ease restrictions on post-government employment",
          "Dramatically reduce government ethics enforcement, eliminate most disclosure requirements, and rely on self-regulation",
          "Eliminate all government ethics oversight agencies, leaving accountability to elections and the court system",
        ][i],
      })),
      [36, 24, 15, 7, 4, 1, 0]
    ),
  },

  // uk_electoral_reform — Electoral Reform Act (National)
  {
    _id: "uk_electoral_reform",
    countryScope: "uk",
    name: "Electoral Reform Act",
    description: "Voting system, constituency boundaries, and democratic participation",
    policyDomain: "governance",
    subCategory: "Electoral reform",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "governance", metricId: "voterTurnout", scope: "national" },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "voterTurnout" }, [
      { category: "social", metric: "civicParticipation", weight: 0.6 },
      { category: "governance", metric: "publicTrust", weight: 0.4 },
    ]),
    positions: standardUKCommitteePositions("Standards"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_electoral_reform",
        [
          { name: "Full Proportional Representation Act", stance: "left", effectDirection: 1 },
          { name: "Electoral Modernisation Act", stance: "left", effectDirection: 1 },
          { name: "Democratic Participation Act", stance: "left", effectDirection: 1 },
          { name: "Electoral Standards Act", stance: "center", effectDirection: 0 },
          { name: "Election Integrity Act", stance: "right", effectDirection: -1 },
          { name: "Strict Electoral Security Act", stance: "right", effectDirection: -1 },
          { name: "Electoral Restriction Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Replace FPTP with proportional representation, introduce automatic voter registration, lower the voting age to 16, and make Election Day a public holiday",
          "Introduce a proportional voting system for Commons elections, expand postal voting access, and reform the House of Lords into an elected chamber",
          "Modestly expand voter registration access, increase election funding, and introduce online voting pilots",
          "A moderate level of electoral administration supporting constituency boundaries, voter registration, and election security",
          "Require photo ID at polling stations, tighten postal vote eligibility, and strengthen measures against electoral fraud",
          "Mandate government-issued photo ID, eliminate most postal voting, and reduce the voter registration window",
          "Impose the strictest voter eligibility verification, eliminate postal voting entirely, and require in-person voting only with government-issued identification",
        ][i],
      })),
      [24, 17, 11, 6, 3, 1, 0]
    ),
  },

  // uk_regional_governance — Regional Governance Act (Regional)
  {
    _id: "uk_regional_governance",
    countryScope: "uk",
    name: "Regional Governance Act",
    description: "Council democratic services, scrutiny committees, and public engagement",
    policyDomain: "governance",
    subCategory: "Regional governance",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "governmentTransparency",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "governmentTransparency" },
      [
        { category: "social", metric: "civicParticipation", weight: 0.5 },
        { category: "governance", metric: "devolutionSatisfaction", weight: 0.3 },
      ]
    ),
    positions: standardUKCommitteePositions("Governance"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_governance",
        [
          { name: "Maximum Local Democracy Act", stance: "left", effectDirection: 1 },
          { name: "Enhanced Local Democracy Act", stance: "left", effectDirection: 1 },
          { name: "Democratic Engagement Act", stance: "left", effectDirection: 1 },
          { name: "Regional Governance Services Act", stance: "center", effectDirection: 0 },
          { name: "Governance Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Governance Act", stance: "right", effectDirection: -1 },
          { name: "Governance Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund participatory budgeting in every ward, guarantee citizens' assemblies on major decisions, and provide comprehensive public engagement programmes",
          "Significantly expand council public engagement, fund ward-level consultations, and increase scrutiny committee resources",
          "Modestly increase council governance spending on public consultations, improved council meeting accessibility, and enhanced scrutiny capacity",
          "A moderate level of council governance funding covering democratic services, scrutiny committees, and standard public engagement",
          "Reduce council governance spending through fewer committee meetings, consolidated democratic services, and digital-first engagement",
          "Cut council governance to legally required meetings and statutory consultations only, eliminating discretionary public engagement",
          "Eliminate all discretionary council governance spending, reducing democratic services to the bare statutory minimum",
        ][i],
      })),
      [30, 21, 13, 7, 4, 1, 0]
    ),
  },

  // ── B14. Media & Communications ───────────────────────────────────────

  // uk_bbc_public_media — BBC and Public Media Act (National)
  {
    _id: "uk_bbc_public_media",
    countryScope: "uk",
    name: "BBC and Public Media Act",
    description: "BBC licence fee, public service broadcasting, and Ofcom media regulation",
    policyDomain: "mediaInformation",
    subCategory: "Media / BBC",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "mediaInformation", metricId: "bbcTrust", scope: "national" },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "mediaInformation", metric: "bbcTrust" }, [
        { category: "mediaInformation", metric: "pressFreedom", weight: 0.4 },
        { category: "mediaInformation", metric: "mediaPolarization", weight: -0.3 },
      ])!,
      { metricCategoryId: "governance" as const, metricId: "nationalPride", weight: -0.4 },
    ],
    positions: standardUKCommitteePositions("Culture Media Sport"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_bbc_public_media",
        [
          { name: "Public Media Expansion Act", stance: "left", effectDirection: 1 },
          { name: "BBC Protection and Media Standards Act", stance: "left", effectDirection: 1 },
          { name: "Media Investment Act", stance: "left", effectDirection: 1 },
          { name: "Public Broadcasting Standards Act", stance: "center", effectDirection: 0 },
          { name: "Media Market Reform Act", stance: "right", effectDirection: -1 },
          { name: "BBC Reduction Act", stance: "right", effectDirection: -1 },
          { name: "Abolish the Licence Fee Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Massively expand BBC funding, create new public service channels, mandate Ofcom enforcement of impartiality, and fund local journalism across every region",
          "Significantly increase the licence fee, expand BBC services, strengthen Ofcom powers over social media, and fund a national local news service",
          "Modestly increase BBC funding, expand digital services, and strengthen Ofcom regulation of online platforms and media ownership",
          "A moderate level of public media funding sustaining BBC services, Channel 4's public remit, and standard Ofcom regulation",
          "Freeze the licence fee, allow BBC to take advertising, and reduce Ofcom regulatory burden on commercial broadcasters",
          "Dramatically cut the licence fee, sell off BBC services, privatise Channel 4, and reduce Ofcom to a minimal complaints body",
          "Eliminate the BBC licence fee entirely, privatise all public broadcasters, and abolish Ofcom media regulation",
        ][i],
      })),
      [45, 33, 24, 18, 11, 5, 0]
    ),
  },

  // uk_digital_broadband — Digital and Broadband Regulation Act (National)
  {
    _id: "uk_digital_broadband",
    countryScope: "uk",
    name: "Digital and Broadband Regulation Act",
    description: "Digital regulation, net neutrality, online safety, and broadband access",
    policyDomain: "mediaInformation",
    subCategory: "Digital / broadband",
    budgetCategory: "infrastructure",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "infrastructure",
      metricId: "broadbandAccess",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "infrastructure", metric: "broadbandAccess" }, [
        { category: "mediaInformation", metric: "pressFreedom", weight: 0.3 },
        { category: "economic", metric: "smallBusinessFormation", weight: 0.2 },
      ])!,
      { metricCategoryId: "governance" as const, metricId: "nationalPride", weight: -0.4 },
      { metricCategoryId: "economic" as const, metricId: "economicFreedom", weight: -0.1 },
    ],
    positions: standardUKCommitteePositions("Culture Media Sport"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_digital_broadband",
        [
          { name: "Digital Rights and Universal Access Act", stance: "left", effectDirection: 1 },
          { name: "Digital Accountability Act", stance: "left", effectDirection: 1 },
          { name: "Digital Fairness Act", stance: "left", effectDirection: 1 },
          { name: "Digital Standards Act", stance: "center", effectDirection: 0 },
          { name: "Digital Market Freedom Act", stance: "right", effectDirection: -1 },
          { name: "Digital Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Digital Regulation Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate universal broadband as a public utility, enforce strict net neutrality, regulate algorithms, and require full data transparency from tech companies",
          "Significantly strengthen online safety enforcement, expand data protection rights, impose platform liability for harmful content, and fund digital literacy programmes",
          "Modestly strengthen broadband consumer protections, enhance data privacy enforcement, and regulate targeted online advertising",
          "A moderate level of digital regulation covering broadband consumer rights, basic online safety enforcement, and standard data protection",
          "Reduce digital regulation, ease compliance burdens on tech companies, and allow ISPs to manage network traffic freely",
          "Dramatically reduce online safety requirements, weaken data protection enforcement, and deregulate broadband markets entirely",
          "Eliminate all government digital and broadband regulation, leaving online safety, data protection, and internet governance to market forces",
        ][i],
      })),
      [30, 21, 13, 7, 4, 1, 0]
    ),
  },

  // ── B15. Civil Liberties ──────────────────────────────────────────────

  // uk_surveillance_privacy — Surveillance and Civil Liberties Act (National)
  {
    _id: "uk_surveillance_privacy",
    countryScope: "uk",
    name: "Surveillance and Civil Liberties Act",
    description:
      "Balance between security and privacy, CCTV, bulk data collection, and police surveillance",
    policyDomain: "governance",
    subCategory: "Surveillance / privacy",
    nationalOnly: true,
    // P6a: this IS the civil-liberties act — re-targeted onto the new axis
    // anchor; press freedom demotes to a secondary.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "civilLiberties",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "governance", metric: "civilLiberties" }, [
      { category: "mediaInformation", metric: "pressFreedom", weight: 0.3 },
      { category: "governance", metric: "governmentTransparency", weight: 0.4 },
      { category: "publicSafety", metric: "crimeRate", weight: -0.3 },
      { category: "social", metric: "socialCohesion", weight: -0.2 },
    ]),
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_surveillance_privacy",
        [
          { name: "Digital Privacy and Civil Liberties Act", stance: "left", effectDirection: 1 },
          { name: "Privacy Protection Act", stance: "left", effectDirection: 1 },
          { name: "Surveillance Reform Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Security and Privacy Act", stance: "center", effectDirection: 0 },
          { name: "Security Enhancement Act", stance: "right", effectDirection: -1 },
          { name: "Comprehensive Surveillance Act", stance: "right", effectDirection: -1 },
          { name: "Maximum Security State Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Repeal bulk surveillance powers, ban facial recognition technology, require warrants for all data access, and establish a digital bill of rights",
          "Significantly restrict bulk data collection, impose strict judicial oversight on surveillance warrants, and limit police use of facial recognition",
          "Modestly strengthen oversight of surveillance powers, expand the role of judicial commissioners, and regulate law enforcement use of AI",
          "A moderate framework balancing security service capabilities with privacy protections, judicial oversight, and proportionality requirements",
          "Expand surveillance capabilities, streamline warrant processes, and increase data retention requirements for communications providers",
          "Dramatically expand bulk data collection, deploy facial recognition nationally, and grant security services broader access to encrypted communications",
          "Grant unrestricted surveillance powers to security services, mandate backdoors in all encrypted services, and deploy comprehensive biometric monitoring",
        ][i],
      })),
      [15, 12, 9, 6, 9, 15, 24]
    ),
  },

  // uk_drug_policy — Drug Policy and Reform Act (National)
  {
    _id: "uk_drug_policy",
    countryScope: "uk",
    name: "Drug Policy and Reform Act",
    description: "Drug classification, enforcement approach, and decriminalisation debate",
    policyDomain: "publicSafety",
    subCategory: "Drug policy",
    nationalOnly: true,
    effectTarget: { metricCategoryId: "publicSafety", metricId: "crimeRate", scope: "national" },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "publicSafety", metric: "crimeRate" }, [
        { category: "publicSafety", metric: "incarcerationRate", weight: 0.5 },
        { category: "healthcare", metric: "mentalHealthAccess", weight: 0.3 },
        { category: "social", metric: "socialCohesion", weight: 0.2 },
      ])!,
      { metricCategoryId: "publicSafety" as const, metricId: "crimeRate", weight: 0.4 },
    ],
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_drug_policy",
        [
          { name: "Full Drug Legalisation Act", stance: "left", effectDirection: 1 },
          { name: "Decriminalisation and Treatment Act", stance: "left", effectDirection: 1 },
          { name: "Cannabis Reform Act", stance: "left", effectDirection: 1 },
          { name: "Balanced Drug Policy Act", stance: "center", effectDirection: 0 },
          { name: "Drug Enforcement Act", stance: "right", effectDirection: -1 },
          { name: "Strict Drug Enforcement Act", stance: "right", effectDirection: -1 },
          { name: "Zero Tolerance Drug Act", stance: "right", effectDirection: -1 },
        ],
        "social"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Legalise and regulate all drugs, establish government-licensed dispensaries, redirect all enforcement spending to treatment and harm reduction",
          "Decriminalise personal drug possession, massively expand NHS addiction treatment, and fund safe consumption facilities",
          "Legalise and regulate cannabis, maintain criminal penalties for harder drugs, and increase funding for addiction treatment services",
          "A moderate approach maintaining existing drug classifications while funding treatment programmes and supporting evidence-based harm reduction",
          "Increase penalties for drug dealing, expand police drug testing powers, and prioritise enforcement over treatment approaches",
          "Dramatically increase penalties for possession and dealing, expand prison capacity for drug offenders, and defund harm reduction programmes",
          "Impose the harshest penalties for all drug offences, mandate prison sentences for possession, and eliminate all government-funded harm reduction and treatment",
        ][i],
        // crimeRate: higher = worse, left reduces it through decriminalisation
      })),
      [18, 24, 15, 9, 12, 18, 24]
    ),
  },

  // ── B16. Emergency Services ───────────────────────────────────────────

  // uk_regional_emergency_services — Regional Emergency Services Act (Regional)
  {
    _id: "uk_regional_emergency_services",
    countryScope: "uk",
    name: "Regional Emergency Services Act",
    description: "Fire and rescue, ambulance support, emergency planning, and civil resilience",
    policyDomain: "publicSafety",
    subCategory: "Emergency services",
    budgetCategory: "publicSafety",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "publicSafety",
      metricId: "publicSafetyConfidence",
      scope: "state",
    },
    // §4.7 (P3b): SUB-ALLOCATION keep (fire/rescue/ambulance — non-police
    // capacity the publicSafety channel can't express) → confidence stays; the
    // crimeRate secondary was dropped (emergency services don't police crime —
    // that's the channel's police-capacity path).
    effectTargetsWeighted: weightedTargets(
      { category: "publicSafety", metric: "publicSafetyConfidence" },
      [
        { category: "healthcare", metric: "preventableMortality", weight: 0.3 },
        { category: "social", metric: "socialCohesion", weight: 0.2 },
        { category: "economic", metric: "economicFreedom", weight: -0.15 },
      ]
    ),
    positions: standardUKCommitteePositions("Home Affairs"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_emergency_services",
        [
          { name: "Comprehensive Emergency Services Act", stance: "left", effectDirection: 1 },
          { name: "Emergency Services Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Emergency Readiness Act", stance: "left", effectDirection: 1 },
          { name: "Emergency Services Funding Act", stance: "center", effectDirection: 0 },
          { name: "Emergency Services Efficiency Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Emergency Services Act", stance: "right", effectDirection: -1 },
          { name: "Emergency Services Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Guarantee professional fire and ambulance coverage in every community, build regional disaster response centres, and fund advanced 999 systems with mental health dispatch",
          "Significantly expand regional fire and ambulance staffing, upgrade equipment, and fund community emergency training programmes",
          "Modestly increase emergency services funding for equipment upgrades, firefighter training, and disaster preparedness planning",
          "A moderate level of regional emergency funding supporting fire and rescue operations, ambulance services, and basic civil resilience",
          "Reduce emergency costs through retained (on-call) firefighters, consolidated control rooms, and shared services across neighbouring regions",
          "Cut emergency services to bare-minimum 999 dispatch, relying on retained firefighters and mutual aid agreements for major incidents",
          "Eliminate council-funded emergency services, privatising fire and rescue through subscription services and private contracts",
        ][i],
      })),
      [358, 287, 215, 161, 107, 54, 0]
    ),
  },

  // ── B16. Agriculture ──────────────────────────────────────────────────

  // uk_agriculture_policy — Agricultural Policy and Rural Development Act (National)
  {
    _id: "uk_agriculture_policy",
    countryScope: "uk",
    name: "Agricultural Policy and Rural Development Act",
    description: "Agricultural subsidies, land use policy, and national food security",
    policyDomain: "agriculture",
    subCategory: "Agriculture / farming",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "foodSecurity",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets({ category: "economic", metric: "foodSecurity" }, [
      { category: "economic", metric: "ruralRevitalization", weight: 0.5 },
      { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
    ]),
    demographicEffects: [{ groupId: "rural", direction: 0.02 }],
    positions: standardUKCommitteePositions("Environment Food Rural"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_agriculture_policy",
        [
          { name: "Sustainable Farming Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Agricultural Reform Act", stance: "left", effectDirection: 1 },
          { name: "Rural Support Act", stance: "left", effectDirection: 1 },
          { name: "Agricultural Stability Act", stance: "center", effectDirection: 0 },
          { name: "Farm Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Agricultural Liberalisation Act", stance: "right", effectDirection: -1 },
          { name: "Farming Privatisation Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Mandate nationwide organic transition, fund extensive rewilding programmes, guarantee income support for all small farmers, and ban intensive livestock operations",
          "Significantly expand sustainable farming subsidies, reduce intensive agriculture, fund rural broadband and services, and support farm-to-table infrastructure",
          "Modestly increase agricultural support with environmental conditions, fund local food systems, and maintain basic farm income guarantees",
          "A moderate level of agricultural funding sustaining existing subsidy schemes, basic environmental stewardship, and rural development programmes",
          "Reduce environmental regulations on farming, scale back subsidies, and prioritise productivity and competitive exports over land stewardship",
          "Dramatically cut agricultural subsidies, end environmental land management schemes, and expose UK farming to full global market competition",
          "Eliminate all farm subsidies and agricultural programmes, leaving food production entirely to market forces and large agribusiness",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "foodSecurity",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [215, 161, 118, 83, 54, 24, 0]
    ),
  },

  // uk_regional_agriculture — Regional Farming and Rural Services Act (Regional)
  {
    _id: "uk_regional_agriculture",
    countryScope: "uk",
    name: "Regional Farming and Rural Services Act",
    description: "Local agricultural support, rural infrastructure, and county farming initiatives",
    policyDomain: "agriculture",
    subCategory: "Regional agriculture",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "ruralRevitalization",
      scope: "state",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "economic", metric: "ruralRevitalization" },
      [
        { category: "economic", metric: "foodSecurity", weight: 0.5 },
        { category: "social", metric: "socialCohesion", weight: 0.2 },
      ]
    ),
    demographicEffects: [{ groupId: "rural", direction: 0.01 }],
    positions: standardUKCommitteePositions("Environment Food Rural"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_agriculture",
        [
          { name: "Comprehensive Rural Farming Act", stance: "left", effectDirection: 1 },
          { name: "Regional Agriculture Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Local Farming Support Act", stance: "left", effectDirection: 1 },
          { name: "Regional Agricultural Services Act", stance: "center", effectDirection: 0 },
          { name: "Lean Regional Farming Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Rural Agriculture Act", stance: "right", effectDirection: -1 },
          { name: "Rural Agriculture Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Fund county farm co-operatives, build local food processing hubs, guarantee agricultural apprenticeships, and preserve all farmland from development",
          "Significantly expand county agricultural services, fund farm diversification, and invest in rural road and broadband links for farming communities",
          "Modestly increase regional farming support for equipment grants, young farmer schemes, and local farmers markets",
          "A moderate level of regional agricultural funding supporting county shows, basic advisory services, and farm safety programmes",
          "Reduce council farming support to statutory land registration and animal health enforcement only",
          "Cut regional agriculture services to mandatory inspections, ending subsidies, grants, and county farm programmes",
          "Eliminate all council agricultural services, leaving farming support to national schemes and private advisory firms",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "ruralRevitalization",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [147, 107, 73, 44, 24, 10, 0]
    ),
  },

  // ── B17. Technology ───────────────────────────────────────────────────

  // uk_technology_policy — Digital Innovation and Technology Act (National)
  {
    _id: "uk_technology_policy",
    countryScope: "uk",
    name: "Digital Innovation and Technology Act",
    description:
      "Research and development funding, tech sector regulation, and digital economy policy",
    policyDomain: "technology",
    subCategory: "Technology / R&D",
    nationalOnly: true,
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "rdIntensity",
      scope: "national",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "rdIntensity" }, [
        // §4.7 (P2d): productivityGrowth secondary dropped — the primary root
        // feeds the engine TFP basket (root pass-through).
        { category: "economic", metric: "smallBusinessFormation", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    demographicEffects: [
      { groupId: "college", direction: 0.02 },
      { groupId: "urban", direction: 0.01 },
    ],
    positions: standardUKCommitteePositions("Science"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_technology_policy",
        [
          { name: "National Digital Transformation Act", stance: "left", effectDirection: 1 },
          { name: "Innovation Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Technology Growth Act", stance: "left", effectDirection: 1 },
          { name: "Digital Standards Act", stance: "center", effectDirection: 0 },
          { name: "Tech Market Freedom Act", stance: "right", effectDirection: -1 },
          { name: "Digital Deregulation Act", stance: "right", effectDirection: -1 },
          { name: "Technology Elimination Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Nationalise strategic technology sectors, fund moonshot R&D programmes, guarantee universal digital skills training, and build publicly owned cloud infrastructure",
          "Significantly expand R&D tax credits, fund Catapult network expansion, and invest in AI, quantum computing, and semiconductor research",
          "Modestly increase innovation funding for tech start-ups, digital skills bootcamps, and university-industry partnerships",
          "A moderate level of technology funding supporting ongoing UKRI programmes, existing R&D tax relief, and digital skills initiatives",
          "Reduce direct government R&D spending, shift to private-sector-led innovation, and streamline tech regulation",
          "Dramatically cut technology programmes, eliminate R&D tax credits, and leave digital infrastructure to market investment",
          "Eliminate all government technology and R&D programmes, leaving innovation entirely to the private sector and venture capital",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "rdIntensity",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [387, 277, 194, 133, 83, 33, 0]
    ),
  },

  // uk_regional_technology — Regional Digital Economy and Skills Act (Regional)
  {
    _id: "uk_regional_technology",
    countryScope: "uk",
    name: "Regional Digital Economy and Skills Act",
    description: "Local tech hubs, digital skills training, and regional innovation initiatives",
    policyDomain: "technology",
    subCategory: "Regional technology",
    nationalOnly: false,
    allowedScope: "state",
    effectTarget: {
      metricCategoryId: "economic",
      metricId: "smallBusinessFormation",
      scope: "state",
    },
    effectTargetsWeighted: [
      ...weightedTargets({ category: "economic", metric: "smallBusinessFormation" }, [
        { category: "infrastructure", metric: "broadbandAccess", weight: 0.4 },
        { category: "economic", metric: "rdIntensity", weight: 0.3 },
      ])!,
      { metricCategoryId: "economic" as const, metricId: "smallBusinessFormation", weight: -0.4 },
    ],
    demographicEffects: [{ groupId: "college", direction: 0.01 }],
    positions: standardUKCommitteePositions("Science"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_regional_technology",
        [
          { name: "Comprehensive Regional Tech Act", stance: "left", effectDirection: 1 },
          { name: "Regional Digital Expansion Act", stance: "left", effectDirection: 1 },
          { name: "Local Innovation Support Act", stance: "left", effectDirection: 1 },
          { name: "Regional Digital Economy Act", stance: "center", effectDirection: 0 },
          { name: "Lean Regional Tech Act", stance: "right", effectDirection: -1 },
          { name: "Minimal Regional Digital Act", stance: "right", effectDirection: -1 },
          { name: "Regional Tech Withdrawal Act", stance: "right", effectDirection: -1 },
        ],
        "economic"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Build publicly owned regional tech hubs in every county, fund free coding bootcamps, guarantee digital apprenticeships, and provide start-up grants for all applicants",
          "Significantly expand regional innovation centres, fund digital skills colleges, and invest in local tech incubators and accelerator programmes",
          "Modestly increase regional tech support for small business digitisation, coding workshops, and local broadband co-operatives",
          "A moderate level of regional digital funding supporting existing tech hubs, basic skills training, and small business advisory services",
          "Reduce council tech spending, consolidate innovation centres, and rely on private sector and universities for skills training",
          "Cut regional digital programmes to mandatory business registration IT only, ending innovation grants and skills funding",
          "Eliminate all council technology services, leaving digital skills and innovation entirely to national programmes and private providers",
        ][i],
        metricEffects: [
          {
            category: "economic" as const,
            metricId: "smallBusinessFormation",
            ratePerTurn: TICK_RATES_7[i] ?? 0,
          },
        ],
      })),
      [107, 73, 49, 29, 15, 6, 0]
    ),
  },

  // ── US Senate Procedure ───────────────────────────────────────────────────

  {
    _id: "senate_filibuster_rules",
    countryScope: "us",
    name: "Senate Filibuster Rules Act",
    description: "Legislation governing Senate filibuster rules and cloture thresholds",
    explanation:
      'Controls whether US Senators can invoke the filibuster to delay bills and force a 3/5 supermajority threshold. Abolishing the filibuster (the "nuclear option") lets a simple majority pass legislation; preserving it protects minority-party influence at the cost of legislative gridlock.',
    policyDomain: "government",
    subCategory: "Senate procedure",
    // Senate-only — this is internal chamber rules, proposed in the Senate
    positions: [
      {
        positionId: "senate_chair",
        name: "Chair, Senate Rules Committee",
        chamber: "senate",
      },
      {
        positionId: "senate_ranking",
        name: "Ranking Member, Senate Rules Committee",
        chamber: "senate",
      },
    ],
    nationalOnly: true,
    allowedScope: "national",
    policyOptions: [
      {
        id: "abolish_filibuster",
        name: "Nuclear Option Act",
        explanation:
          "Nuclear Option Act: Eliminate the filibuster entirely. Simple majority (51 votes) passes all Senate legislation. No senator may delay bills by invoking the filibuster.",
        stance: "left",
        effectDirection: -1,
        economic: 0,
        social: -1,
      },
      {
        id: "talking_filibuster_reform",
        name: "Talking Filibuster Reform Act",
        explanation:
          "Talking Filibuster Reform Act: Reform but preserve the filibuster. Senators may still invoke it, maintaining the 3/5 supermajority threshold, but the procedural framework is modernised.",
        stance: "center",
        effectDirection: 0,
        economic: 0,
        social: 0,
      },
      {
        id: "preserve_filibuster",
        name: "Filibuster Preservation Act",
        explanation:
          "Filibuster Preservation Act: Enshrine the filibuster in Senate rules. The 3/5 supermajority threshold is maintained and any senator may invoke it at a cost of 25 APs and 5 NPI.",
        stance: "right",
        effectDirection: 1,
        economic: 0,
        social: 1,
      },
    ],
  },

  // ── Resource Extraction Authority (contract licensing level) ───────────────
  {
    _id: "resource_extraction_authority",
    countryScope: "us",
    name: "Resource Extraction Authority Act",
    description:
      "Sets which level of government may issue extraction contracts that reserve a share of a state's resource capacity for a company",
    explanation:
      "Extraction contracts let a government reserve part of a state's mining or drilling capacity for a specific company in return for a signing fee and a per-turn royalty. This act decides who holds the licensing pen: the federal government only, the federal and state governments together, or the state governments only.",
    policyDomain: "economy",
    subCategory: "Resource licensing",
    positions: [
      {
        positionId: "house_natural_resources_chair",
        name: "Chair, House Natural Resources Committee",
        chamber: "house",
      },
      {
        positionId: "house_natural_resources_ranking",
        name: "Ranking Member, House Natural Resources Committee",
        chamber: "house",
      },
    ],
    nationalOnly: true,
    allowedScope: "national",
    // policyOptionIndex order is load-bearing: 0 federal, 1 concurrent, 2 state.
    // getResourceContractAuthority maps the enacted index to the licensing level.
    policyOptions: [
      {
        id: "federal_licensing",
        name: "Federal Licensing Act",
        explanation:
          "Only the federal government may issue extraction contracts. State governments cannot reserve resource capacity for companies. This is the default when no authority act is in force.",
        stance: "center",
        effectDirection: 1,
        economic: 1,
        social: 0,
      },
      {
        id: "concurrent_licensing",
        name: "Concurrent Licensing Act",
        explanation:
          "Both the federal and state governments may issue extraction contracts. Licensing power is shared, so either level can reserve capacity for companies.",
        stance: "center",
        effectDirection: 0,
        economic: 0,
        social: 0,
      },
      {
        id: "state_licensing",
        name: "State Licensing Act",
        explanation:
          "Only state governments may issue extraction contracts. The federal government steps back and each state controls how its own resource capacity is reserved.",
        stance: "right",
        effectDirection: -1,
        economic: 0,
        social: 1,
      },
    ],
  },

  // ── Japan legislation types ───────────────────────────────────────────────
  ...jpLegislationTypes,
  // ── Germany legislation types ─────────────────────────────────────────────
  ...deLegislationTypes,
  // ── Ireland legislation types ─────────────────────────────────────────────
  ...ieLegislationTypes,
  // ── China legislation types ───────────────────────────────────────────────
  ...cnLegislationTypes,
  // ── Nigeria legislation types ─────────────────────────────────────────────
  ...ngLegislationTypes,
  // ── Brazil legislation types (Vargas-era developmentalism; Petrobras 1953) ──
  ...brLegislationTypes,
  // ── USSR legislation types (SU-continuing ↔ Russia-liberalizing levers) ────
  ...ruLegislationTypes,
  // ── France legislation types (Fifth Republic; nationalization ↔ privatization) ──
  ...frLegislationTypes,
  // ── Italy legislation types (First Republic; IRI/ENI state holdings) ──
  ...itLegislationTypes,
  // ── Spain legislation types (Transition; INI state holdings) ──
  ...esLegislationTypes,
  // ── Sweden legislation types (Swedish model; wage-earner funds) ──
  ...seLegislationTypes,
  // ── Turkey legislation types (étatism; KİT state enterprises) ──
  ...trLegislationTypes,
  ...grLegislationTypes,
  // ── Austria legislation types (ÖIAG nationalised sector; Sozialpartnerschaft) ──
  ...atLegislationTypes,
  // ── Finland legislation types (state companies; tulopolitiikka settlements) ──
  ...fiLegislationTypes,
  // ── East Germany legislation types (GDR; plan ↔ reform/reunification) ──
  ...ddLegislationTypes,
  // ── Eastern-bloc one-party legislation (HU/PL/RO/YU/BG/CS + UKR/BLR/BAL) ──
  ...huLegislationTypes,
  ...plLegislationTypes,
  ...roLegislationTypes,
  ...yuLegislationTypes,
  ...bgLegislationTypes,
  ...uaLegislationTypes,
  ...blrLegislationTypes,
  ...csLegislationTypes,
  ...balLegislationTypes,

  // ── Banking separation (reusable per-country charter law; all legislatures) ──
  ...bankingSeparationLegislationTypes,

  // ── Scotland / Wales legislation types — PURPOSEFULLY POSTPONED ────────────
  // The seceded devolved nations do NOT yet have their own legislation. This was
  // a deliberate scope cut during the secession feature: Holyrood/Senedd run on
  // the standup government + cabinet, but a Scotland/Wales policy page currently
  // surfaces no enactable laws (the policy route filters legislationTypes by
  // `countryScope`, and nothing is scoped "sco"/"wls" yet — though the
  // LegislationType.countryScope union already reserves both codes).
  //
  // TODO(secession): author `../sco/scoLegislationTypes.ts` +
  // `../wal/walLegislationTypes.ts` (each entry `countryScope: "sco"` / "wls" —
  // note Wales is "wls", not "wal") and spread them here, mirroring the
  // per-country pattern above. Until then, localize Westminster's bills.

  // ── P6a: Recruitment / National Service (militaryReadiness + conscription axis home) ──
  {
    _id: "us_national_service",
    countryScope: "us",
    name: "National Service and Recruitment Act",
    description: "Selective Service, recruitment incentives, and the volunteer-force model",
    policyDomain: "defense",
    subCategory: "Recruitment / service model",
    budgetCategory: "defense",
    nationalOnly: true,
    // §4.7 KEEP (countryIndicesSweep): the SERVICE MODEL (volunteer vs
    // conscription) is manpower STRUCTURE the defense spending channel cannot
    // express; compulsion trades civilLiberties for readiness/pride.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "militaryReadiness",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "militaryReadiness" },
      [
        { category: "governance", metric: "nationalPride", weight: 0.4 },
        { category: "governance", metric: "civilLiberties", weight: -0.4 },
        { category: "economic", metric: "smallBusinessFormation", weight: 0.1 },
      ]
    ),
    positions: standardCommitteePositions("Armed Services"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "us_national_service",
        [
          { name: "Abolish Selective Service Act", stance: "left", effectDirection: -1 },
          { name: "Volunteer Force Act", stance: "left", effectDirection: -1 },
          { name: "Professional Forces Act", stance: "left", effectDirection: -1 },
          { name: "Selective Service Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Service Incentive Expansion Act", stance: "right", effectDirection: 1 },
          { name: "National Service Framework Act", stance: "right", effectDirection: 1 },
          { name: "Universal Service Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Abolish draft registration entirely and rely on a smaller professional force with civilian-sector partnerships",
          "End Selective Service registration while funding targeted recruitment bonuses for critical specialties",
          "Maintain an all-volunteer force with modestly improved pay, benefits, and veteran transition programs",
          "Keep Selective Service registration dormant alongside the existing all-volunteer recruitment pipeline",
          "Expand recruitment incentives, ROTC programs, and reserve readiness with selective call-up authority",
          "Establish a national service expectation with civil or military tracks and strong enlistment incentives",
          "Institute universal military service obligations with reserve liability for all able citizens",
        ][i],
      })),
      [5, 9, 14, 20, 32, 48, 70]
    ),
    source: "seed",
    isPermanent: true,
  },
  // ── P6a: Recruitment / National Service (militaryReadiness + conscription axis home) ──
  {
    _id: "uk_national_service",
    countryScope: "uk",
    name: "National Service Act",
    description: "Armed forces recruitment, reserves, and the national service question",
    policyDomain: "defense",
    subCategory: "Recruitment / service model",
    budgetCategory: "defense",
    nationalOnly: true,
    // §4.7 KEEP (countryIndicesSweep): the SERVICE MODEL (volunteer vs
    // conscription) is manpower STRUCTURE the defense spending channel cannot
    // express; compulsion trades civilLiberties for readiness/pride.
    effectTarget: {
      metricCategoryId: "governance",
      metricId: "militaryReadiness",
      scope: "national",
    },
    effectTargetsWeighted: weightedTargets(
      { category: "governance", metric: "militaryReadiness" },
      [
        { category: "governance", metric: "nationalPride", weight: 0.4 },
        { category: "governance", metric: "civilLiberties", weight: -0.4 },
        { category: "economic", metric: "smallBusinessFormation", weight: 0.1 },
      ]
    ),
    positions: standardUKCommitteePositions("Defence"),
    policyOptions: withPerCapitaCosts(
      policyOptions(
        "uk_national_service",
        [
          { name: "Forces Downsizing Act", stance: "left", effectDirection: -1 },
          { name: "Volunteer Forces Act", stance: "left", effectDirection: -1 },
          { name: "Professional Forces Act", stance: "left", effectDirection: -1 },
          { name: "Recruitment Continuity Act", stance: "center", effectDirection: 0 },
          { name: "Reserve Expansion Act", stance: "right", effectDirection: 1 },
          { name: "National Service Pathways Act", stance: "right", effectDirection: 1 },
          { name: "Universal National Service Act", stance: "right", effectDirection: 1 },
        ],
        "both"
      ).map((opt, i) => ({
        ...opt,
        explanation: [
          "Shrink the armed forces to a minimal professional core and close most recruitment offices",
          "Rely wholly on volunteer recruitment with improved forces pay and housing",
          "Maintain professional forces with targeted retention bonuses and cadet programmes",
          "Continue the current volunteer recruitment model with steady reserve strength",
          "Grow the Army Reserve and cadet pipeline with employer partnership incentives",
          "Introduce a national service scheme with military and civic options for school leavers",
          "Reintroduce compulsory national service with universal call-up liability",
        ][i],
      })),
      [4, 8, 13, 18, 28, 42, 60]
    ),
    source: "seed",
    isPermanent: true,
  },
];

/**
 * Spec B: materialize the era cost fractions (gdpCostFraction / incomeCostFraction)
 * onto every spending option from the central calibration model. Hand-set fractions
 * on any option are preserved. Flag-off ignores these; flag-on uses them.
 */
export const legislationTypes: LegislationType[] = withEraCosts(rawLegislationTypes);

export default legislationTypes;
